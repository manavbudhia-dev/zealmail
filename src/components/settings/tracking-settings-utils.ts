import { authFetch } from "@/lib/auth/client";
import type { TrackingPreferences, TrackingPreferencesPatch } from "@/lib/tracking/preferences-types";
import type { ContactEngagement } from "@/lib/tracking/report-utils";

export const HOT_OPEN_THRESHOLD_OPTIONS = [0, 2, 3, 5, 10];
/** How often the page asks the server whether the Telegram chat got linked, and for how long. */
export const TELEGRAM_POLL_MS = 3_000;
export const TELEGRAM_POLL_LIMIT_MS = 15 * 60_000;

async function readError(response: Response): Promise<Error> {
	const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
	return new Error(body?.code ?? body?.error ?? "REQUEST_FAILED");
}

export async function loadTrackingPreferences(): Promise<TrackingPreferences> {
	const response = await authFetch("/api/settings/tracking", { cache: "no-store" });
	if (!response.ok) throw await readError(response);
	return (await response.json()) as TrackingPreferences;
}

export async function saveTrackingPreferences(patch: TrackingPreferencesPatch): Promise<TrackingPreferences> {
	const response = await authFetch("/api/settings/tracking", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
	if (!response.ok) throw await readError(response);
	return (await response.json()) as TrackingPreferences;
}

export async function startTelegramLink(): Promise<{ url: string; expiresAt: string }> {
	const response = await authFetch("/api/settings/tracking/telegram", { method: "POST" });
	if (!response.ok) throw await readError(response);
	return (await response.json()) as { url: string; expiresAt: string };
}

export async function checkTelegramLink(): Promise<boolean> {
	const response = await authFetch("/api/settings/tracking/telegram/check", { method: "POST" });
	if (!response.ok) throw await readError(response);
	return ((await response.json()) as { linked: boolean }).linked;
}

export async function unlinkTelegram(): Promise<void> {
	const response = await authFetch("/api/settings/tracking/telegram", { method: "DELETE" });
	if (!response.ok) throw await readError(response);
}

export async function loadContactEngagement(): Promise<ContactEngagement[]> {
	const response = await authFetch("/api/tracking/contacts", { cache: "no-store" });
	if (!response.ok) throw await readError(response);
	return ((await response.json()) as { contacts: ContactEngagement[] }).contacts;
}

export async function downloadTrackingCsv(type: "messages" | "activity"): Promise<void> {
	const response = await authFetch(`/api/tracking/export?type=${type}`);
	if (!response.ok) throw await readError(response);
	const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `${type}.csv`;
	const url = URL.createObjectURL(await response.blob());
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

/** Case-insensitive substring match on the address. */
export function filterEngagement(rows: ContactEngagement[], query: string): ContactEngagement[] {
	const needle = query.trim().toLowerCase();
	return needle ? rows.filter((row) => row.address.includes(needle)) : rows;
}
