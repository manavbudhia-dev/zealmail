import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messageLinkClicks, messageLinks, messageTracking, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { classifyClick, MAX_STORED_CLICKS } from "./link-tracking-utils";
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
		.select({ url: messageLinks.url, sentAt: messageTracking.createdAt, direction: messages.direction })
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
		}
	} catch (error) {
		// The recipient still reaches the link when bookkeeping fails.
		console.error("Recording a link click failed", error);
	}
	return link.url;
}

export async function getLinkSummaries(env: CloudflareEnv, token: string): Promise<MessageLinkSummary[]> {
	const db = getDb(env);
	const links = await db
		.select({ id: messageLinks.id, url: messageLinks.url, clickCount: messageLinks.clickCount, lastClickedAt: messageLinks.lastClickedAt })
		.from(messageLinks)
		.where(eq(messageLinks.token, token))
		.orderBy(messageLinks.createdAt);
	if (links.length === 0) return [];
	const automated = await db
		.select({ linkId: messageLinkClicks.linkId, total: sql<number>`count(*)` })
		.from(messageLinkClicks)
		.where(and(inArray(messageLinkClicks.linkId, links.map((link) => link.id)), eq(messageLinkClicks.automated, true)))
		.groupBy(messageLinkClicks.linkId);
	const automatedByLink = new Map(automated.map((row) => [row.linkId, Number(row.total)]));
	return links.map((link) => ({
		url: link.url,
		clickCount: link.clickCount,
		lastClickedAt: link.lastClickedAt?.toISOString() ?? null,
		automatedClicks: automatedByLink.get(link.id) ?? 0,
	}));
}

/** Real and automated click totals per tracking token. */
export async function getClickTotals(env: CloudflareEnv, tokens: string[]): Promise<Map<string, { clicks: number; automated: number }>> {
	const totals = new Map<string, { clicks: number; automated: number }>();
	if (tokens.length === 0) return totals;
	const db = getDb(env);
	const [clickRows, automatedRows] = await Promise.all([
		db
			.select({ token: messageLinks.token, clicks: sql<number>`sum(${messageLinks.clickCount})` })
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
	for (const row of clickRows) totals.set(row.token, { clicks: Number(row.clicks ?? 0), automated: 0 });
	for (const row of automatedRows) {
		const entry = totals.get(row.token) ?? { clicks: 0, automated: 0 };
		entry.automated = Number(row.total);
		totals.set(row.token, entry);
	}
	return totals;
}
