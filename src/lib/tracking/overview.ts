import { and, desc, eq, gte, inArray, like } from "drizzle-orm";
import { getDb } from "@/db";
import { messageLinkClicks, messageLinks, messageOpens, messageTracking, messages } from "@/db/schema";
import { isMissingTableError } from "@/lib/database-errors";
import { getFirstEmailAddressEntry } from "@/lib/email/address";
import { listDueFollowUps } from "@/lib/follow-ups/service";
import { listAccessibleMailboxIds } from "@/lib/mailboxes/access";
import { getRepliedMessageIds, getTrackingStates } from "./open-tracking";
import type { OverviewEvent, OverviewFile, TrackingOverview } from "./overview-types";
import type { MessageTrackingState } from "./types";
import { buildDailySeries, displayRecipient, pickWarmMessages, WARM_WINDOW_MS } from "./overview-utils";
import { getSharedFileNames } from "./shared-file-names";

const DAY_MS = 24 * 60 * 60_000;
const MAX_MESSAGES = 2000;
const MAX_EVENTS = 5000;
const ACTIVITY_ROWS = 30;
const FILE_WINDOW_DAYS = 90;

type OverviewUser = Parameters<typeof listAccessibleMailboxIds>[1];
type EventRow = { kind: "open" | "click"; at: Date; messageId: string; subject: string | null; toAddr: string; copyRecipient: string; mailboxId: string | null; threadId: string | null; sentAt: Date; client: string | null; device: string | null; city: string | null; country: string | null; url: string | null };

function chunks<T>(items: T[], size = 500): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
	return result;
}

const recipientOf = (copyRecipient: string, toAddr: string) => displayRecipient(copyRecipient || getFirstEmailAddressEntry(toAddr) || null);

/** The Tracking dashboard for the mailboxes `user` can read, bucketed by day in `timeZone`. */
export async function getTrackingOverview(env: CloudflareEnv, user: OverviewUser, input: { days: number; timeZone: string; now?: Date }): Promise<TrackingOverview> {
	const now = input.now ?? new Date();
	const empty: TrackingOverview = { days: input.days, totals: { sent: 0, opened: 0, clicked: 0, replied: 0 }, daily: buildDailySeries(input.days, now, input.timeZone, { sent: [], opens: [], clicks: [] }), warm: [], followUps: [], activity: [], files: [] };
	const db = getDb(env);
	const mailboxIds = await listAccessibleMailboxIds(db, user);
	if (mailboxIds.length === 0) return empty;
	// A day of slack so the oldest bucket is whole in every time zone.
	const since = new Date(now.getTime() - (input.days + 1) * DAY_MS);
	const ownSent = and(inArray(messages.mailboxId, mailboxIds), eq(messages.direction, "outbound"));

	let sent: Array<{ id: string; mailboxId: string | null; threadId: string | null; createdAt: Date }>;
	try {
		sent = await db
			.selectDistinct({ id: messages.id, mailboxId: messages.mailboxId, threadId: messages.threadId, createdAt: messages.createdAt })
			.from(messages)
			.innerJoin(messageTracking, eq(messageTracking.messageId, messages.id))
			.where(and(ownSent, gte(messages.createdAt, since)))
			.orderBy(desc(messages.createdAt))
			.limit(MAX_MESSAGES);
	} catch (error) {
		if (isMissingTableError(error)) return empty;
		throw error;
	}

	const eventColumns = {
		messageId: messages.id, subject: messages.subject, toAddr: messages.toAddr, copyRecipient: messageTracking.recipient,
		mailboxId: messages.mailboxId, threadId: messages.threadId, sentAt: messages.createdAt,
	};
	const [opens, clicks] = await Promise.all([
		db
			.select({ ...eventColumns, at: messageOpens.openedAt, client: messageOpens.client, device: messageOpens.device, city: messageOpens.city, country: messageOpens.country })
			.from(messageOpens)
			.innerJoin(messageTracking, eq(messageTracking.token, messageOpens.token))
			.innerJoin(messages, eq(messages.id, messageTracking.messageId))
			.where(and(ownSent, eq(messageOpens.automated, false), gte(messageOpens.openedAt, since)))
			.orderBy(desc(messageOpens.openedAt))
			.limit(MAX_EVENTS),
		db
			.select({ ...eventColumns, at: messageLinkClicks.clickedAt, client: messageLinkClicks.client, device: messageLinkClicks.device, city: messageLinkClicks.city, country: messageLinkClicks.country, url: messageLinks.url })
			.from(messageLinkClicks)
			.innerJoin(messageLinks, eq(messageLinks.id, messageLinkClicks.linkId))
			.innerJoin(messageTracking, eq(messageTracking.token, messageLinks.token))
			.innerJoin(messages, eq(messages.id, messageTracking.messageId))
			.where(and(ownSent, eq(messageLinkClicks.automated, false), gte(messageLinkClicks.clickedAt, since)))
			.orderBy(desc(messageLinkClicks.clickedAt))
			.limit(MAX_EVENTS)
			.catch((error) => {
				if (isMissingTableError(error)) return [];
				throw error;
			}),
	]);
	const events: EventRow[] = [
		...opens.map((row) => ({ ...row, kind: "open" as const, url: null })),
		...clicks.map((row) => ({ ...row, kind: "click" as const })),
	].sort((a, b) => b.at.getTime() - a.at.getTime());

	// Totals: of the tracked messages sent in the period.
	const states = new Map<string, MessageTrackingState>();
	const replied = new Set<string>();
	for (const chunk of chunks(sent)) {
		for (const [id, state] of await getTrackingStates(env, chunk.map((row) => row.id))) states.set(id, state);
		for (const id of await getRepliedMessageIds(env, chunk)) replied.add(id);
	}
	const inPeriod = sent.filter((row) => row.createdAt.getTime() >= now.getTime() - input.days * DAY_MS);
	const totals = {
		sent: inPeriod.length,
		opened: inPeriod.filter((row) => states.get(row.id)?.state === "opened").length,
		clicked: inPeriod.filter((row) => (states.get(row.id)?.clicks ?? 0) > 0).length,
		replied: inPeriod.filter((row) => replied.has(row.id)).length,
	};

	// Warm: recent activity on messages that have not been answered (including ones sent before the period).
	const warmSince = new Date(now.getTime() - WARM_WINDOW_MS);
	const warmCandidates = [...new Map(events.filter((event) => event.at >= warmSince).map((event) => [event.messageId, event])).values()];
	const warmReplied = await getRepliedMessageIds(env, warmCandidates.map((event) => ({ id: event.messageId, mailboxId: event.mailboxId, threadId: event.threadId, createdAt: event.sentAt })));
	const warm = pickWarmMessages(events.map((event) => ({ ...event, recipient: recipientOf(event.copyRecipient, event.toAddr) })), warmSince, warmReplied);

	const fileNames = await getSharedFileNames(env, [...new Set(events.map((event) => event.url).filter((url): url is string => !!url))]);
	const activity: OverviewEvent[] = events.slice(0, ACTIVITY_ROWS).map((event) => ({
		kind: event.kind,
		at: event.at.toISOString(),
		messageId: event.messageId,
		subject: event.subject,
		recipient: recipientOf(event.copyRecipient, event.toAddr),
		client: event.client,
		device: event.device,
		city: event.city,
		country: event.country,
		url: event.url,
		fileName: event.url ? fileNames.get(event.url) ?? null : null,
	}));

	const due = await listDueFollowUps(env, user.id);
	const dueStates = due.length ? await getTrackingStates(env, due.map((item) => item.messageId)) : new Map();
	const followUps = due.slice(0, 10).map((item) => ({
		messageId: item.messageId,
		subject: item.subject,
		recipient: displayRecipient(getFirstEmailAddressEntry(item.toAddr) || null),
		dueAt: item.dueAt,
		opens: dueStates.get(item.messageId)?.opens ?? 0,
	}));

	return {
		days: input.days,
		totals,
		daily: buildDailySeries(input.days, now, input.timeZone, { sent: sent.map((row) => row.createdAt), opens: opens.map((row) => row.at), clicks: clicks.map((row) => row.at) }),
		warm,
		followUps,
		activity,
		files: await listTrackedFiles(env, mailboxIds, new Date(now.getTime() - FILE_WINDOW_DAYS * DAY_MS)),
	};
}

