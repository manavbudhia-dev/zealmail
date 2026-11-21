import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Tracked files, the "opened N times" follow-up, Telegram linking and alerts, summary emails and the
// engagement report, run for real against an in-memory SQLite database with stubbed Telegram, mail and storage.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-tracking-alerts-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		send: join(root, "src/lib/email/send.ts"),
		opens: join(root, "src/lib/tracking/open-tracking.ts"),
		links: join(root, "src/lib/tracking/link-tracking.ts"),
		telegram: join(root, "src/lib/tracking/telegram.ts"),
		telegramUtils: join(root, "src/lib/tracking/telegram-utils.ts"),
		preferences: join(root, "src/lib/tracking/preferences.ts"),
		summaries: join(root, "src/lib/tracking/summaries.ts"),
		summaryUtils: join(root, "src/lib/tracking/summary-utils.ts"),
		reports: join(root, "src/lib/tracking/reports.ts"),
		reportUtils: join(root, "src/lib/tracking/report-utils.ts"),
		database: join(root, "server/runtime/sqlite-database.ts"),
		migrate: join(root, "server/runtime/migrate.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	splitting: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "@": join(root, "src") },
	logLevel: "silent",
});
const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const { sendEmail } = await load("send");
const { recordOpen, getMessageTrackingSummary } = await load("opens");
const { recordClick } = await load("links");
const { startTelegramLink, completeTelegramLinks } = await load("telegram");
const { parseStartCode, formatTelegramAlert } = await load("telegramUtils");
const { updateTrackingPreferences, getTrackingPreferences } = await load("preferences");
const { runTrackingSummaries } = await load("summaries");
const { dueSummaryFrequencies, summaryRecentlySent } = await load("summaryUtils");
const { listContactEngagement, exportTrackedMessagesCsv } = await load("reports");
const { csvCell } = await load("reportUtils");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

const chrome = (n) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/13${n}.0.0.0 Safari/537.36`;
const devices = ["Windows NT 10.0; Win64; x64", "Macintosh; Intel Mac OS X 14_0", "X11; Linux x86_64", "iPhone; CPU iPhone OS 18_0 like Mac OS X"];
const ua = (n) => `Mozilla/5.0 (${devices[n % devices.length]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`;

/** Stubs fetch for api.telegram.org and records what the bot was asked to do. */
function stubTelegram(t, { updates = [] } = {}) {
	const calls = [];
	calls.updates = updates;
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		const match = /api\.telegram\.org\/bot[^/]+\/(\w+)/.exec(String(url));
		if (!match) return original(url, init);
		const body = init?.body ? JSON.parse(init.body) : {};
		calls.push({ method: match[1], body });
		const result = match[1] === "getMe" ? { username: "zeal_test_bot" } : match[1] === "getUpdates" ? (body.offset ? [] : calls.updates) : { message_id: 1 };
		return Response.json({ ok: true, result });
	};
	t.after(() => { globalThis.fetch = original; });
	return calls;
}

async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('owner', 'owner@example.com', 'Owner', 'x', 'admin', 0);
		INSERT INTO domains (id, user_id, hostname, zone_id, sending_provider, sending_enabled, created_at) VALUES ('domain', 'owner', 'example.com', 'zone', 'cloudflare', 1, 0);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES ('mine', 'owner', 'domain', 'owner', 'personal', 0, 0);
	`);
	const objects = new Map();
	const sent = [];
	const env = {
		DB: database,
		APP_URL: "https://mail.example.com",
		TELEGRAM_BOT_TOKEN: "123:test",
		BUCKET: {
			async put(key, value) { objects.set(key, value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer()); return { key }; },
			async get(key) { const value = objects.get(key); return value ? { body: value, arrayBuffer: async () => value } : null; },
			async delete(key) { objects.delete(key); },
			async head(key) { return objects.has(key) ? { key } : null; },
		},
		OUTBOUND_QUEUE: { queued: [], async send(message) { this.queued.push(message); } },
		EMAIL: { async send(message) { sent.push(message); return { messageId: `<m-${sent.length}@cloudflare.test>` }; } },
	};
	const run = (sql, ...params) => database.db.prepare(sql).run(...params);
	const all = (sql, ...params) => database.db.prepare(sql).all(...params);
	/** A tracked message sent long enough ago that opens are not treated as delivery-time prefetches. */
	const trackedMessage = (id, { to = "ann@acme.test", recipient = "", thread = `thr-${id}`, sentAt = 1_000 } = {}) => {
		run("INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, thread_id, created_at) VALUES (?, 'owner', 'mine', 'outbound', 'owner@example.com', ?, ?, 'sent', 1, ?, ?)", id, to, `Subject ${id}`, thread, sentAt);
		run("INSERT INTO message_tracking (token, message_id, recipient, open_count, created_at) VALUES (?, ?, ?, 0, ?)", `tok-${id}-${recipient || "all"}`.padEnd(24, "x"), id, recipient, sentAt);
		return `tok-${id}-${recipient || "all"}`.padEnd(24, "x");
	};
	return { env, database, sent, run, all, trackedMessage };
}

