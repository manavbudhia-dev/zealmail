import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { completeTelegramLinks, TelegramUnavailableError } from "@/lib/tracking/telegram";

/** Polled by the settings page after the user pressed Start in Telegram. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json({ linked: await completeTelegramLinks(env, auth.user.id) });
	} catch (error) {
		if (error instanceof TelegramUnavailableError) return NextResponse.json({ error: error.message, code: "TELEGRAM_UNAVAILABLE" }, { status: 409 });
		console.error("Telegram link check failed", error);
		return NextResponse.json({ error: "Telegram did not answer. Try again in a moment." }, { status: 502 });
	}
}