/** Files sent as tracked links: one row per file and message, most recently sent first. */
async function listTrackedFiles(env: CloudflareEnv, mailboxIds: string[], since: Date): Promise<OverviewFile[]> {
	try {
		const rows = await getDb(env)
			.select({ url: messageLinks.url, clicks: messageLinks.clickCount, lastClickedAt: messageLinks.lastClickedAt, messageId: messages.id, subject: messages.subject, toAddr: messages.toAddr, copyRecipient: messageTracking.recipient, sentAt: messages.createdAt })
			.from(messageLinks)
			.innerJoin(messageTracking, eq(messageTracking.token, messageLinks.token))
			.innerJoin(messages, eq(messages.id, messageTracking.messageId))
			.where(and(inArray(messages.mailboxId, mailboxIds), like(messageLinks.url, "%/api/shared-files/%"), gte(messages.createdAt, since)))
			.orderBy(desc(messages.createdAt))
			.limit(500);
		const names = await getSharedFileNames(env, [...new Set(rows.map((row) => row.url))]);
		// Separate copies carry one link each; a file reads as one row per message.
		const merged = new Map<string, OverviewFile>();
		for (const row of rows) {
			const fileName = names.get(row.url);
			if (!fileName) continue;
			const key = `${row.messageId}:${fileName}`;
			const entry = merged.get(key) ?? { fileName, messageId: row.messageId, subject: row.subject, recipient: displayRecipient(getFirstEmailAddressEntry(row.toAddr) || null), clicks: 0, lastClickedAt: null, sentAt: row.sentAt.toISOString() };
			entry.clicks += row.clicks;
			const last = row.lastClickedAt?.toISOString() ?? null;
			if (last && (!entry.lastClickedAt || last > entry.lastClickedAt)) entry.lastClickedAt = last;
			merged.set(key, entry);
		}
		return [...merged.values()].slice(0, 50);
	} catch (error) {
		if (isMissingTableError(error)) return [];
		throw error;
	}
}
