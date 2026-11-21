import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { getTrackingPreferences, MAX_HOT_OPEN_THRESHOLD, TrackingPreferencesUnavailableError, updateTrackingPreferences } from "@/lib/tracking/preferences";
import type { TrackingPreferencesPatch } from "@/lib/tracking/preferences-types";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	return NextResponse.json(await getTrackingPreferences(env, auth.user.id));
}

export async function PATCH(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const patch: TrackingPreferencesPatch = {};
	if (body && "hotOpenThreshold" in body) {
		const value = body.hotOpenThreshold;
		if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_HOT_OPEN_THRESHOLD) {
			return NextResponse.json({ error: `hotOpenThreshold must be a whole number from 0 to ${MAX_HOT_OPEN_THRESHOLD}` }, { status: 400 });
		}
		patch.hotOpenThreshold = value;
	}
	for (const key of ["telegramOpens", "telegramClicks"] as const) {
		if (body && key in body) {
			if (typeof body[key] !== "boolean") return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
			patch[key] = body[key] as boolean;
		}
	}
	if (body && "summaryFrequency" in body) {
		if (body.summaryFrequency !== "off" && body.summaryFrequency !== "daily" && body.summaryFrequency !== "weekly") {
			return NextResponse.json({ error: "summaryFrequency must be off, daily or weekly" }, { status: 400 });
		}
		patch.summaryFrequency = body.summaryFrequency;
	}
	if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
	try {
		return NextResponse.json(await updateTrackingPreferences(env, auth.user.id, patch));
	} catch (error) {
		if (error instanceof TrackingPreferencesUnavailableError) return NextResponse.json({ error: error.message, code: "MIGRATION_REQUIRED" }, { status: 409 });
		throw error;
	}
}
