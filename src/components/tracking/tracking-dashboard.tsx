"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Link2, Paperclip } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Select } from "@/components/ui/select";
import { formatUserDate } from "@/lib/time/utils";
import type { TrackingOverview } from "@/lib/tracking/overview-types";
import { OVERVIEW_PERIODS, percent } from "@/lib/tracking/overview-utils";
import { TrackingChart } from "./tracking-chart";
import { describeEventSource, fetchTrackingOverview } from "./tracking-dashboard-utils";

const CARD = "rounded-3xl bg-white p-5";
const WHEN: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };

/** Series colours from the validated data-viz palette, stepped separately for the dark theme. */
const PALETTE = "[--series-1:#2a78d6] [--series-2:#eb6834] [--series-3:#1baf7a] dark:[--series-1:#3987e5] dark:[--series-2:#d95926] dark:[--series-3:#199e70]";

export function TrackingDashboard() {
	const { t } = useLanguage();
	const [days, setDays] = useState(14);
	const overview = useQuery({ queryKey: ["tracking-overview", days], queryFn: () => fetchTrackingOverview(days) });
	const data = overview.data;

	return (
		<div className={`px-6 py-8 lg:px-10 ${PALETTE}`}>
			<div className="mx-auto w-full max-w-5xl space-y-6">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="text-2xl font-medium md:text-3xl">{t("trackingDashboard.title")}</h1>
						<p className="mt-1 text-sm text-neutral-500">{t("trackingDashboard.description")}</p>
					</div>
					<div className="flex items-center gap-3">
						<Link href="/settings/tracking" className="text-sm text-blue-700 hover:underline">{t("trackingDashboard.settings")}</Link>
						<Select value={String(days)} onChange={(event) => setDays(Number(event.target.value))} aria-label={t("trackingDashboard.period")} className="py-1.5 text-sm">
							{OVERVIEW_PERIODS.map((count) => <option key={count} value={count}>{t("trackingDashboard.periodDays", { count })}</option>)}
						</Select>
					</div>
				</div>

				{overview.isError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t("trackingDashboard.loadFailed")}</p>}
				{!data && !overview.isError && <p className="text-sm text-neutral-500">{t("common.loading")}</p>}
				{data && <DashboardBody data={data} />}
			</div>
		</div>
	);
}