test("an attachment marked tracked goes out as a click-tracked download link named after the file", async (t) => {
	const { env, sent, all } = await fixture(t);
	const content = new TextEncoder().encode("%PDF-1.7 proposal").buffer;
	const { messageId } = await sendEmail(env, {
		userId: "owner", from: "owner@example.com", to: ["ann@acme.test"], subject: "Proposal", mailboxId: "mine",
		html: "<p>Attached.</p>", text: "Attached.", trackOpens: true,
		attachments: [
			{ filename: "proposal.pdf", type: "application/pdf", content, tracked: true },
			{ filename: "notes.txt", type: "text/plain", content: new TextEncoder().encode("hi").buffer },
		],
	});
	const [message] = sent;
	assert.deepEqual(message.attachments.map((attachment) => attachment.filename), ["notes.txt"], "the tracked file is not attached");
	assert.match(message.html, /proposal\.pdf/);
	assert.match(message.html, /\/api\/l\/[\w-]+/, "its download link is click-tracked");
	const [link] = all("SELECT url FROM message_links");
	assert.match(link.url, /^https:\/\/mail\.example\.com\/api\/shared-files\//);
	const summary = await getMessageTrackingSummary(env, messageId);
	assert.equal(summary.links[0].fileName, "proposal.pdf");
});

test("a tracked file is sent as an attachment when the read receipt is off", async (t) => {
	const { env, sent } = await fixture(t);
	await sendEmail(env, {
		userId: "owner", from: "owner@example.com", to: ["ann@acme.test"], subject: "Plain", mailboxId: "mine", html: "<p>x</p>", text: "x",
		attachments: [{ filename: "proposal.pdf", type: "application/pdf", content: new TextEncoder().encode("pdf").buffer, tracked: true }],
	});
	assert.deepEqual(sent[0].attachments.map((attachment) => attachment.filename), ["proposal.pdf"]);
});

test("the third real open without a reply makes the follow-up due, notifies once, and Telegram hears about it", async (t) => {
	const { env, all, trackedMessage } = await fixture(t);
	const calls = stubTelegram(t);
	await updateTrackingPreferences(env, "owner", { telegramChatId: "42" });
	const token = trackedMessage("hot");
	for (let n = 0; n < 4; n += 1) await recordOpen(env, token, { userAgent: ua(n) });
	const [followUp] = all("SELECT status FROM follow_ups WHERE message_id = 'hot'");
	assert.equal(followUp.status, "due");
	const texts = calls.filter((call) => call.method === "sendMessage").map((call) => call.body.text);
	assert.equal(texts.filter((text) => text.startsWith("👀")).length, 1, "first open alerts once");
	assert.equal(texts.filter((text) => text.startsWith("🔥")).length, 1, "the threshold alerts once, not again on the fourth open");
	assert.ok(texts.every((text) => text.includes("Subject hot")));
});

test("a reply, a dismissed reminder or a threshold of 0 stops the follow-up alert", async (t) => {
	const { env, run, all, trackedMessage } = await fixture(t);
	stubTelegram(t);
	const replied = trackedMessage("replied");
	run("INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, thread_id, created_at) VALUES ('reply', 'owner', 'mine', 'inbound', 'ann@acme.test', 'owner@example.com', 'Re', 'received', 0, 'thr-replied', 2000)");
	for (let n = 0; n < 3; n += 1) await recordOpen(env, replied, { userAgent: ua(n) });
	assert.equal(all("SELECT * FROM follow_ups WHERE message_id = 'replied'").length, 0);

	const dismissed = trackedMessage("dismissed");
	run("INSERT INTO follow_ups (id, message_id, user_id, due_at, status, created_at) VALUES ('f1', 'dismissed', 'owner', 99999999999, 'dismissed', 0)");
	for (let n = 0; n < 3; n += 1) await recordOpen(env, dismissed, { userAgent: ua(n) });
	assert.equal(all("SELECT status FROM follow_ups WHERE message_id = 'dismissed'")[0].status, "dismissed");

	await updateTrackingPreferences(env, "owner", { hotOpenThreshold: 0 });
	const off = trackedMessage("off");
	for (let n = 0; n < 3; n += 1) await recordOpen(env, off, { userAgent: ua(n) });
	assert.equal(all("SELECT * FROM follow_ups WHERE message_id = 'off'").length, 0);
});

test("a pending reminder comes due early when the threshold is reached", async (t) => {
	const { env, run, all, trackedMessage } = await fixture(t);
	stubTelegram(t);
	const token = trackedMessage("pending");
	run("INSERT INTO follow_ups (id, message_id, user_id, due_at, status, created_at) VALUES ('f2', 'pending', 'owner', 99999999999, 'pending', 0)");
	await updateTrackingPreferences(env, "owner", { hotOpenThreshold: 2 });
	for (let n = 0; n < 2; n += 1) await recordOpen(env, token, { userAgent: ua(n) });
	const [row] = all("SELECT status, due_at FROM follow_ups WHERE message_id = 'pending'");
	assert.equal(row.status, "due");
	assert.ok(row.due_at < 99999999999);
});

test("clicks alert on Telegram (naming tracked files) unless click alerts are off", async (t) => {
	const { env, trackedMessage } = await fixture(t);
	const calls = stubTelegram(t);
	await updateTrackingPreferences(env, "owner", { telegramChatId: "42" });
	const token = trackedMessage("clicky");
	env.DB.db.prepare("INSERT INTO message_links (id, token, url, click_count, created_at) VALUES ('linkidlinkidlinkid0001', ?, 'https://example.org/pricing', 0, 1000)").run(token);
	await recordClick(env, "linkidlinkidlinkid0001", { method: "GET", userAgent: chrome(1) });
	assert.ok(calls.some((call) => call.method === "sendMessage" && call.body.text === "🔗 Clicked https://example.org/pricing: Subject clicky · ann@acme.test"));
	await updateTrackingPreferences(env, "owner", { telegramClicks: false });
	const before = calls.length;
	await recordClick(env, "linkidlinkidlinkid0001", { method: "GET", userAgent: ua(3) });
	assert.equal(calls.length, before);
});

test("linking Telegram: the /start code links the chat that sent it and is used up", async (t) => {
	const { env } = await fixture(t);
	const calls = stubTelegram(t);
	const { url } = await startTelegramLink(env, "owner");
	const code = new URL(url).searchParams.get("start");
	assert.match(url, /^https:\/\/t\.me\/zeal_test_bot\?start=/);
	calls.updates = [
		{ update_id: 7, message: { chat: { id: 555 }, text: "/start wrongcodewrongcode" } },
		{ update_id: 8, message: { chat: { id: 999 }, text: `/start ${code}` } },
	];
	assert.equal(await completeTelegramLinks(env, "owner"), true);
	assert.equal((await getTrackingPreferences(env, "owner")).telegramLinked, true);
	assert.equal(env.DB.db.prepare("SELECT telegram_chat_id AS chat, telegram_link_code AS code FROM user_tracking_preferences").get().chat, "999");
	assert.equal(env.DB.db.prepare("SELECT telegram_link_code AS code FROM user_tracking_preferences").get().code, null);
	assert.ok(calls.some((call) => call.method === "getUpdates" && call.body.offset === 9), "processed updates are confirmed");
});

test("summary emails go out once per period and skip empty ones", async (t) => {
	const { env, sent, trackedMessage } = await fixture(t);
	stubTelegram(t);
	await updateTrackingPreferences(env, "owner", { summaryFrequency: "daily", hotOpenThreshold: 0 });
	const now = new Date("2026-11-24T02:00:00Z");
	const sentAt = Math.floor(now.getTime() / 1000) - 3600 * 5;
	const token = trackedMessage("digest", { sentAt });
	env.DB.db.prepare("INSERT INTO message_opens (id, token, opened_at, automated) VALUES ('o1', ?, ?, 0)").run(token, sentAt + 60);
	await runTrackingSummaries(env, now);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].to[0], "owner@example.com");
	assert.match(sent[0].subject, /^Read receipts today: 1 opened, 0 clicks, 0 replies$/);
	assert.match(sent[0].text, /Subject digest/);
	await runTrackingSummaries(env, now);
	assert.equal(sent.length, 1, "an overlapping run does not send twice");
	await runTrackingSummaries(env, new Date(now.getTime() + 24 * 3600_000));
	assert.equal(sent.length, 1, "a day with no activity sends nothing");
});

