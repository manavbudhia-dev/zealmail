import type { SummaryFrequency } from "./preferences-types";

export type TrackingSummaryRow = { subject: string | null; recipient: string | null; opens: number; clicks: number; replied: boolean };
export type TrackingSummaryData = { sent: number; opened: number; clicks: number; replies: number; top: TrackingSummaryRow[] };

const DAY_MS = 24 * 60 * 60_000;

/** Which summaries are due on the daily run at `now`: daily ones every day, weekly ones on Mondays (UTC). */
export function dueSummaryFrequencies(now: Date): SummaryFrequency[] {
	return now.getUTCDay() === 1 ? ["daily", "weekly"] : ["daily"];
}

export function summaryPeriodStart(frequency: SummaryFrequency, now: Date): Date {
	return new Date(now.getTime() - (frequency === "weekly" ? 7 : 1) * DAY_MS);
}

/** A run within this much of the last summary is a duplicate (overlapping cron runs, restarts). */
export function summaryRecentlySent(lastSentAt: Date | null, frequency: SummaryFrequency, now: Date): boolean {
	if (!lastSentAt) return false;
	const window = (frequency === "weekly" ? 6 : 0.75) * DAY_MS;
	return now.getTime() - lastSentAt.getTime() < window;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

export function formatTrackingSummary(data: TrackingSummaryData, frequency: SummaryFrequency, appUrl: string | null): { subject: string; text: string; html: string } {
	const period = frequency === "weekly" ? "this week" : "today";
	const subject = `Read receipts ${period}: ${data.opened} opened, ${data.clicks} clicks, ${data.replies} replies`;
	const lines = [
		`Tracked emails sent: ${data.sent}`,
		`Emails opened: ${data.opened}`,
		`Link and file clicks: ${data.clicks}`,
		`Replies: ${data.replies}`,
	];
	const top = data.top.map((row) => {
		const parts = [`${row.opens}× opened`, `${row.clicks} clicks`];
		if (row.replied) parts.push("replied");
		return { title: `${row.subject?.trim() || "(no subject)"}${row.recipient ? ` · ${row.recipient}` : ""}`, detail: parts.join(", ") };
	});
	const settings = appUrl ? `${appUrl.replace(/\/+$/, "")}/settings/tracking` : null;
	const text = [
		`Your read receipts ${period}`,
		lines.join("\n"),
		top.length ? `Most active:\n${top.map((row) => `- ${row.title}: ${row.detail}`).join("\n")}` : "",
		settings ? `Change or turn off these emails: ${settings}` : "Change or turn off these emails in Settings → Tracking.",
	].filter(Boolean).join("\n\n");
	const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#171717">
<h2 style="font-size:18px;margin:0 0 12px">Your read receipts ${period}</h2>
<ul style="padding-left:18px;margin:0 0 16px">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
${top.length ? `<h3 style="font-size:15px;margin:0 0 8px">Most active</h3><ol style="padding-left:18px;margin:0 0 16px">${top.map((row) => `<li><strong>${escapeHtml(row.title)}</strong><br><span style="color:#525252">${escapeHtml(row.detail)}</span></li>`).join("")}</ol>` : ""}
<p style="color:#737373;font-size:12px">${settings ? `<a href="${escapeHtml(settings)}">Change or turn off these emails</a>` : "Change or turn off these emails in Settings → Tracking."}</p>
</div>`;
	return { subject, text, html };
}
