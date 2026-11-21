import type { OverviewDay, OverviewMessage } from "./overview-types";

export const OVERVIEW_PERIODS = [7, 14, 30] as const;
export const WARM_WINDOW_MS = 48 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export function parseOverviewDays(value: string | null): number {
	const days = Number(value);
	return (OVERVIEW_PERIODS as readonly number[]).includes(days) ? days : 14;
}

/** The calendar day of `date` in `timeZone`, as YYYY-MM-DD. */
export function dayKey(date: Date, timeZone: string): string {
	try {
		return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
	} catch {
		return date.toISOString().slice(0, 10);
	}
}

/** One row per day for the last `days` days (oldest first, today last), counting each list of times. */
export function buildDailySeries(days: number, now: Date, timeZone: string, series: { sent: Date[]; opens: Date[]; clicks: Date[] }): OverviewDay[] {
	const rows = new Map<string, OverviewDay>();
	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const date = dayKey(new Date(now.getTime() - offset * DAY_MS), timeZone);
		if (!rows.has(date)) rows.set(date, { date, sent: 0, opens: 0, clicks: 0 });
	}
	for (const key of ["sent", "opens", "clicks"] as const) {
		for (const time of series[key]) {
			const row = rows.get(dayKey(time, timeZone));
			if (row) row[key] += 1;
		}
	}
	return [...rows.values()];
}

/** Messages with real activity since `since` and no reply, most recent activity first. */
export function pickWarmMessages(
	events: Array<{ kind: "open" | "click"; at: Date; messageId: string; subject: string | null; recipient: string | null }>,
	since: Date,
	replied: Set<string>,
	limit = 10,
): OverviewMessage[] {
	const byMessage = new Map<string, OverviewMessage>();
	for (const event of events) {
		if (event.at < since || replied.has(event.messageId)) continue;
		const entry = byMessage.get(event.messageId) ?? { messageId: event.messageId, subject: event.subject, recipient: event.recipient, opens: 0, clicks: 0, lastActivityAt: null };
		if (event.kind === "open") entry.opens += 1;
		else entry.clicks += 1;
		const at = event.at.toISOString();
		if (!entry.lastActivityAt || at > entry.lastActivityAt) entry.lastActivityAt = at;
		byMessage.set(event.messageId, entry);
	}
	return [...byMessage.values()].sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "")).slice(0, limit);
}

/** Share of `part` in `whole` as a whole percentage; 0 when there is nothing to divide. */
export function percent(part: number, whole: number): number {
	return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** "Ann Lee" from "Ann Lee <ann@acme.test>"; the bare address when there is no name. */
export function displayRecipient(entry: string | null): string | null {
	if (!entry) return null;
	const match = /^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/.exec(entry);
	return match ? match[1].trim() || match[2].trim() : entry.trim();
}
