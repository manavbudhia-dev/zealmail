import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { messageLinkClicks, messageLinks, messageOpens, messageTracking, messages } from "@/db/schema";
import { getEmailAddressList, getFirstEmailAddressEntry } from "@/lib/email/address";
import { listAccessibleMailboxIds } from "@/lib/mailboxes/access";
import { getTrackingStates } from "./open-tracking";
import type { MessageTrackingState } from "./types";
import { sortEngagement, tickStateLabel, toCsv, type ContactEngagement } from "./report-utils";

/** Reports cover tracked messages sent in this window, newest first, up to this many. */
export const REPORT_WINDOW_DAYS = 365;
const MAX_REPORT_MESSAGES = 5000;
const MAX_ACTIVITY_ROWS = 20_000;

type ReportUser = Parameters<typeof listAccessibleMailboxIds>[1];
type Copy = { messageId: string; token: string; recipient: string; openCount: number; lastOpenedAt: Date | null };
type TrackedMessage = { id: string; createdAt: Date; fromAddr: string; toAddr: string; ccAddr: string | null; bccAddr: string | null; subject: string | null; mailboxId: string | null; threadId: string | null };

/** Tracked outbound messages in mailboxes the user can read, with their copies. */
async function loadTrackedMessages(env: CloudflareEnv, user: ReportUser): Promise<{ list: TrackedMessage[]; copies: Copy[] }> {
	const db = getDb(env);
	const mailboxIds = await listAccessibleMailboxIds(db, user);
	if (mailboxIds.length === 0) return { list: [], copies: [] };
	const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60_000);
	const list = await db
		.selectDistinct({
			id: messages.id,
			createdAt: messages.createdAt,
			fromAddr: messages.fromAddr,
			toAddr: messages.toAddr,
			ccAddr: messages.ccAddr,
			bccAddr: messages.bccAddr,
			subject: messages.subject,
			mailboxId: messages.mailboxId,
			threadId: messages.threadId,
		})
		.from(messages)
		.innerJoin(messageTracking, eq(messageTracking.messageId, messages.id))
		.where(and(inArray(messages.mailboxId, mailboxIds), eq(messages.direction, "outbound"), gte(messages.createdAt, since)))
		.orderBy(desc(messages.createdAt))
		.limit(MAX_REPORT_MESSAGES);
	const copies: Copy[] = [];
	for (const chunk of chunks(list.map((message) => message.id), 500)) {
		copies.push(...await db
			.select({ messageId: messageTracking.messageId, token: messageTracking.token, recipient: messageTracking.recipient, openCount: messageTracking.openCount, lastOpenedAt: messageTracking.lastOpenedAt })
			.from(messageTracking)
			.where(inArray(messageTracking.messageId, chunk)));
	}
	return { list, copies };
}

function chunks<T>(items: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
	return result;
}

async function clickTotalsByToken(env: CloudflareEnv, tokens: string[]): Promise<Map<string, { clicks: number; last: Date | null }>> {
	const totals = new Map<string, { clicks: number; last: Date | null }>();
	for (const chunk of chunks(tokens, 500)) {
		const rows = await getDb(env)
			.select({ token: messageLinks.token, clicks: messageLinks.clickCount, last: messageLinks.lastClickedAt })
			.from(messageLinks)
			.where(inArray(messageLinks.token, chunk));
		for (const row of rows) {
			const entry = totals.get(row.token) ?? { clicks: 0, last: null };
			entry.clicks += row.clicks;
			if (row.last && (!entry.last || row.last > entry.last)) entry.last = row.last;
			totals.set(row.token, entry);
		}
	}
	return totals;
}

