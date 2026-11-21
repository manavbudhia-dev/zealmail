import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userTrackingPreferences } from "@/db/schema";
import { isMissingTableError } from "@/lib/database-errors";
import type { TrackingPreferences, TrackingPreferencesPatch } from "./preferences-types";

export const DEFAULT_HOT_OPEN_THRESHOLD = 3;
export const MAX_HOT_OPEN_THRESHOLD = 20;

type StoredPreferences = typeof userTrackingPreferences.$inferSelect;

/** The stored row, or null when the user never changed anything (or before migration 0090). */
export async function getStoredTrackingPreferences(env: CloudflareEnv, userId: string): Promise<StoredPreferences | null> {
	try {
		const [row] = await getDb(env).select().from(userTrackingPreferences).where(eq(userTrackingPreferences.userId, userId)).limit(1);
		return row ?? null;
	} catch (error) {
		if (isMissingTableError(error)) return null;
		throw error;
	}
}

export function toTrackingPreferences(env: CloudflareEnv, row: StoredPreferences | null): TrackingPreferences {
	return {
		hotOpenThreshold: row?.hotOpenThreshold ?? DEFAULT_HOT_OPEN_THRESHOLD,
		telegramAvailable: Boolean(env.TELEGRAM_BOT_TOKEN?.trim()),
		telegramLinked: Boolean(row?.telegramChatId),
		telegramOpens: row?.telegramOpens ?? true,
		telegramClicks: row?.telegramClicks ?? true,
		summaryFrequency: row?.summaryFrequency ?? "off",
	};
}

export async function getTrackingPreferences(env: CloudflareEnv, userId: string): Promise<TrackingPreferences> {
	return toTrackingPreferences(env, await getStoredTrackingPreferences(env, userId));
}

export class TrackingPreferencesUnavailableError extends Error {
	constructor() {
		super("Apply pending database migrations to change tracking alerts");
		this.name = "TrackingPreferencesUnavailableError";
	}
}

/** Creates the row on first use; throws `TrackingPreferencesUnavailableError` before migration 0090. */
export async function updateTrackingPreferences(
	env: CloudflareEnv,
	userId: string,
	patch: TrackingPreferencesPatch & { telegramChatId?: string | null; telegramLinkCode?: string | null; telegramLinkExpiresAt?: Date | null; summaryLastSentAt?: Date | null },
): Promise<TrackingPreferences> {
	const updatedAt = new Date();
	try {
		await getDb(env)
			.insert(userTrackingPreferences)
			.values({ userId, ...patch, updatedAt })
			.onConflictDoUpdate({ target: userTrackingPreferences.userId, set: { ...patch, updatedAt } });
	} catch (error) {
		if (isMissingTableError(error)) throw new TrackingPreferencesUnavailableError();
		throw error;
	}
	return getTrackingPreferences(env, userId);
}
