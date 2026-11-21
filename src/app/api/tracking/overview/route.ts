import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { getRequestTimeZone } from "@/lib/time/utils";
import { getTrackingOverview } from "@/lib/tracking/overview";
import { parseOverviewDays } from "@/lib/tracking/overview-utils";

/** `?days=7|14|30` (default 14); days are bucketed in the caller's time zone. */
export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const days = parseOverviewDays(new URL(request.url).searchParams.get("days"));
	return NextResponse.json(await getTrackingOverview(env, auth.user, { days, timeZone: getRequestTimeZone(request) }));
}