/** Inbound replies per sent message: who replied and when (first reply per sender). */
async function repliesByMessage(env: CloudflareEnv, list: TrackedMessage[]): Promise<Map<string, Map<string, Date>>> {
	const replies = new Map<string, Map<string, Date>>();
	const threaded = list.filter((message) => message.threadId && message.mailboxId);
	const byThread = new Map<string, TrackedMessage[]>();
	for (const message of threaded) {
		const key = `${message.mailboxId}:${message.threadId}`;
		byThread.set(key, [...(byThread.get(key) ?? []), message]);
	}
	for (const chunk of chunks([...new Set(threaded.map((message) => message.threadId!))], 500)) {
		const rows = await getDb(env)
			.select({ mailboxId: messages.mailboxId, threadId: messages.threadId, fromAddr: messages.fromAddr, createdAt: messages.createdAt })
			.from(messages)
			.where(and(inArray(messages.threadId, chunk), eq(messages.direction, "inbound")));
		for (const row of rows) {
			for (const message of byThread.get(`${row.mailboxId}:${row.threadId}`) ?? []) {
				if (row.createdAt <= message.createdAt) continue;
				const address = getEmailAddressList(row.fromAddr)[0];
				if (!address) continue;
				const perMessage = replies.get(message.id) ?? new Map<string, Date>();
				const seen = perMessage.get(address);
				if (!seen || row.createdAt < seen) perMessage.set(address, row.createdAt);
				replies.set(message.id, perMessage);
			}
		}
	}
	return replies;
}

function recipientsOf(message: TrackedMessage): string[] {
	return [...new Set([message.toAddr, message.ccAddr, message.bccAddr].flatMap((value) => getEmailAddressList(value)))];
}

/**
 * Per-recipient engagement across tracked messages. Opens and clicks are attributed only where they
 * can be: a separate copy, or a shared copy sent to a single person. Group sends count as sent.
 */
export async function listContactEngagement(env: CloudflareEnv, user: ReportUser): Promise<ContactEngagement[]> {
	const { list, copies } = await loadTrackedMessages(env, user);
	if (list.length === 0) return [];
	const [clicks, replies] = await Promise.all([clickTotalsByToken(env, copies.map((copy) => copy.token)), repliesByMessage(env, list)]);
	const copiesByMessage = new Map<string, Copy[]>();
	for (const copy of copies) copiesByMessage.set(copy.messageId, [...(copiesByMessage.get(copy.messageId) ?? []), copy]);
	const contacts = new Map<string, ContactEngagement>();
	const touch = (address: string) => {
		let entry = contacts.get(address);
		if (!entry) {
			entry = { address, sent: 0, opened: 0, opens: 0, clicks: 0, replied: 0, lastActivityAt: null };
			contacts.set(address, entry);
		}
		return entry;
	};
	const bump = (entry: ContactEngagement, when: Date | null) => {
		if (when && (!entry.lastActivityAt || when.toISOString() > entry.lastActivityAt)) entry.lastActivityAt = when.toISOString();
	};
	for (const message of list) {
		const recipients = recipientsOf(message);
		const messageCopies = copiesByMessage.get(message.id) ?? [];
		const separate = messageCopies.filter((copy) => copy.recipient);
		const attributable = separate.length
			? separate.map((copy) => ({ address: copy.recipient, copy }))
			: recipients.length === 1 && messageCopies[0] ? [{ address: recipients[0], copy: messageCopies[0] }] : [];
		for (const address of recipients) touch(address).sent += 1;
		for (const { address, copy } of attributable) {
			const entry = touch(address);
			const clicked = clicks.get(copy.token);
			entry.opens += copy.openCount;
			entry.clicks += clicked?.clicks ?? 0;
			if (copy.openCount > 0 || (clicked?.clicks ?? 0) > 0) entry.opened += 1;
			bump(entry, copy.lastOpenedAt);
			bump(entry, clicked?.last ?? null);
		}
		for (const [address, when] of replies.get(message.id) ?? []) {
			if (!recipients.includes(address)) continue;
			const entry = touch(address);
			entry.replied += 1;
			bump(entry, when);
		}
	}
	return sortEngagement([...contacts.values()]);
}

