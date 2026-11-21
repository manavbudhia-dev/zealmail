import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// The Tracking dashboard's numbers, computed for real against an in-memory SQLite database.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-tracking-overview-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		overview: join(root, "src/lib/tracking/overview.ts"),
		utils: join(root, "src/lib/tracking/overview-utils.ts"),
		chart: join(root, "src/components/tracking/tracking-dashboard-utils.ts"),
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
const { getTrackingOverview } = await load("overview");
const { buildDailySeries, pickWarmMessages, percent, parseOverviewDays, dayKey, displayRecipient } = await load("utils");
const { niceAxisMax, labelEvery, columnPath } = await load("chart");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

const NOW = new Date("2026-11-21T12:00:00Z");
const s = (date) => Math.floor(date.getTime() / 1000);
const hoursAgo = (hours) => s(new Date(NOW.getTime() - hours * 3600_000));
const owner = { id: "owner", email: "owner@example.com", role: "admin" };

async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const run = (sql, ...params) => database.db.prepare(sql).run(...params);
	database.db.exec(`
		INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('owner', 'owner@example.com', 'Owner', 'x', 'admin', 0), ('other', 'other@example.com', 'Other', 'x', 'user', 0);
		INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('domain', 'owner', 'example.com', 'zone', 0);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES ('mine', 'owner', 'domain', 'owner', 'personal', 0, 0), ('theirs', 'other', 'domain', 'other', 'personal', 0, 0);
	`);
	const sent = (id, { mailbox = "mine", at = hoursAgo(30), to = "ann@acme.test", opens = 0, lastOpened = null } = {}) => {
		run("INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, thread_id, created_at) VALUES (?, 'owner', ?, 'outbound', 'owner@example.com', ?, ?, 'sent', 1, ?, ?)", id, mailbox, to, `Subject ${id}`, `thr-${id}`, at);
		run("INSERT INTO message_tracking (token, message_id, recipient, open_count, last_opened_at, created_at) VALUES (?, ?, '', ?, ?, ?)", `tok-${id}`, id, opens, lastOpened, at);
	};
	const open = (id, at, automated = 0) => run("INSERT INTO message_opens (id, token, opened_at, client, device, city, country, automated) VALUES (?, ?, ?, 'Gmail', 'iPhone', 'Zürich', 'CH', ?)", `o-${id}-${at}`, `tok-${id}`, at, automated);
	return { database, run, sent, open, env: { DB: database } };
}

test("totals, daily series, warm messages and activity follow the recorded events", async (t) => {
	const { run, sent, open, env } = await fixture(t);
	sent("hot", { opens: 2, lastOpened: hoursAgo(2) });
	open("hot", hoursAgo(5));
	open("hot", hoursAgo(2));
	open("hot", hoursAgo(1), 1); // automated: never counted or listed
	sent("answered", { opens: 1, lastOpened: hoursAgo(3) });
	open("answered", hoursAgo(3));
	run("INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, read, thread_id, created_at) VALUES ('reply', 'owner', 'mine', 'inbound', 'ann@acme.test', 'owner@example.com', 'Re', 'received', 0, 'thr-answered', ?)", hoursAgo(1));
	sent("quiet");
	sent("old", { at: hoursAgo(24 * 40), opens: 1 });
	sent("foreign", { mailbox: "theirs", opens: 5 });
	open("foreign", hoursAgo(1));
	run("INSERT INTO message_links (id, token, url, click_count, last_clicked_at, created_at) VALUES ('link-hot-xxxxxxxxxxxxxx', 'tok-hot', 'https://acme.test/pricing', 1, ?, ?)", hoursAgo(4), hoursAgo(30));
	run("INSERT INTO message_link_clicks (id, link_id, clicked_at, client, automated) VALUES ('c1', 'link-hot-xxxxxxxxxxxxxx', ?, 'Chrome', 0)", hoursAgo(4));

	const overview = await getTrackingOverview(env, owner, { days: 14, timeZone: "UTC", now: NOW });
	assert.deepEqual(overview.totals, { sent: 3, opened: 2, clicked: 1, replied: 1 }, "the 40-day-old send and another user's mailbox are left out");
	assert.equal(overview.daily.length, 14);
	assert.equal(overview.daily.at(-1).date, "2026-11-21");
	assert.equal(overview.daily.reduce((total, day) => total + day.opens, 0), 3, "real opens only");
	assert.equal(overview.daily.reduce((total, day) => total + day.clicks, 0), 1);
	assert.equal(overview.daily.find((day) => day.date === "2026-11-20").sent, 3);
	assert.deepEqual(overview.warm.map((item) => [item.messageId, item.opens, item.clicks]), [["hot", 2, 1]], "answered messages are not warm");
	assert.deepEqual(overview.activity.map((event) => `${event.kind}:${event.messageId}`), ["open:hot", "open:answered", "click:hot", "open:hot"]);
	assert.equal(overview.activity[0].city, "Zürich");
	assert.ok(overview.activity.every((event) => event.messageId !== "foreign"));
});

