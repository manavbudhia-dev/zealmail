import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { followUps, messageTracking, messages } from "@/db/schema";
import { getFirstEmailAddressEntry } from "@/lib/email/address";
import { newId } from "@/lib/ids";
import { sendPushContent } from "@/lib/push/server";
import { DEFAULT_HOT_OPEN_THRESHOLD, getStoredTrackingPreferences } from "./preferences";
import { getSharedFileNames } from "./shared-file-names";
import { sendTelegramMessage } from "./telegram";
import { formatTelegramAlert } from "./telegram-utils";

export type TrackingEvent = { kind: "open"; token: string } | { kind: "click"; token: string; url: string };

/**
 * Runs after a real (not automated) open or click is counted: Telegram alerts for a copy's first
 * open and for clicks, and the "opened N times" follow-up once a message's real opens reach the
 * sender's threshold without a reply. Never throws; the recipient's request must not fail.
 */
export async function notifyTrackingEvent(env: CloudflareEnv, event: TrackingEvent): Promise<void> {
	try {
		const db = getDb(env);
		const [copy] = await db
			.select({
				messageId: messages.id,
				userId: messages.userId,
				subject: messages.subject,
				toAddr: messages.toAddr,
				mailboxId: messages.mailboxId,
				threadId: messages.threadId,
				createdAt: messages.createdAt,
				recipient: messageTracking.recipient,
				openCount: messageTracking.openCount,
			})
			.from(messageTracking)
			.innerJoin(messages, eq(messages.id, messageTracking.messageId))
			.where(eq(messageTracking.token, event.token))
			.limit(1);
		if (!copy) return;
		const preferences = await getStoredTrackingPreferences(env, copy.userId);
		const recipient = copy.recipient || getFirstEmailAddressEntry(copy.toAddr) || null;
		const chatId = env.TELEGRAM_BOT_TOKEN?.trim() ? preferences?.telegramChatId ?? null : null;
		const telegram = (text: string) => chatId
			? sendTelegramMessage(env, chatId, text).catch((error) => console.error("Telegram alert failed", error))
			: Promise.resolve();

		if (event.kind === "click") {
			if (preferences?.telegramClicks === false) return;
			const fileName = (await getSharedFileNames(env, [event.url])).get(event.url) ?? null;
			await telegram(formatTelegramAlert({ kind: "click", subject: copy.subject, recipient, url: event.url, fileName }));
			return;
		}

		if (copy.openCount === 1 && preferences?.telegramOpens !== false) {
			await telegram(formatTelegramAlert({ kind: "open", subject: copy.subject, recipient }));
		}
		const threshold = preferences?.hotOpenThreshold ?? DEFAULT_HOT_OPEN_THRESHOLD;
		if (threshold <= 0) return;
		const [total] = await db
			.select({ opens: sql<number>`sum(${messageTracking.openCount})` })
			.from(messageTracking)
			.where(eq(messageTracking.messageId, copy.messageId));
		// Exactly at the threshold, so each message alerts once however often it is opened after.
		if (Number(total?.opens ?? 0) !== threshold) return;
		if (copy.threadId && copy.mailboxId) {
			const [reply] = await db
				.select({ id: messages.id })
				.from(messages)
				.where(and(eq(messages.mailboxId, copy.mailboxId), eq(messages.threadId, copy.threadId), eq(messages.direction, "inbound"), gt(messages.createdAt, copy.createdAt)))
				.limit(1);
			if (reply) return;
		}
		if (!(await makeFollowUpDue(env, copy.messageId, copy.userId))) return;
		const body = `Opened ${threshold}× without a reply: ${copy.subject?.trim() || "(no subject)"}`;
		await Promise.all([
			sendPushContent(env, [copy.userId], { title: "Time to follow up", body, tag: `follow-up-${copy.messageId}`, url: `/sent/${copy.messageId}` })
				.catch((error) => console.error("Follow-up push failed", error)),
			telegram(formatTelegramAlert({ kind: "hot", subject: copy.subject, recipient, opens: threshold })),
		]);
	} catch (error) {
		console.error("Tracking alert failed", error);
	}
}

/**
 * Surfaces the message among due follow-ups now: a waiting reminder comes due early, and a message
 * without one gets one. A reminder already due, answered or dismissed is left alone (and not re-alerted).
 */
export async function makeFollowUpDue(env: CloudflareEnv, messageId: string, userId: string): Promise<boolean> {
	const db = getDb(env);
	const now = new Date();
	const [existing] = await db.select({ id: followUps.id, status: followUps.status }).from(followUps).where(eq(followUps.messageId, messageId)).limit(1);
	if (!existing) {
		const inserted = await db
			.insert(followUps)
			.values({ id: newId("fup"), messageId, userId, dueAt: now, status: "due" })
			.onConflictDoNothing()
			.returning({ id: followUps.id });
		return inserted.length > 0;
	}
	if (existing.status !== "pending") return false;
	const updated = await db
		.update(followUps)
		.set({ status: "due", dueAt: now })
		.where(and(eq(followUps.id, existing.id), eq(followUps.status, "pending")))
		.returning({ id: followUps.id });
	return updated.length > 0;
}
