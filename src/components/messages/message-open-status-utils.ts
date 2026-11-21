import { authFetch } from "@/lib/auth/client";
import type { Translator } from "@/lib/i18n/utils";
import type { MessageOpenEvent, MessageRecipientTracking, MessageTrackingState, MessageTrackingSummary } from "@/lib/tracking/types";

export async function fetchMessageTracking(messageId: string): Promise<MessageTrackingSummary | null> {
	const res = await authFetch(`/api/messages/${messageId}/opens`, { cache: "no-store" });
	if (!res.ok) return null;
	const json = (await res.json()) as { tracking?: MessageTrackingSummary | null };
	return json.tracking ?? null;
}

function countryName(code: string, locale: string): string {
	try {
		return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
	} catch {
		return code;
	}
}

/** "Gmail", "Outlook · iPhone · Zürich, Switzerland"; empty when nothing is known. */
export function describeOpenEvent(event: MessageOpenEvent, locale: string): string {
	const place = [event.city, event.country ? countryName(event.country, locale) : null].filter(Boolean).join(", ");
	return [event.client, event.device, place].filter(Boolean).join(" · ");
}

/** Accessible label for a row's ticks, e.g. "Opened 2× · Links clicked: 1 · Replied". */
export function describeTicks(
	tracking: MessageTrackingState | undefined,
	replied: boolean | undefined,
	t: Translator,
	formatDate: (iso: string) => string = (iso) => iso,
): string {
	const parts: string[] = [];
	if (tracking?.state === "sent") parts.push(t("list.ticks.sent"));
	if (tracking?.state === "possible") parts.push(t("list.ticks.possible"));
	if (tracking?.state === "opened") {
		const date = tracking.lastActivityAt ? formatDate(tracking.lastActivityAt) : null;
		if (tracking.recipients) parts.push(t("list.openedBy", { opened: tracking.openedBy ?? 0, total: tracking.recipients }));
		// "Opened 2× · last Nov 21, 06:30 PM"
		else if (tracking.opens > 0 && date) parts.push(t("message.opens.opened", { count: tracking.opens, date }));
		else if (tracking.opens > 0) parts.push(t("list.opened", { count: tracking.opens }));
		if (tracking.clicks > 0) parts.push(t("list.clicked", { count: tracking.clicks }));
		// The time of the latest open or click when the line above did not already carry it.
		if (date && (tracking.recipients || tracking.opens === 0)) parts.push(date);
	}
	if (replied) parts.push(t("list.replied"));
	return parts.join(" · ");
}

/** One recipient's line in the message view, e.g. "Opened 2× · Links clicked: 1". */
export function describeRecipientTracking(recipient: MessageRecipientTracking, t: Translator): string {
	if (recipient.state === "sent") return t("list.ticks.sent");
	if (recipient.state === "possible") return t("list.ticks.possible");
	const parts: string[] = [];
	if (recipient.openCount > 0) parts.push(t("list.opened", { count: recipient.openCount }));
	if (recipient.clickCount > 0) parts.push(t("list.clicked", { count: recipient.clickCount }));
	return parts.join(" · ");
}

/** "example.com/pricing" for display; the full URL stays in the title and href. */
export function displayLinkUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const path = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
		return `${parsed.hostname.replace(/^www\./, "")}${path}`;
	} catch {
		return url;
	}
}
