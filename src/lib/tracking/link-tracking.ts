import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messageLinkClicks, messageLinks, messageTracking, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { classifyClick, MAX_STORED_CLICKS } from "./link-tracking-utils";
import { getSharedFileNames } from "./shared-file-names";
import { notifyTrackingEvent } from "./alerts";
import { createTrackingToken, isDuplicateOpen } from "./open-tracking-utils";
import type { MessageLinkSummary } from "./types";

/**
 * Click ids for each URL of a tracked message, creating the missing ones.
 * Re-running a delivery reuses the ids it created before, so retries send the same links.
 */
export async function ensureTrackedLinks(env: CloudflareEnv, token: string, urls: string[]): Promise<Map<string, string>> {
	const ids = new Map<string, string>();
	if (urls.length === 0) return ids;
	const db = getDb(env);
	const existing = await db.select({ id: messageLinks.id, url: messageLinks.url }).from(messageLinks).where(eq(messageLinks.token, token));
	for (const row of existing) ids.set(row.url, row.id);
	const missing = urls.filter((url) => !ids.has(url));
	if (missing.length > 0) {
		const createdAt = new Date();
		const rows = missing.map((url) => ({ id: createTrackingToken(), token, url, createdAt }));
		await db.insert(messageLinks).values(rows);
		for (const row of rows) ids.set(row.url, row.id);
	}
	return ids;
}

/**
 * Records one click and returns the link's target, or null for an unknown id.
 * The target always comes from the stored row, so the endpoint cannot be used as an open redirect.
 */
export async function recordClick(
	env: CloudflareEnv,
	linkId: string,
	request: { method: string; userAgent: string | null; country?: string | null; city?: string | null },
): Promise<string | null> {
	const db = getDb(env);
	const [link] = await db
		.select({ url: messageLinks.url, token: messageLinks.token, sentAt: messageTracking.createdAt, direction: messages.direction })
		.from(messageLinks)
		.innerJoin(messageTracking, eq(messageTracking.token, messageLinks.token))
		.innerJoin(messages, eq(messages.id, messageTracking.messageId))
		.where(eq(messageLinks.id, linkId))
		.limit(1);
	if (!link) return null;
	if (link.direction !== "outbound") return link.url;

	try {
		const clickedAt = new Date();
		const click = classifyClick({ ...request, sentAt: link.sentAt, clickedAt });
		const recent = await db
			.select({ openedAt: messageLinkClicks.clickedAt, client: messageLinkClicks.client, device: messageLinkClicks.device })
			.from(messageLinkClicks)
			.where(eq(messageLinkClicks.linkId, linkId))
			.orderBy(desc(messageLinkClicks.clickedAt))
			.limit(MAX_STORED_CLICKS);
		if (isDuplicateOpen(recent[0], { openedAt: clickedAt, client: click.client, device: click.device })) return link.url;
		if (recent.length < MAX_STORED_CLICKS) {
			await db.insert(messageLinkClicks).values({ id: newId("click"), linkId, clickedAt, ...click });
		}
		if (!click.automated) {
			await db
				.update(messageLinks)
				.set({
					clickCount: sql`${messageLinks.clickCount} + 1`,
					firstClickedAt: sql`coalesce(${messageLinks.firstClickedAt}, ${Math.floor(clickedAt.getTime() / 1000)})`,
					lastClickedAt: clickedAt,
				})
				.where(eq(messageLinks.id, linkId));
			await notifyTrackingEvent(env, { kind: "click", token: link.token, url: link.url });
		}
	} catch (error) {
		// The recipient still reaches the link when bookkeeping fails.
		console.error("Recording a link click failed", error);
	}
	return link.url;
}

/** Links of the given copies, by tracking token, in the order they appear in the message. */
export async function getLinkSummaries(env: CloudflareEnv, tokens: string[]): Promise<Map<string, MessageLinkSummary[]>> {
	const byToken = new Map<string, MessageLinkSummary[]>();
	if (tokens.length === 0) return byToken;
	const db = getDb(env);
	const links = await db
		.select({ id: messageLinks.id, token: messageLinks.token, url: messageLinks.url, clickCount: messageLinks.clickCount, lastClickedAt: messageLinks.lastClickedAt })
		.from(messageLinks)
		.where(inArray(messageLinks.token, tokens))
		.orderBy(messageLinks.createdAt);
	if (links.length === 0) return byToken;
	const automated = await db
		.select({ linkId: messageLinkClicks.linkId, total: sql<number>`count(*)` })
		.from(messageLinkClicks)
		.where(and(inArray(messageLinkClicks.linkId, links.map((link) => link.id)), eq(messageLinkClicks.automated, true)))
		.groupBy(messageLinkClicks.linkId);
	const automatedByLink = new Map(automated.map((row) => [row.linkId, Number(row.total)]));
	const fileNames = await getSharedFileNames(env, links.map((link) => link.url));
	for (const link of links) {
		const list = byToken.get(link.token) ?? [];
		list.push({
			url: link.url,
			clickCount: link.clickCount,
			lastClickedAt: link.lastClickedAt?.toISOString() ?? null,
			automatedClicks: automatedByLink.get(link.id) ?? 0,
			...(fileNames.has(link.url) ? { fileName: fileNames.get(link.url) } : {}),
		});
		byToken.set(link.token, list);
	}
	return byToken;
}

export type ClickTotals = { clicks: number; automated: number; lastClickedAt: Date | null };

/** Real and automated click totals per tracking token. */
export async function getClickTotals(env: CloudflareEnv, tokens: string[]): Promise<Map<string, ClickTotals>> {
	const totals = new Map<string, ClickTotals>();
	if (tokens.length === 0) return totals;
	const db = getDb(env);
	const [clickRows, automatedRows] = await Promise.all([
		db
			.select({ token: messageLinks.token, clicks: sql<number>`sum(${messageLinks.clickCount})`, lastClickedAt: max(messageLinks.lastClickedAt) })
			.from(messageLinks)
			.where(inArray(messageLinks.token, tokens))
			.groupBy(messageLinks.token),
		db
			.select({ token: messageLinks.token, total: sql<number>`count(*)` })
			.from(messageLinkClicks)
			.innerJoin(messageLinks, eq(messageLinks.id, messageLinkClicks.linkId))
			.where(and(inArray(messageLinks.token, tokens), eq(messageLinkClicks.automated, true)))
			.groupBy(messageLinks.token),
	]);
	for (const row of clickRows) totals.set(row.token, { clicks: Number(row.clicks ?? 0), automated: 0, lastClickedAt: row.lastClickedAt ?? null });
	for (const row of automatedRows) {
		const entry = totals.get(row.token) ?? { clicks: 0, automated: 0, lastClickedAt: null };
		entry.automated = Number(row.total);
		totals.set(row.token, entry);
	}
	return totals;
}
