import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { allowAgentRequest } from "@/lib/agent/rate-limit";
import { agentProviderErrorMessage } from "@/lib/agent/errors";
import { summarizeThreadForUser } from "@/lib/agent/thread-summary";

type RouteContext = { params: Promise<{ messageId: string }> };

/** AI summary of the conversation this message belongs to. POST because every call costs a model request. */
export async function POST(request: Request, { params }: RouteContext) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	if (!(await allowAgentRequest(env, `summary:${user.id}`))) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

	const { messageId } = await params;
	try {
		const result = await summarizeThreadForUser(env, user, messageId, request.signal);
		switch (result.status) {
			case "ok":
				return NextResponse.json({ points: result.points, messageCount: result.messageCount }, { headers: { "Cache-Control": "no-store" } });
			case "not_found":
				return NextResponse.json({ error: "Not found" }, { status: 404 });
			case "too_short":
				return NextResponse.json({ error: "This conversation is too short to summarize" }, { status: 400 });
			case "disabled":
				return NextResponse.json({ error: "The assistant is turned off" }, { status: 403 });
			case "unconfigured":
				return NextResponse.json({ error: "AI provider is not configured" }, { status: 503 });
		}
	} catch (error) {
		return NextResponse.json({ error: agentProviderErrorMessage(error) }, { status: 502 });
	}
}
