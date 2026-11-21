import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getEmailAddress } from "@/lib/email/address";
import { getDb } from "@/db";
import { domains, domainTrackingHosts, messageOpens, messageTracking, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { classifyOpen, createTrackingToken, isDuplicateOpen, MAX_STORED_OPENS } from "./open-tracking-utils";
import type { MessageLinkSummary, MessageTrackingState, MessageTrackingSummary } from "./types";
import { isMissingTableError } from "@/lib/database-errors";
import { getClickTotals, getLinkSummaries } from "./link-tracking";

/** Returns the message's pixel token, creating it on the first delivery attempt. */
export async function ensureTrackingToken(env: CloudflareEnv, messageId: string): Promise<string> {
	const db = getDb(env);
	await db.insert(messageTracking).values({ token: createTrackingToken(), messageId }).onConflictDoNothing();
	const [row] = await db
		.select({ token: messageTracking.token })
		.from(messageTracking)
		.where(eq(messageTracking.messageId, messageId))
		.limit(1);
	if (!row) throw new Error("Could not create the read-receipt token");
	return row.token;
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
}

export async function getMessageTrackingSummary(env: CloudflareEnv, messageId: string): Promise<MessageTrackingSummary | null> {
	const db = getDb(env);
	const [tracking] = await db.select().from(messageTracking).where(eq(messageTracking.messageId, messageId)).limit(1);
	if (!tracking) return null;
	const opens = await db
		.select()
		.from(messageOpens)
		.where(eq(messageOpens.token, tracking.token))
		.orderBy(desc(messageOpens.openedAt))
		.limit(MAX_STORED_OPENS);
	const links = await optionalLinkData(() => getLinkSummaries(env, tracking.token), [] as MessageLinkSummary[]);
	return {
		openCount: tracking.openCount,
		firstOpenedAt: tracking.firstOpenedAt?.toISOString() ?? null,
		lastOpenedAt: tracking.lastOpenedAt?.toISOString() ?? null,
		onlyAutomated: tracking.openCount === 0 && opens.length > 0,
		opens: opens.map((row) => ({
			openedAt: row.openedAt.toISOString(),
			client: row.client,
			device: row.device,
			country: row.country,
			city: row.city,
			automated: row.automated,
		})),
		clickCount: links.reduce((total, link) => total + link.clickCount, 0),
		links,
	};
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
	let rows: Array<{ messageId: string; token: string; openCount: number }>;
	try {
		rows = await db
			.select({ messageId: messageTracking.messageId, token: messageTracking.token, openCount: messageTracking.openCount })
			.from(messageTracking)
			.where(inArray(messageTracking.messageId, messageIds));
	} catch (error) {
		// Lists keep working before migration 0068 is applied.
		if (isMissingTableError(error)) return states;
		throw error;
	}
	if (rows.length === 0) return states;
	const tokens = rows.map((row) => row.token);
	const unopened = rows.filter((row) => row.openCount === 0).map((row) => row.token);
	const [clickTotals, automatedOpens] = await Promise.all([
		optionalLinkData(() => getClickTotals(env, tokens), new Map<string, { clicks: number; automated: number }>()),
		unopened.length > 0
			? db.selectDistinct({ token: messageOpens.token }).from(messageOpens).where(inArray(messageOpens.token, unopened))
			: [],
	]);
	const tokensWithAutomatedOpens = new Set(automatedOpens.map((row) => row.token));
	for (const row of rows) {
		const clicks = clickTotals.get(row.token);
		const clickCount = clicks?.clicks ?? 0;
		const state = row.openCount > 0 || clickCount > 0
			? "opened"
			: tokensWithAutomatedOpens.has(row.token) || (clicks?.automated ?? 0) > 0 ? "possible" : "sent";
		states.set(row.messageId, { state, opens: row.openCount, clicks: clickCount });
	}
	return states;
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
