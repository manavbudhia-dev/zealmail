"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Link2, Paperclip, Reply, Users } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { formatUserDate } from "@/lib/time/utils";
import type { MessageLinkSummary, MessageRecipientTracking, MessageTrackingState, MessageTrackingSummary } from "@/lib/tracking/types";
import { describeOpenEvent, describeRecipientTracking, describeTicks, displayLinkUrl, fetchMessageTracking } from "./message-open-status-utils";

const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" };

/** Read-receipt status of a sent message; renders nothing when it was sent without a pixel. */
export function MessageOpenStatus({ messageId }: { messageId: string }) {
	const { t, locale } = useLanguage();
	const [tracking, setTracking] = useState<MessageTrackingSummary | null>(null);

	useEffect(() => {
		let cancelled = false;
		void fetchMessageTracking(messageId).then((result) => {
			if (!cancelled) setTracking(result);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [messageId]);

	if (!tracking) return null;

	if (tracking.openCount === 0) {
		return (
			<div className="mb-3 text-xs">
				<p className="flex items-center gap-1.5 text-neutral-500">
					{tracking.clickCount > 0 ? <Eye className="h-3.5 w-3.5 text-blue-700" aria-hidden /> : <EyeOff className="h-3.5 w-3.5" aria-hidden />}
					{tracking.clickCount > 0
						? t("message.opens.viaClick")
						: tracking.onlyAutomated ? t("message.opens.onlyAutomated") : t("message.opens.notYet")}
				</p>
				<RecipientList recipients={tracking.recipients} />
				<LinkClicks links={tracking.links} />
			</div>
		);
	}

	return (
		<div className="mb-3 text-xs">
			<details className="text-neutral-600">
				<summary className="flex cursor-pointer list-none items-center gap-1.5 text-blue-700 [&::-webkit-details-marker]:hidden">
					<Eye className="h-3.5 w-3.5" aria-hidden />
					{t("message.opens.opened", {
						count: tracking.openCount,
						date: tracking.lastOpenedAt ? formatUserDate(tracking.lastOpenedAt, DATE_FORMAT) : "",
					})}
				</summary>
				<ul className="mt-2 space-y-1 border-l border-neutral-200 pl-3">
					{tracking.opens.map((event) => {
						const description = describeOpenEvent(event, locale);
						return (
							<li key={event.openedAt} className={event.automated ? "text-neutral-400" : undefined}>
								<time dateTime={event.openedAt}>{formatUserDate(event.openedAt, DATE_FORMAT)}</time>
								{event.recipient && <span> · {event.recipient}</span>}
							{description && <span> · {description}</span>}
								{event.automated && <span> · {t("message.opens.automated")}</span>}
							</li>
						);
					})}
				</ul>
				<p className="mt-2 text-neutral-400">{t("message.opens.caveat")}</p>
			</details>
			<RecipientList recipients={tracking.recipients} />
			<LinkClicks links={tracking.links} />
		</div>
	);
}

/** Who opened a message sent as separate copies; nothing for a shared copy. */
function RecipientList({ recipients }: { recipients: MessageRecipientTracking[] }) {
	const { t } = useLanguage();
	if (recipients.length === 0) return null;
	return (
		<details className="mt-1.5 text-neutral-600" open={recipients.length <= 5}>
			<summary className="flex cursor-pointer list-none items-center gap-1.5 text-neutral-700 [&::-webkit-details-marker]:hidden">
				<Users className="h-3.5 w-3.5" aria-hidden />
				{t("message.recipients.title")}
			</summary>
			<ul className="mt-2 space-y-1 border-l border-neutral-200 pl-3">
				{recipients.map((recipient) => (
					<li key={recipient.recipient} className="flex min-w-0 items-center gap-1.5">
						<MessageTicks tracking={{ state: recipient.state, opens: recipient.openCount, clicks: recipient.clickCount }} />
						<span className="min-w-0 truncate">{recipient.recipient}</span>
						<span className={`shrink-0 ${recipient.state === "opened" ? "" : "text-neutral-400"}`}>· {describeRecipientTracking(recipient, t)}</span>
					</li>
				))}
			</ul>
		</details>
	);
}

/** Per-link click counts of a tracked message; nothing when it had no links. */
function LinkClicks({ links }: { links: MessageLinkSummary[] }) {
	const { t } = useLanguage();
	if (links.length === 0) return null;
	const clicked = links.some((link) => link.clickCount > 0);
	return (
		<details className="mt-1.5 text-neutral-600" open={clicked && links.length <= 3}>
			<summary className={`flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden ${clicked ? "text-blue-700" : "text-neutral-500"}`}>
				<Link2 className="h-3.5 w-3.5" aria-hidden />
				{clicked ? t("message.clicks.title") : t("message.clicks.none")}
			</summary>
			<ul className="mt-2 space-y-1 border-l border-neutral-200 pl-3">
				{links.map((link) => (
					<li key={link.url} className={`flex min-w-0 gap-1.5 ${link.clickCount > 0 ? "" : "text-neutral-400"}`}>
						<a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate hover:underline" title={link.url}>
							{link.fileName ? <><Paperclip className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />{link.fileName}</> : displayLinkUrl(link.url)}
						</a>
						<span className="shrink-0">
							{link.clickCount > 0 && link.lastClickedAt
								? t("message.clicks.count", { count: link.clickCount, date: formatUserDate(link.lastClickedAt, DATE_FORMAT) })
								: "0×"}
							{link.automatedClicks > 0 && <span className="text-neutral-400"> · {t("message.clicks.automated", { count: link.automatedClicks })}</span>}
						</span>
					</li>
				))}
			</ul>
		</details>
	);
}

const TICK_COLORS: Record<MessageTrackingState["state"], string> = {
	sent: "text-neutral-400",
	possible: "text-amber-500",
	opened: "text-blue-600",
};

/**
 * Ticks on sent rows: ✓ sent, amber ✓✓ only automated image loads, blue ✓✓ opened or a link clicked.
 * A green arrow follows when the conversation got a reply. Untracked messages show only the arrow.
 */
export function MessageTicks({ tracking, replied }: { tracking?: MessageTrackingState; replied?: boolean }) {
	const { t } = useLanguage();
	if (!tracking && !replied) return null;
	const label = describeTicks(tracking, replied, t, (iso) => formatUserDate(iso, DATE_FORMAT));
	return (
		<span className="mr-1 inline-flex items-center gap-0.5 align-[-2px]" role="img" aria-label={label} title={label}>
			{tracking && (
				<svg viewBox="0 0 18 12" className={`h-3 w-[18px] ${TICK_COLORS[tracking.state]}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
					<polyline points="1.5,6.5 4.75,9.75 11,2.5" />
					{tracking.state !== "sent" && <polyline points="8.25,9.75 14.5,2.5" />}
				</svg>
			)}
			{replied && <Reply className="h-3 w-3 text-emerald-600" aria-hidden />}
		</span>
	);
}
