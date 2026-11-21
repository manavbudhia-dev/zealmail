import type { MessageTickState } from "./types";

export type ContactEngagement = {
	address: string;
	/** Tracked messages sent to this address. */
	sent: number;
	/** Of those, ones this address is known to have opened or clicked (separate copies, or a lone recipient). */
	opened: number;
	opens: number;
	clicks: number;
	replied: number;
	lastActivityAt: string | null;
};

/** One CSV cell; values a spreadsheet would run as a formula are prefixed with an apostrophe. */
export function csvCell(value: string | number | boolean | null | undefined): string {
	if (value === null || value === undefined) return "";
	let text = String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export function toCsv(header: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
	return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function tickStateLabel(state: MessageTickState): string {
	return state === "opened" ? "opened" : state === "possible" ? "possibly opened" : "not opened";
}

/** Most engaged first: opened messages, then clicks, then the most recent activity. */
export function sortEngagement(rows: ContactEngagement[]): ContactEngagement[] {
	return [...rows].sort((a, b) =>
		b.opened - a.opened ||
		b.clicks - a.clicks ||
		b.replied - a.replied ||
		(b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") ||
		a.address.localeCompare(b.address));
}
