import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { isMissingTableError } from "@/lib/database-errors";
import { listContactEngagement } from "@/lib/tracking/reports";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json({ contacts: await listContactEngagement(env, auth.user) });
	} catch (error) {
		if (isMissingTableError(error)) return NextResponse.json({ contacts: [] });
		throw error;
	}
}