test("engagement credits opens only where the recipient is known", async (t) => {
	const { env, run, trackedMessage } = await fixture(t);
	const now = Math.floor(Date.now() / 1000);
	run("UPDATE message_tracking SET open_count = 2, last_opened_at = ? WHERE token = ?", now, trackedMessage("solo", { to: "ann@acme.test", sentAt: now - 100 }));
	run("UPDATE message_tracking SET open_count = 5 WHERE token = ?", trackedMessage("group", { to: "ann@acme.test, bob@acme.test", sentAt: now - 90 }));
	run("INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, thread_id, created_at) VALUES ('sep', 'owner', 'mine', 'outbound', 'owner@example.com', 'ann@acme.test, bob@acme.test', 'Separate', 'sent', 1, 'thr-sep', ?)", now - 80);
	run("INSERT INTO message_tracking (token, message_id, recipient, open_count, created_at) VALUES ('tok-sep-ann-xxxxxxxxxxx', 'sep', 'ann@acme.test', 0, ?), ('tok-sep-bob-xxxxxxxxxxx', 'sep', 'bob@acme.test', 1, ?)", now - 80, now - 80);
	run("INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, thread_id, created_at) VALUES ('r', 'owner', 'mine', 'inbound', 'Bob <bob@acme.test>', 'owner@example.com', 'Re', 'received', 0, 'thr-sep', ?)", now - 10);
	const rows = await listContactEngagement(env, { id: "owner", email: "owner@example.com", role: "admin" });
	const byAddress = Object.fromEntries(rows.map((row) => [row.address, row]));
	assert.deepEqual(
		{ sent: byAddress["ann@acme.test"].sent, opened: byAddress["ann@acme.test"].opened, opens: byAddress["ann@acme.test"].opens, replied: byAddress["ann@acme.test"].replied },
		{ sent: 3, opened: 1, opens: 2, replied: 0 },
		"the group send's 5 opens are not credited to Ann",
	);
	assert.deepEqual(
		{ sent: byAddress["bob@acme.test"].sent, opened: byAddress["bob@acme.test"].opened, opens: byAddress["bob@acme.test"].opens, replied: byAddress["bob@acme.test"].replied },
		{ sent: 2, opened: 1, opens: 1, replied: 1 },
	);
	const csv = await exportTrackedMessagesCsv(env, { id: "owner", email: "owner@example.com", role: "admin" });
	assert.match(csv, /^sent_at,from,subject,to,cc,copy_for,status,opens,clicks,replied\r\n/);
	assert.match(csv, /,bob@acme\.test,opened,1,0,yes\r\n/);
});

