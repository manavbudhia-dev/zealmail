/** The code from a `/start <code>` message (also `/start@BotName <code>`), or null. */
export function parseStartCode(text: string | undefined): string | null {
	const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})\s*$/.exec(text?.trim() ?? "");
	return match ? match[1] : null;
}

/** Plain-text alert lines; Telegram renders them without markup. */
export function formatTelegramAlert(alert: { kind: "open" | "click" | "hot"; subject: string | null; recipient: string | null; url?: string | null; fileName?: string | null; opens?: number }): string {
	const subject = alert.subject?.trim() || "(no subject)";
	const who = alert.recipient ? ` · ${alert.recipient}` : "";
	if (alert.kind === "open") return `👀 Opened: ${subject}${who}`;
	if (alert.kind === "hot") return `🔥 Opened ${alert.opens ?? 0}× without a reply, time to follow up: ${subject}${who}`;
	const target = alert.fileName ? `file ${alert.fileName}` : alert.url ?? "a link";
	return `🔗 Clicked ${target}: ${subject}${who}`;
}
