import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { exportTrackedMessagesCsv, exportTrackingActivityCsv } from "@/lib/tracking/reports";

/** `?type=messages` (one row per tracked send and copy) or `?type=activity` (every open and click). */
export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const type = new URL(request.url).searchParams.get("type");
	if (type !== "messages" && type !== "activity") return NextResponse.json({ error: "type must be messages or activity" }, { status: 400 });
	const csv = type === "messages" ? await exportTrackedMessagesCsv(env, auth.user) : await exportTrackingActivityCsv(env, auth.user);
	const date = new Date().toISOString().slice(0, 10);
	return new Response(csv, {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="zealmail-${type === "messages" ? "tracked-emails" : "tracking-activity"}-${date}.csv"`,
			"Cache-Control": "private, no-store",
		},
	});
}