test("pure helpers: start codes, alert text, CSV cells and summary schedule", () => {
	assert.equal(parseStartCode("/start abcdefgh1234"), "abcdefgh1234");
	assert.equal(parseStartCode("/start@zeal_test_bot abcdefgh1234"), "abcdefgh1234");
	assert.equal(parseStartCode("/start"), null);
	assert.equal(parseStartCode("hello"), null);
	assert.equal(formatTelegramAlert({ kind: "click", subject: "Deal", recipient: "a@b.c", url: "https://x", fileName: "q.pdf" }), "🔗 Clicked file q.pdf: Deal · a@b.c");
	assert.equal(formatTelegramAlert({ kind: "hot", subject: "", recipient: null, opens: 3 }), "🔥 Opened 3× without a reply, time to follow up: (no subject)");
	assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
	assert.equal(csvCell("a,\"b\""), "\"a,\"\"b\"\"\"");
	assert.equal(csvCell(null), "");
	assert.deepEqual(dueSummaryFrequencies(new Date("2026-11-23T02:00:00Z")), ["daily", "weekly"]);
	assert.deepEqual(dueSummaryFrequencies(new Date("2026-11-24T02:00:00Z")), ["daily"]);
	assert.equal(summaryRecentlySent(new Date("2026-11-23T02:00:00Z"), "daily", new Date("2026-11-24T02:00:00Z")), false);
	assert.equal(summaryRecentlySent(new Date("2026-11-24T01:00:00Z"), "daily", new Date("2026-11-24T02:00:00Z")), true);
	assert.equal(summaryRecentlySent(new Date("2026-11-20T02:00:00Z"), "weekly", new Date("2026-11-23T02:00:00Z")), true);
});
