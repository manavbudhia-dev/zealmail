import { authFetch } from "@/lib/auth/client";
import type { TrackingOverview } from "@/lib/tracking/overview-types";

export async function fetchTrackingOverview(days: number): Promise<TrackingOverview> {
	const response = await authFetch(`/api/tracking/overview?days=${days}`, { cache: "no-store" });
	if (!response.ok) throw new Error("OVERVIEW_FAILED");
	return (await response.json()) as TrackingOverview;
}

/**
 * A round axis maximum at or above `value`; at least 1. Above 1 it is even, so the midpoint
 * gridline is a whole count (the chart counts emails, opens and clicks).
 */
export function niceAxisMax(value: number): number {
	if (value <= 1) return 1;
	const power = 10 ** Math.floor(Math.log10(value));
	for (const step of [1, 2, 4, 6, 8, 10]) if (step * power >= value && (step * power) % 2 === 0) return step * power;
	return 10 * power;
}

/** Label every n-th day so at most `maxLabels` dates show under the chart. */
export function labelEvery(days: number, maxLabels = 7): number {
	return Math.max(1, Math.ceil(days / maxLabels));
}

/** A column with a rounded data end and a square base, as an SVG path. */
export function columnPath(x: number, y: number, width: number, height: number): string {
	const r = Math.min(4, width / 2, height);
	return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/** "Zürich, CH · iPhone · Gmail", leaving out what is unknown. */
export function describeEventSource(event: { city: string | null; country: string | null; device: string | null; client: string | null }): string {
	const place = [event.city, event.country].filter(Boolean).join(", ");
	return [place, event.device, event.client].filter(Boolean).join(" · ");
}
