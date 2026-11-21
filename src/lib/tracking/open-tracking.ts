import { and, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { getEmailAddress } from "@/lib/email/address";
import { getDb } from "@/db";
import { domains, domainTrackingHosts, messageOpens, messageTracking, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { classifyOpen, createTrackingToken, isDuplicateOpen, MAX_STORED_OPENS } from "./open-tracking-utils";
import type { MessageLinkSummary, MessageTickState, MessageTrackingState, MessageTrackingSummary } from "./types";
import { isMissingColumnError, isMissingTableError } from "@/lib/database-errors";
import { getClickTotals, getLinkSummaries, type ClickTotals } from "./link-tracking";
import { notifyTrackingEvent } from "./alerts";

/**
 * Returns the pixel token of one copy of a message, creating it on the first delivery attempt.
 * `recipient` is the lower-case address of a separate copy, or empty for the copy everyone shares.
 */
export async function ensureTrackingToken(env: CloudflareEnv, messageId: string, recipient = ""): Promise<string> {
	const db = getDb(env);
	await db.insert(messageTracking).values({ token: createTrackingToken(), messageId, recipient }).onConflictDoNothing();
	const [row] = await db
		.select({ token: messageTracking.token })
		.from(messageTracking)
		.where(and(eq(messageTracking.messageId, messageId), eq(messageTracking.recipient, recipient)))
		.limit(1);
	if (!row) throw new Error("Could not create the read-receipt token");
	return row.token;
}

/** Records the Message-ID a separate copy went out with, so a retried delivery skips it and replies to it thread. */
export async function markCopySent(env: CloudflareEnv, token: string, providerMessageId: string): Promise<void> {
	await getDb(env).update(messageTracking).set({ providerMessageId }).where(eq(messageTracking.token, token));
}

/** Separate copies of a message that are already out, by recipient. */
export async function getSentCopies(env: CloudflareEnv, messageId: string): Promise<Map<string, string>> {
	const rows = await getDb(env)
		.select({ recipient: messageTracking.recipient, providerMessageId: messageTracking.providerMessageId })
		.from(messageTracking)
		.where(and(eq(messageTracking.messageId, messageId), isNotNull(messageTracking.providerMessageId)));
	return new Map(rows.filter((row) => row.recipient && row.providerMessageId).map((row) => [row.recipient, row.providerMessageId!]));
}

/** Records one pixel fetch. Unknown tokens are ignored so the pixel answers the same either way. */
export async function recordOpen(
	env: CloudflareEnv,
	token: string,
	request: { userAgent: string | null; asn?: number; country?: string | null; city?: string | null },
): Promise<void> {
	const db = getDb(env);
	const [tracking] = await db
		.select({ token: messageTracking.token, createdAt: messageTracking.createdAt, direction: messages.direction })
		.from(messageTracking)
		.innerJoin(messages, eq(messages.id, messageTracking.messageId))
		.where(eq(messageTracking.token, token))
		.limit(1);
	if (!tracking || tracking.direction !== "outbound") return;

	const openedAt = new Date();
	const open = classifyOpen({ ...request, sentAt: tracking.createdAt, openedAt });
	const recent = await db
		.select({ openedAt: messageOpens.openedAt, client: messageOpens.client, device: messageOpens.device })
		.from(messageOpens)
		.where(eq(messageOpens.token, token))
		.orderBy(desc(messageOpens.openedAt))
		.limit(MAX_STORED_OPENS);
	if (isDuplicateOpen(recent[0], { openedAt, client: open.client, device: open.device })) return;

	if (recent.length < MAX_STORED_OPENS) {
		await db.insert(messageOpens).values({ id: newId("open"), token, openedAt, ...open });
	}
	if (open.automated) return;
	await db
		.update(messageTracking)
		.set({
			openCount: sql`${messageTracking.openCount} + 1`,
			firstOpenedAt: sql`coalesce(${messageTracking.firstOpenedAt}, ${Math.floor(openedAt.getTime() / 1000)})`,
			lastOpenedAt: openedAt,
		})
		.where(eq(messageTracking.token, token));
	await notifyTrackingEvent(env, { kind: "open", token });
}

export async function getMessageTrackingSummary(env: CloudflareEnv, messageId: string): Promise<MessageTrackingSummary | null> {
	const db = getDb(env);
	const copies = await selectCopies(env, messageId);
	if (copies.length === 0) return null;
	const recipientOf = new Map(copies.map((copy) => [copy.token, copy.recipient || null]));
	const tokens = copies.map((copy) => copy.token);
	const opens = await db
		.select()
		.from(messageOpens)
		.where(inArray(messageOpens.token, tokens))
		.orderBy(desc(messageOpens.openedAt))
		.limit(MAX_STORED_OPENS);
	const linksByToken = await optionalLinkData(() => getLinkSummaries(env, tokens), new Map<string, MessageLinkSummary[]>());
	const links = mergeLinkSummaries([...linksByToken.values()].flat());
	const openCount = copies.reduce((total, copy) => total + copy.openCount, 0);
	const openedTimes = copies.flatMap((copy) => [copy.firstOpenedAt, copy.lastOpenedAt]).filter((value): value is Date => !!value).map((value) => value.getTime());
	const separate = copies.some((copy) => copy.recipient);
	return {
		openCount,
		firstOpenedAt: openedTimes.length ? new Date(Math.min(...openedTimes)).toISOString() : null,
		lastOpenedAt: openedTimes.length ? new Date(Math.max(...openedTimes)).toISOString() : null,
		onlyAutomated: openCount === 0 && opens.length > 0,
		opens: opens.map((row) => ({
			openedAt: row.openedAt.toISOString(),
			client: row.client,
			device: row.device,
			country: row.country,
			city: row.city,
			automated: row.automated,
			recipient: recipientOf.get(row.token) ?? null,
		})),
		clickCount: links.reduce((total, link) => total + link.clickCount, 0),
		links,
		recipients: separate
			? copies.filter((copy) => copy.recipient).map((copy) => {
				const copyLinks = linksByToken.get(copy.token) ?? [];
				const clickCount = copyLinks.reduce((total, link) => total + link.clickCount, 0);
				const automated = opens.some((open) => open.token === copy.token) || copyLinks.some((link) => link.automatedClicks > 0);
				return {
					recipient: copy.recipient,
					state: tickState(copy.openCount, clickCount, automated),
					openCount: copy.openCount,
					clickCount,
					lastOpenedAt: copy.lastOpenedAt?.toISOString() ?? null,
				};
			})
			: [],
	};
}

type CopyRow = { token: string; recipient: string; openCount: number; firstOpenedAt: Date | null; lastOpenedAt: Date | null };

/** Every tracked copy of a message; before migration 0089 there is only the shared one. */
async function selectCopies(env: CloudflareEnv, messageId: string): Promise<CopyRow[]> {
	const db = getDb(env);
	const columns = { token: messageTracking.token, openCount: messageTracking.openCount, firstOpenedAt: messageTracking.firstOpenedAt, lastOpenedAt: messageTracking.lastOpenedAt };
	try {
		return await db
			.select({ ...columns, recipient: messageTracking.recipient })
			.from(messageTracking)
			.where(eq(messageTracking.messageId, messageId))
			.orderBy(messageTracking.recipient);
	} catch (error) {
		if (!isMissingColumnError(error)) throw error;
		const rows = await db.select(columns).from(messageTracking).where(eq(messageTracking.messageId, messageId));
		return rows.map((row) => ({ ...row, recipient: "" }));
	}
}

/** Separate copies carry the same links under different ids; the message view shows one line per URL. */
function mergeLinkSummaries(links: MessageLinkSummary[]): MessageLinkSummary[] {
	const byUrl = new Map<string, MessageLinkSummary>();
	for (const link of links) {
		const seen = byUrl.get(link.url);
		if (!seen) {
			byUrl.set(link.url, { ...link });
			continue;
		}
		seen.clickCount += link.clickCount;
		seen.automatedClicks += link.automatedClicks;
		if (link.lastClickedAt && (!seen.lastClickedAt || link.lastClickedAt > seen.lastClickedAt)) seen.lastClickedAt = link.lastClickedAt;
	}
	return [...byUrl.values()];
}

function tickState(opens: number, clicks: number, automated: boolean): MessageTickState {
	if (opens > 0 || clicks > 0) return "opened";
	return automated ? "possible" : "sent";
}

/** Link tables arrive in a later migration than the pixel; without them a message simply has no clicks. */
async function optionalLinkData<T>(read: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await read();
	} catch (error) {
		if (isMissingTableError(error)) return fallback;
		throw error;
	}
}

/**
 * Tick state of each tracked message: opened once a person opened it or clicked a link,
 * possible when only automated fetches arrived, sent otherwise. Untracked messages are absent.
 */
export async function getTrackingStates(env: CloudflareEnv, messageIds: string[]): Promise<Map<string, MessageTrackingState>> {
	const states = new Map<string, MessageTrackingState>();
	if (messageIds.length === 0) return states;
	const db = getDb(env);
	let rows: Array<{ messageId: string; token: string; openCount: number; recipient: string; lastOpenedAt: Date | null }>;
	try {
		rows = await selectStateRows(env, messageIds);
	} catch (error) {
		// Lists keep working before migration 0068 is applied.
		if (isMissingTableError(error)) return states;
		throw error;
	}
	if (rows.length === 0) return states;
	const tokens = rows.map((row) => row.token);
	const unopened = rows.filter((row) => row.openCount === 0).map((row) => row.token);
	const [clickTotals, automatedOpens] = await Promise.all([
		optionalLinkData(() => getClickTotals(env, tokens), new Map<string, ClickTotals>()),
		unopened.length > 0
			? db.selectDistinct({ token: messageOpens.token }).from(messageOpens).where(inArray(messageOpens.token, unopened))
			: [],
	]);
	const tokensWithAutomatedOpens = new Set(automatedOpens.map((row) => row.token));
	const rank: Record<MessageTickState, number> = { sent: 0, possible: 1, opened: 2 };
	for (const row of rows) {
		const clicks = clickTotals.get(row.token);
		const clickCount = clicks?.clicks ?? 0;
		const state = tickState(row.openCount, clickCount, tokensWithAutomatedOpens.has(row.token) || (clicks?.automated ?? 0) > 0);
		const previous = states.get(row.messageId);
		const lastActivityAt = latestIso(row.lastOpenedAt, clicks?.lastClickedAt ?? null);
		if (!row.recipient) {
			states.set(row.messageId, { state, opens: row.openCount, clicks: clickCount, lastActivityAt });
			continue;
		}
		// Separate copies: the ticks show the furthest any recipient got, plus how many opened.
		const merged: MessageTrackingState = previous ?? { state: "sent", opens: 0, clicks: 0, recipients: 0, openedBy: 0, lastActivityAt: null };
		merged.opens += row.openCount;
		merged.clicks += clickCount;
		if (lastActivityAt && (!merged.lastActivityAt || lastActivityAt > merged.lastActivityAt)) merged.lastActivityAt = lastActivityAt;
		merged.recipients = (merged.recipients ?? 0) + 1;
		if (state === "opened") merged.openedBy = (merged.openedBy ?? 0) + 1;
		if (rank[state] > rank[merged.state]) merged.state = state;
		states.set(row.messageId, merged);
	}
	return states;
}

/** The later of two optional times, as ISO text. */
function latestIso(...values: Array<Date | null>): string | null {
	const times = values.filter((value): value is Date => !!value).map((value) => value.getTime());
	return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

async function selectStateRows(env: CloudflareEnv, messageIds: string[]) {
	const db = getDb(env);
	const columns = { messageId: messageTracking.messageId, token: messageTracking.token, openCount: messageTracking.openCount, lastOpenedAt: messageTracking.lastOpenedAt };
	try {
		return await db.select({ ...columns, recipient: messageTracking.recipient }).from(messageTracking).where(inArray(messageTracking.messageId, messageIds));
	} catch (error) {
		if (!isMissingColumnError(error)) throw error;
		const rows = await db.select(columns).from(messageTracking).where(inArray(messageTracking.messageId, messageIds));
		return rows.map((row) => ({ ...row, recipient: "" }));
	}
}

/** The pixel hostname configured for the sender's domain, if any. */
export async function getTrackingHostForSender(env: CloudflareEnv, from: string): Promise<string | null> {
	const domain = getEmailAddress(from).split("@")[1]?.toLowerCase();
	if (!domain) return null;
	try {
		const [row] = await getDb(env)
			.select({ hostname: domainTrackingHosts.hostname })
			.from(domainTrackingHosts)
			.innerJoin(domains, eq(domains.id, domainTrackingHosts.domainId))
			.where(eq(domains.hostname, domain))
			.limit(1);
		return row?.hostname ?? null;
	} catch (error) {
		if (isMissingTableError(error)) return null;
		throw error;
	}
}

/** Null when unset; throws `TrackingHostsUnavailableError` before migration 0069. */
export async function getDomainTrackingHost(env: CloudflareEnv, domainId: string): Promise<string | null> {
	try {
		const [row] = await getDb(env)
			.select({ hostname: domainTrackingHosts.hostname })
			.from(domainTrackingHosts)
			.where(eq(domainTrackingHosts.domainId, domainId))
			.limit(1);
		return row?.hostname ?? null;
	} catch (error) {
		if (isMissingTableError(error)) throw new TrackingHostsUnavailableError();
		throw error;
	}
}

export async function setDomainTrackingHost(env: CloudflareEnv, domainId: string, hostname: string | null): Promise<void> {
	const db = getDb(env);
	try {
		if (!hostname) {
			await db.delete(domainTrackingHosts).where(eq(domainTrackingHosts.domainId, domainId));
			return;
		}
		await db
			.insert(domainTrackingHosts)
			.values({ domainId, hostname })
			.onConflictDoUpdate({ target: domainTrackingHosts.domainId, set: { hostname } });
	} catch (error) {
		if (isMissingTableError(error)) throw new TrackingHostsUnavailableError();
		throw error;
	}
}

export class TrackingHostsUnavailableError extends Error {
	constructor() {
		super("Apply pending database migrations to set a read-receipt address");
		this.name = "TrackingHostsUnavailableError";
	}
}

/** Sent messages answered by a later inbound message in the same conversation and mailbox. */
export async function getRepliedMessageIds(
	env: CloudflareEnv,
	sent: Array<{ id: string; mailboxId: string | null; threadId: string | null; createdAt: Date | string }>,
): Promise<Set<string>> {
	const replied = new Set<string>();
	const candidates = sent.filter((row): row is typeof row & { mailboxId: string; threadId: string } => !!row.mailboxId && !!row.threadId);
	if (candidates.length === 0) return replied;
	const rows = await getDb(env)
		.select({ mailboxId: messages.mailboxId, threadId: messages.threadId, latest: sql<number | string | Date>`max(${messages.createdAt})` })
		.from(messages)
		.where(and(
			eq(messages.direction, "inbound"),
			inArray(messages.threadId, Array.from(new Set(candidates.map((row) => row.threadId)))),
			inArray(messages.mailboxId, Array.from(new Set(candidates.map((row) => row.mailboxId)))),
			notInArray(messages.status, ["spam", "draft"]),
		))
		.groupBy(messages.mailboxId, messages.threadId);
	const latestReply = new Map(rows.map((row) => [`${row.mailboxId}:${row.threadId}`, toSeconds(row.latest)]));
	for (const row of candidates) {
		const latest = latestReply.get(`${row.mailboxId}:${row.threadId}`);
		if (latest !== undefined && latest > toSeconds(row.createdAt)) replied.add(row.id);
	}
	return replied;
}

/** Raw aggregates come back as stored (seconds), drizzle columns as Dates or ISO strings. */
function toSeconds(value: number | string | Date | null): number {
	if (value === null) return 0;
	if (value instanceof Date) return Math.floor(value.getTime() / 1000);
	if (typeof value === "number") return value;
	return /^\d+$/.test(value) ? Number(value) : Math.floor(Date.parse(value) / 1000);
}
