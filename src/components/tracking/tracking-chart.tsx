"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { formatUserDate } from "@/lib/time/utils";
import type { OverviewDay } from "@/lib/tracking/overview-types";
import { columnPath, labelEvery, niceAxisMax } from "./tracking-dashboard-utils";

const SERIES = [
	{ key: "sent", labelKey: "trackingDashboard.chart.sent", color: "var(--series-1)" },
	{ key: "opens", labelKey: "trackingDashboard.chart.opens", color: "var(--series-2)" },
	{ key: "clicks", labelKey: "trackingDashboard.chart.clicks", color: "var(--series-3)" },
] as const;

const DEFAULT_WIDTH = 720;
const HEIGHT = 220;
/** Room one date label needs, so narrow screens show fewer of them instead of shrinking the text. */
const LABEL_SPACE = 64;
const PAD = { top: 12, right: 8, bottom: 24, left: 32 };
const BAR_GAP = 2;
const MAX_BAR = 24;
const DAY_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };

/** Sent, opens and clicks per day as grouped columns; one hover readout per day lists all three. */
export function TrackingChart({ daily }: { daily: OverviewDay[] }) {
	const { t } = useLanguage();
	const [active, setActive] = useState<number | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	// Laid out at its real pixel width so text stays 11px on a phone instead of scaling down with the drawing.
	const [WIDTH, setWidth] = useState(DEFAULT_WIDTH);
	useEffect(() => {
		const element = containerRef.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const plotWidth = WIDTH - PAD.left - PAD.right;
	const plotHeight = HEIGHT - PAD.top - PAD.bottom;
	const max = niceAxisMax(Math.max(0, ...daily.flatMap((day) => [day.sent, day.opens, day.clicks])));
	const band = plotWidth / Math.max(daily.length, 1);
	const barWidth = Math.max(2, Math.min(MAX_BAR, (band * 0.7 - BAR_GAP * 2) / 3));
	const groupWidth = barWidth * 3 + BAR_GAP * 2;
	const every = labelEvery(daily.length, Math.max(2, Math.floor(plotWidth / LABEL_SPACE)));
	const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;
	const dayLabel = (date: string) => formatUserDate(`${date}T00:00:00Z`, DAY_FORMAT);
	const hovered = active === null ? null : daily[active];

	return (
		<div className="space-y-3">
			<ul className="flex flex-wrap gap-4 text-xs text-neutral-600" aria-label={t("trackingDashboard.chart.title")}>
				{SERIES.map((series) => (
					<li key={series.key} className="flex items-center gap-1.5">
						<span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: series.color }} aria-hidden />
						{t(series.labelKey)}
					</li>
				))}
			</ul>
			<div className="relative" ref={containerRef}>
				<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} className="block max-w-full" role="img" aria-label={t("trackingDashboard.chart.title")} onPointerLeave={() => setActive(null)}>
					{[0, max / 2, max].filter((tick) => Number.isInteger(tick)).map((tick) => (
						<g key={tick}>
							<line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" className="text-neutral-200" strokeWidth={1} />
							<text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-neutral-500 text-[11px] tabular-nums">{tick}</text>
						</g>
					))}
					{daily.map((day, index) => {
						const groupX = PAD.left + band * index + (band - groupWidth) / 2;
						return (
							<g key={day.date}>
								{active === index && <rect x={PAD.left + band * index} y={PAD.top} width={band} height={plotHeight} className="fill-neutral-100" />}
								{SERIES.map((series, seriesIndex) => {
									const value = day[series.key];
									if (value <= 0) return null;
									const top = y(value);
									return <path key={series.key} d={columnPath(groupX + seriesIndex * (barWidth + BAR_GAP), top, barWidth, PAD.top + plotHeight - top)} fill={series.color} />;
								})}
								{index % every === (daily.length - 1) % every && (
									<text x={PAD.left + band * index + band / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-neutral-500 text-[11px]">{dayLabel(day.date)}</text>
								)}
								{/* Hit target: the whole day band, larger than the columns. */}
								<rect
									x={PAD.left + band * index}
									y={PAD.top}
									width={band}
									height={plotHeight}
									fill="transparent"
									tabIndex={0}
									aria-label={`${dayLabel(day.date)}: ${SERIES.map((series) => `${day[series.key]} ${t(series.labelKey)}`).join(", ")}`}
									onPointerEnter={() => setActive(index)}
									onFocus={() => setActive(index)}
									onBlur={() => setActive(null)}
									className="cursor-default outline-none"
								/>
							</g>
						);
					})}
				</svg>
				{hovered && active !== null && (
					<div
						role="status"
						className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-lg"
						style={{ left: `${Math.min(88, Math.max(12, ((PAD.left + band * active + band / 2) / WIDTH) * 100))}%` }}
					>
						<p className="mb-1 font-medium text-neutral-900">{dayLabel(hovered.date)}</p>
						{SERIES.map((series) => (
							<p key={series.key} className="flex items-center gap-2 text-neutral-600">
								<span className="inline-block h-0.5 w-3 rounded" style={{ background: series.color }} aria-hidden />
								<strong className="tabular-nums text-neutral-900">{hovered[series.key]}</strong>
								{t(series.labelKey)}
							</p>
						))}
					</div>
				)}
			</div>
			<details className="text-xs text-neutral-600">
				<summary className="cursor-pointer select-none text-neutral-500 hover:text-neutral-800">{t("trackingDashboard.chart.table")}</summary>
				<table className="mt-2 w-full max-w-md text-left">
					<thead className="text-neutral-500">
						<tr>
							<th className="py-1 pr-3 font-medium">{t("trackingDashboard.chart.date")}</th>
							{SERIES.map((series) => <th key={series.key} className="px-3 py-1 text-right font-medium">{t(series.labelKey)}</th>)}
						</tr>
					</thead>
					<tbody className="divide-y divide-neutral-100">
						{daily.map((day) => (
							<tr key={day.date}>
								<td className="py-1 pr-3">{dayLabel(day.date)}</td>
								{SERIES.map((series) => <td key={series.key} className="px-3 py-1 text-right tabular-nums">{day[series.key]}</td>)}
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</div>
	);
}
