import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { TrackingPreferencesUnavailableError } from "@/lib/tracking/preferences";
import { startTelegramLink, TelegramUnavailableError, unlinkTelegram } from "@/lib/tracking/telegram";

function failure(error: unknown) {
	if (error instanceof TelegramUnavailableError) return NextResponse.json({ error: error.message, code: "TELEGRAM_UNAVAILABLE" }, { status: 409 });
	if (error instanceof TrackingPreferencesUnavailableError) return NextResponse.json({ error: error.message, code: "MIGRATION_REQUIRED" }, { status: 409 });
	console.error("Telegram request failed", error);
	return NextResponse.json({ error: "Telegram did not answer. Try again in a moment." }, { status: 502 });
}

/** Starts linking: returns the t.me link that opens the bot with a one-time code. */
export async function POST(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	try {
		return NextResponse.json(await startTelegramLink(env, auth.user.id));
	} catch (error) {
		return failure(error);
	}
}

export async function DELETE(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	try {
		await unlinkTelegram(env, auth.user.id);
		return NextResponse.json({ ok: true });
	} catch (error) {
		return failure(error);
	}
}