test("tracked files list the file by name with its opens", async (t) => {
	const { run, sent, env } = await fixture(t);
	sent("deck");
	run("INSERT INTO message_attachments (id, message_id, filename, content_type, size, r2_key, disposition, created_at) VALUES ('att', 'deck', 'deck.pdf', 'application/pdf', 10, 'k', 'attachment', 0)");
	run("INSERT INTO shared_attachment_links (id, attachment_id, expires_at, created_at) VALUES ('share_1', 'att', 99999999999, 0)");
	run("INSERT INTO message_links (id, token, url, click_count, last_clicked_at, created_at) VALUES ('link-deck-xxxxxxxxxxxxx', 'tok-deck', 'https://mail.example.com/api/shared-files/share_1', 3, ?, 0)", hoursAgo(6));
	const overview = await getTrackingOverview(env, owner, { days: 14, timeZone: "UTC", now: NOW });
	assert.deepEqual(overview.files.map((file) => [file.fileName, file.clicks, file.subject]), [["deck.pdf", 3, "Subject deck"]]);
});

test("an empty account gets a zero dashboard with every day present", async (t) => {
	const { env } = await fixture(t);
	const overview = await getTrackingOverview(env, owner, { days: 7, timeZone: "Asia/Kolkata", now: NOW });
	assert.deepEqual(overview.totals, { sent: 0, opened: 0, clicked: 0, replied: 0 });
	assert.equal(overview.daily.length, 7);
	assert.deepEqual([overview.warm, overview.activity, overview.files, overview.followUps], [[], [], [], []]);
});

test("pure helpers: days, buckets, warm ranking and chart geometry", () => {
	assert.equal(parseOverviewDays("30"), 30);
	assert.equal(parseOverviewDays("99"), 14);
	assert.equal(parseOverviewDays(null), 14);
	assert.equal(dayKey(new Date("2026-11-21T20:00:00Z"), "Asia/Kolkata"), "2026-11-22", "days follow the viewer's time zone");
	assert.equal(dayKey(new Date("2026-11-21T20:00:00Z"), "Not/AZone"), "2026-11-21");
	const series = buildDailySeries(3, NOW, "UTC", { sent: [new Date("2026-11-21T01:00:00Z"), new Date("2026-11-10T01:00:00Z")], opens: [new Date("2026-11-19T23:00:00Z")], clicks: [] });
	assert.deepEqual(series, [
		{ date: "2026-11-19", sent: 0, opens: 1, clicks: 0 },
		{ date: "2026-11-20", sent: 0, opens: 0, clicks: 0 },
		{ date: "2026-11-21", sent: 1, opens: 0, clicks: 0 },
	]);
	const warm = pickWarmMessages([
		{ kind: "open", at: new Date("2026-11-21T10:00:00Z"), messageId: "a", subject: "A", recipient: "a@x" },
		{ kind: "click", at: new Date("2026-11-21T11:00:00Z"), messageId: "b", subject: "B", recipient: "b@x" },
		{ kind: "open", at: new Date("2026-11-18T11:00:00Z"), messageId: "c", subject: "C", recipient: "c@x" },
		{ kind: "open", at: new Date("2026-11-21T11:30:00Z"), messageId: "d", subject: "D", recipient: "d@x" },
	], new Date("2026-11-19T12:00:00Z"), new Set(["d"]));
	assert.deepEqual(warm.map((item) => item.messageId), ["b", "a"]);
	assert.equal(percent(1, 3), 33);
	assert.equal(percent(5, 0), 0);
	assert.equal(niceAxisMax(0), 1);
	assert.equal(niceAxisMax(5), 6, "even, so the midpoint gridline is a whole count");
	assert.equal(niceAxisMax(7), 8);
	assert.equal(niceAxisMax(13), 20);
	assert.equal(niceAxisMax(41), 60);
	assert.equal(labelEvery(30), 5);
	assert.equal(displayRecipient("Ann Lee <ann@acme.test>"), "Ann Lee");
	assert.equal(displayRecipient("\"Lee, Ann\" <ann@acme.test>"), "Lee, Ann");
	assert.equal(displayRecipient("bob@acme.test"), "bob@acme.test");
	assert.equal(displayRecipient(null), null);
	assert.equal(labelEvery(7), 1);
	assert.match(columnPath(0, 10, 8, 30), /^M0,40V14Q0,10 4,10H4Q8,10 8,14V40Z$/);
});
