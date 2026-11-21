import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messageLinkClicks, messageLinks, messageOpens, messageTracking, messages, users, userTrackingPreferences } from "@/db/schema";
import { isMissingTableError } from "@/lib/database-errors";
import { getFirstEmailAddressEntry } from "@/lib/email/address";
import { sendSystemEmail } from "@/lib/email/system-mail";
import type { SummaryFrequency } from "./preferences-types";
import { dueSummaryFrequencies, formatTrackingSummary, summaryPeriodStart, summaryRecentlySent, type TrackingSummaryData } from "./summary-utils";

const TOP_ROWS = 10;
const USERS_PER_RUN = 200;

/** Daily cron: emails each user who asked for one their daily (or, on Mondays, weekly) summary. */
export async function runTrackingSummaries(env: CloudflareEnv, now: Date): Promise<void> {
	const db = getDb(env);
	let subscribers: Array<{ userId: string; email: string; frequency: SummaryFrequency; lastSentAt: Date | null }>;
	try {
		subscribers = await db
			.select({ userId: users.id, email: users.email, frequency: userTrackingPreferences.summaryFrequency, lastSentAt: userTrackingPreferences.summaryLastSentAt })
			.from(userTrackingPreferences)
			.innerJoin(users, eq(users.id, userTrackingPreferences.userId))
			.where(and(inArray(userTrackingPreferences.summaryFrequency, dueSummaryFrequencies(now)), eq(users.disabled, false)))
			.limit(USERS_PER_RUN);
	} catch (error) {
		if (isMissingTableError(error)) return;
		throw error;
	}
	for (const subscriber of subscribers) {
		if (summaryRecentlySent(subscriber.lastSentAt, subscriber.frequency, now)) continue;
		try {
			// Claim first, so overlapping runs send once.
			const claimed = await db
				.update(userTrackingPreferences)
				.set({ summaryLastSentAt: now })
				.where(and(
					eq(userTrackingPreferences.userId, subscriber.userId),
					subscriber.lastSentAt ? eq(userTrackingPreferences.summaryLastSentAt, subscriber.lastSentAt) : isNull(userTrackingPreferences.summaryLastSentAt),
				))
				.returning({ userId: userTrackingPreferences.userId });
			if (!claimed.length) continue;
			const data = await collectTrackingSummary(env, subscriber.userId, summaryPeriodStart(subscriber.frequency, now), now);
			// Nothing happened and nothing was sent: skip the empty email.
			if (data.sent === 0 && data.opened === 0 && data.clicks === 0 && data.replies === 0) continue;
			const mail = formatTrackingSummary(data, subscriber.frequency, env.APP_URL?.trim() || null);
			const sent = await sendSystemEmail(env, { to: subscriber.email, ...mail });
			if (!sent) console.warn("Read-receipt summary skipped: no domain can send system mail");
		} catch (error) {
			console.error(`Read-receipt summary for ${subscriber.userId} failed`, error);
		}
	}
}

/** Activity on the user's tracked messages between `since` and `until`. */
export async function collectTrackingSummary(env: CloudflareEnv, userId: string, since: Date, until: Date): Promise<TrackingSummaryData> {
	const db = getDb(env);
	const own = and(eq(messages.userId, userId), eq(messages.direction, "outbound"));
	const [sentRows, openRows, clickRows] = await Promise.all([
		db
			.select({ total: sql<number>`count(distinct ${messages.id})` })
			.from(messageTracking)
			.innerJoin(messages, eq(messages.id, messageTracking.messageId))
			.where(and(own, gte(messageTracking.createdAt, since), lt(messageTracking.createdAt, until))),
		db
			.select({ messageId: messages.id, opens: sql<number>`count(*)` })
			.from(messageOpens)
			.innerJoin(messageTracking, eq(messageTracking.token, messageOpens.token))
			.innerJoin(messages, eq(messages.id, messageTracking.messageId))
			.where(and(own, eq(messageOpens.automated, false), gte(messageOpens.openedAt, since), lt(messageOpens.openedAt, until)))
			.groupBy(messages.id),
		db
			.select({ messageId: messages.id, clicks: sql<number>`count(*)` })
			.from(messageLinkClicks)
			.innerJoin(messageLinks, eq(messageLinks.id, messageLinkClicks.linkId))
			.innerJoin(messageTracking, eq(messageTracking.token, messageLinks.token))
			.innerJoin(messages, eq(messages.id, messageTracking.messageId))
			.where(and(own, eq(messageLinkClicks.automated, false), gte(messageLinkClicks.clickedAt, since), lt(messageLinkClicks.clickedAt, until)))
			.groupBy(messages.id),
	]);
	const opensBy = new Map(openRows.map((row) => [row.messageId, Number(row.opens)]));
	const clicksBy = new Map(clickRows.map((row) => [row.messageId, Number(row.clicks)]));

	// Replies that arrived in the period to the user's tracked messages.
	const replied = await db
		.selectDistinct({ messageId: messages.id })
		.from(messages)
		.innerJoin(messageTracking, eq(messageTracking.messageId, messages.id))
		.where(and(own, sql`exists (
			select 1 from messages reply
			where reply.thread_id = ${messages.threadId}
				and reply.mailbox_id = ${messages.mailboxId}
				and reply.direction = 'inbound'
				and reply.created_at > ${messages.createdAt}
				and reply.created_at >= ${Math.floor(since.getTime() / 1000)}
				and reply.created_at < ${Math.floor(until.getTime() / 1000)}
		)`));
	const repliedIds = new Set(replied.map((row) => row.messageId));

	const active = [...new Set([...opensBy.keys(), ...clicksBy.keys(), ...repliedIds])];
	const details = active.length
		? await db
			.select({ id: messages.id, subject: messages.subject, toAddr: messages.toAddr })
			.from(messages)
			.where(inArray(messages.id, active.slice(0, 500)))
		: [];
	const top = details
		.map((row) => ({
			subject: row.subject,
			recipient: getFirstEmailAddressEntry(row.toAddr) || null,
			opens: opensBy.get(row.id) ?? 0,
			clicks: clicksBy.get(row.id) ?? 0,
			replied: repliedIds.has(row.id),
		}))
		.sort((a, b) => (b.opens + b.clicks + (b.replied ? 1 : 0)) - (a.opens + a.clicks + (a.replied ? 1 : 0)))
		.slice(0, TOP_ROWS);
	return {
		sent: Number(sentRows[0]?.total ?? 0),
		opened: opensBy.size,
		clicks: [...clicksBy.values()].reduce((total, value) => total + value, 0),
		replies: repliedIds.size,
		top,
	};
}