function DashboardBody({ data }: { data: TrackingOverview }) {
	const { t } = useLanguage();
	const { totals } = data;
	const tiles = [
		{ label: t("trackingDashboard.kpi.sent"), value: String(totals.sent), detail: null },
		{ label: t("trackingDashboard.kpi.opened"), value: `${percent(totals.opened, totals.sent)}%`, detail: t("trackingDashboard.kpi.ofSent", { count: totals.opened, total: totals.sent }) },
		{ label: t("trackingDashboard.kpi.clicked"), value: `${percent(totals.clicked, totals.sent)}%`, detail: t("trackingDashboard.kpi.ofSent", { count: totals.clicked, total: totals.sent }) },
		{ label: t("trackingDashboard.kpi.replied"), value: `${percent(totals.replied, totals.sent)}%`, detail: t("trackingDashboard.kpi.ofSent", { count: totals.replied, total: totals.sent }) },
	];
	return (
		<>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				{tiles.map((tile) => (
					<div key={tile.label} className={CARD}>
						<p className="text-sm text-neutral-500">{tile.label}</p>
						<p className="mt-1 text-3xl font-medium tabular-nums text-neutral-900">{tile.value}</p>
						{tile.detail && <p className="mt-0.5 text-xs text-neutral-500 tabular-nums">{tile.detail}</p>}
					</div>
				))}
			</div>

			<section className={CARD}>
				<h2 className="mb-3 text-base font-semibold text-neutral-900">{t("trackingDashboard.chart.title")}</h2>
				<TrackingChart daily={data.daily} />
			</section>

			<div className="grid gap-6 lg:grid-cols-2">
				<section className={CARD}>
					<h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900"><BellRing className="h-4 w-4 text-amber-600" aria-hidden />{t("trackingDashboard.followUps.title")}</h2>
					{data.followUps.length === 0 ? <p className="mt-3 text-sm text-neutral-500">{t("trackingDashboard.followUps.empty")}</p> : (
						<ul className="mt-3 divide-y divide-neutral-100">
							{data.followUps.map((item) => (
								<MessageRow key={item.messageId} messageId={item.messageId} subject={item.subject} recipient={item.recipient}
									detail={[t("trackingDashboard.followUps.due", { date: formatUserDate(item.dueAt, WHEN) }), item.opens ? t("list.opened", { count: item.opens }) : null].filter(Boolean).join(" · ")} />
							))}
						</ul>
					)}
				</section>
				<section className={CARD}>
					<h2 className="text-base font-semibold text-neutral-900">{t("trackingDashboard.warm.title")}</h2>
					<p className="text-xs text-neutral-500">{t("trackingDashboard.warm.description")}</p>
					{data.warm.length === 0 ? <p className="mt-3 text-sm text-neutral-500">{t("trackingDashboard.warm.empty")}</p> : (
						<ul className="mt-3 divide-y divide-neutral-100">
							{data.warm.map((item) => (
								<MessageRow key={item.messageId} messageId={item.messageId} subject={item.subject} recipient={item.recipient}
									detail={[item.opens ? t("list.opened", { count: item.opens }) : null, item.clicks ? t("list.clicked", { count: item.clicks }) : null, item.lastActivityAt ? formatUserDate(item.lastActivityAt, WHEN) : null].filter(Boolean).join(" · ")} />
							))}
						</ul>
					)}
				</section>
			</div>

			<section className={CARD}>
				<h2 className="text-base font-semibold text-neutral-900">{t("trackingDashboard.activity.title")}</h2>
				{data.activity.length === 0 ? <p className="mt-3 text-sm text-neutral-500">{t("trackingDashboard.activity.empty")}</p> : (
					<ul className="mt-3 divide-y divide-neutral-100">
						{data.activity.map((event, index) => {
							const who = event.recipient ?? t("trackingDashboard.activity.someone");
							const target = event.fileName ?? event.url ?? "";
							const source = describeEventSource(event);
							return (
								<li key={`${event.at}-${index}`} className="flex items-start gap-3 py-2.5">
									<span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${event.kind === "open" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`} aria-hidden>
										{event.kind === "open" ? "✓" : event.fileName ? <Paperclip className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
									</span>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm text-neutral-900">
											{event.kind === "open" ? t("trackingDashboard.activity.open", { recipient: who }) : t("trackingDashboard.activity.click", { recipient: who, target })}
										</p>
										<p className="truncate text-xs text-neutral-500">
											<Link href={`/sent/${event.messageId}`} className="hover:underline">{event.subject?.trim() || t("list.noSubject")}</Link>
											{source && ` · ${source}`}
										</p>
									</div>
									<time dateTime={event.at} className="shrink-0 text-xs text-neutral-500">{formatUserDate(event.at, WHEN)}</time>
								</li>
							);
						})}
					</ul>
				)}
			</section>

			<section className={CARD}>
				<h2 className="text-base font-semibold text-neutral-900">{t("trackingDashboard.files.title")}</h2>
				{data.files.length === 0 ? <p className="mt-3 text-sm text-neutral-500">{t("trackingDashboard.files.empty")}</p> : (
					<div className="mt-3 overflow-x-auto">
						<table className="w-full min-w-[520px] text-left text-sm">
							<thead className="text-xs uppercase tracking-wide text-neutral-500">
								<tr>
									<th className="py-2 pr-3 font-medium">{t("trackingDashboard.files.file")}</th>
									<th className="px-3 py-2 font-medium">{t("trackingDashboard.files.email")}</th>
									<th className="px-3 py-2 text-right font-medium">{t("trackingDashboard.files.opens")}</th>
									<th className="py-2 pl-3 font-medium">{t("trackingDashboard.files.lastOpened")}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-neutral-100">
								{data.files.map((file) => (
									<tr key={`${file.messageId}-${file.fileName}`}>
										<td className="max-w-[12rem] truncate py-2 pr-3 text-neutral-900" title={file.fileName}><Paperclip className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-neutral-400" aria-hidden />{file.fileName}</td>
										<td className="max-w-[16rem] truncate px-3 py-2">
											<Link href={`/sent/${file.messageId}`} className="hover:underline">{file.subject?.trim() || t("list.noSubject")}</Link>
											{file.recipient && <span className="text-neutral-500"> · {file.recipient}</span>}
										</td>
										<td className="px-3 py-2 text-right tabular-nums">{file.clicks}</td>
										<td className="py-2 pl-3 text-neutral-500">{file.lastClickedAt ? formatUserDate(file.lastClickedAt, WHEN) : "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</>
	);
}

function MessageRow({ messageId, subject, recipient, detail }: { messageId: string; subject: string | null; recipient: string | null; detail: string }) {
	const { t } = useLanguage();
	return (
		<li className="py-2.5">
			<Link href={`/sent/${messageId}`} className="block min-w-0 hover:underline">
				<span className="block truncate text-sm text-neutral-900">{subject?.trim() || t("list.noSubject")}</span>
			</Link>
			<span className="block truncate text-xs text-neutral-500">{[recipient, detail].filter(Boolean).join(" · ")}</span>
		</li>
	);
}
