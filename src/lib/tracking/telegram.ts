import { and, eq, gt, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { userTrackingPreferences } from "@/db/schema";
import { createTrackingToken } from "./open-tracking-utils";
import { getStoredTrackingPreferences, updateTrackingPreferences } from "./preferences";
import { parseStartCode } from "./telegram-utils";

const TELEGRAM_API = "https://api.telegram.org";
const LINK_CODE_MINUTES = 15;
const REQUEST_TIMEOUT_MS = 5_000;

type TelegramUpdate = { update_id: number; message?: { chat?: { id?: number | string }; text?: string } };

export class TelegramUnavailableError extends Error {
	constructor() {
		super("No Telegram bot is configured on this server. Ask an administrator to set TELEGRAM_BOT_TOKEN.");
		this.name = "TelegramUnavailableError";
	}
}

function botToken(env: CloudflareEnv): string {
	const token = env.TELEGRAM_BOT_TOKEN?.trim();
	if (!token) throw new TelegramUnavailableError();
	return token;
}

async function callTelegram<T>(env: CloudflareEnv, method: string, body: Record<string, unknown>): Promise<T> {
	const response = await fetch(`${TELEGRAM_API}/bot${botToken(env)}/${method}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const json = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
	if (!response.ok || !json?.ok) throw new Error(`Telegram ${method}: ${json?.description ?? `request failed (${response.status})`}`);
	return json.result as T;
}

export async function sendTelegramMessage(env: CloudflareEnv, chatId: string, text: string): Promise<void> {
	await callTelegram(env, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

/**
 * Starts linking: stores a one-time code and returns the t.me link that opens the bot with it.
 * The user presses Start in Telegram, then `completeTelegramLinks` picks the code up.
 */
export async function startTelegramLink(env: CloudflareEnv, userId: string): Promise<{ url: string; expiresAt: string }> {
	const me = await callTelegram<{ username?: string }>(env, "getMe", {});
	if (!me.username) throw new Error("The Telegram bot has no username");
	const code = createTrackingToken().slice(0, 24);
	const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60_000);
	await updateTrackingPreferences(env, userId, { telegramLinkCode: code, telegramLinkExpiresAt: expiresAt });
	return { url: `https://t.me/${me.username}?start=${code}`, expiresAt: expiresAt.toISOString() };
}

/**
 * Reads the bot's pending updates and links every chat that sent a valid `/start <code>`.
 * Polling (rather than a webhook) means linking works without a public URL; processed
 * updates are confirmed so they are not read again. Returns whether `userId` is now linked.
 */
export async function completeTelegramLinks(env: CloudflareEnv, userId: string): Promise<boolean> {
	const updates = await callTelegram<TelegramUpdate[]>(env, "getUpdates", { timeout: 0, allowed_updates: ["message"] });
	const db = getDb(env);
	for (const update of updates) {
		const code = parseStartCode(update.message?.text);
		const chatId = update.message?.chat?.id;
		if (!code || chatId === undefined) continue;
		const [owner] = await db
			.select({ userId: userTrackingPreferences.userId })
			.from(userTrackingPreferences)
			.where(and(eq(userTrackingPreferences.telegramLinkCode, code), isNotNull(userTrackingPreferences.telegramLinkExpiresAt), gt(userTrackingPreferences.telegramLinkExpiresAt, new Date())))
			.limit(1);
		if (!owner) continue;
		await updateTrackingPreferences(env, owner.userId, { telegramChatId: String(chatId), telegramLinkCode: null, telegramLinkExpiresAt: null });
		await sendTelegramMessage(env, String(chatId), "Linked to ZealMail. You'll get read-receipt alerts here.").catch(() => undefined);
	}
	if (updates.length > 0) {
		await callTelegram(env, "getUpdates", { offset: updates[updates.length - 1].update_id + 1, timeout: 0, limit: 1 }).catch(() => undefined);
	}
	return Boolean((await getStoredTrackingPreferences(env, userId))?.telegramChatId);
}

export async function unlinkTelegram(env: CloudflareEnv, userId: string): Promise<void> {
	await updateTrackingPreferences(env, userId, { telegramChatId: null, telegramLinkCode: null, telegramLinkExpiresAt: null });
}