/** One row per tracked message, plus one per recipient for messages sent as separate copies. */
export async function exportTrackedMessagesCsv(env: CloudflareEnv, user: ReportUser): Promise<string> {
	const { list, copies } = await loadTrackedMessages(env, user);
	const [states, clicks, replies] = await Promise.all([
		getTrackingStatesChunked(env, list.map((message) => message.id)),
		clickTotalsByToken(env, copies.map((copy) => copy.token)),
		repliesByMessage(env, list),
	]);
	const copiesByMessage = new Map<string, Copy[]>();
	for (const copy of copies) copiesByMessage.set(copy.messageId, [...(copiesByMessage.get(copy.messageId) ?? []), copy]);
	const rows: Array<Array<string | number | null>> = [];
	for (const message of list) {
		const state = states.get(message.id);
		const replied = replies.get(message.id);
		rows.push([
			message.createdAt.toISOString(), message.fromAddr, message.subject, message.toAddr, message.ccAddr, "",
			state ? tickStateLabel(state.state) : "", state?.opens ?? 0, state?.clicks ?? 0, replied?.size ? "yes" : "no",
		]);
		for (const copy of (copiesByMessage.get(message.id) ?? []).filter((item) => item.recipient)) {
			const copyClicks = clicks.get(copy.token)?.clicks ?? 0;
			rows.push([
				message.createdAt.toISOString(), message.fromAddr, message.subject, message.toAddr, message.ccAddr, copy.recipient,
				copy.openCount > 0 || copyClicks > 0 ? "opened" : "not opened", copy.openCount, copyClicks, replied?.has(copy.recipient) ? "yes" : "no",
			]);
		}
	}
	return toCsv(["sent_at", "from", "subject", "to", "cc", "copy_for", "status", "opens", "clicks", "replied"], rows);
}

async function getTrackingStatesChunked(env: CloudflareEnv, ids: string[]): Promise<Map<string, MessageTrackingState>> {
	const states = new Map<string, MessageTrackingState>();
	for (const chunk of chunks(ids, 500)) for (const [id, state] of await getTrackingStates(env, chunk)) states.set(id, state);
	return states;
}

/** Every recorded open and click (automated ones flagged), newest first. */
export async function exportTrackingActivityCsv(env: CloudflareEnv, user: ReportUser): Promise<string> {
	const { list, copies } = await loadTrackedMessages(env, user);
	const messageById = new Map(list.map((message) => [message.id, message]));
	const copyByToken = new Map(copies.map((copy) => [copy.token, copy]));
	const db = getDb(env);
	type Event = { at: Date; type: string; token: string; url: string | null; client: string | null; device: string | null; country: string | null; city: string | null; automated: boolean };
	const events: Event[] = [];
	for (const chunk of chunks([...copyByToken.keys()], 500)) {
		const [opens, clicks] = await Promise.all([
			db.select().from(messageOpens).where(inArray(messageOpens.token, chunk)),
			db
				.select({ at: messageLinkClicks.clickedAt, token: messageLinks.token, url: messageLinks.url, client: messageLinkClicks.client, device: messageLinkClicks.device, country: messageLinkClicks.country, city: messageLinkClicks.city, automated: messageLinkClicks.automated })
				.from(messageLinkClicks)
				.innerJoin(messageLinks, eq(messageLinks.id, messageLinkClicks.linkId))
				.where(inArray(messageLinks.token, chunk)),
		]);
		for (const open of opens) events.push({ at: open.openedAt, type: "open", token: open.token, url: null, client: open.client, device: open.device, country: open.country, city: open.city, automated: open.automated });
		for (const click of clicks) events.push({ ...click, type: "click" });
		if (events.length > MAX_ACTIVITY_ROWS) break;
	}
	events.sort((a, b) => b.at.getTime() - a.at.getTime());
	const rows = events.slice(0, MAX_ACTIVITY_ROWS).map((event) => {
		const copy = copyByToken.get(event.token);
		const message = copy ? messageById.get(copy.messageId) : undefined;
		return [
			event.at.toISOString(), event.type, message?.subject ?? null,
			copy?.recipient || (message ? getFirstEmailAddressEntry(message.toAddr) : null), event.url,
			event.client, event.device, event.country, event.city, event.automated ? "yes" : "no",
		];
	});
	return toCsv(["time", "type", "subject", "recipient", "url", "client", "device", "country", "city", "automated"], rows);
}
