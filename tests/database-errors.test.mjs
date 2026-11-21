import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-database-errors-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		errors: join(root, "src/lib/database-errors.ts"),
		tracking: join(root, "src/lib/tracking/open-tracking.ts"),
		database: join(root, "server/runtime/sqlite-database.ts"),
		migrate: join(root, "server/runtime/migrate.ts"),
		links: join(root, "src/lib/tracking/link-tracking.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	external: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*"],
	logLevel: "silent",
});

const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const { isMissingTableError, isUniqueConstraintError } = await load("errors");
const { getTrackingStates, getRepliedMessageIds, getMessageTrackingSummary } = await load("tracking");
const { ensureTrackedLinks, recordClick } = await load("links");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

test("driver errors are found through drizzle's wrapper", () => {
	const wrapped = new Error("Failed query: select 1\nparams: ", { cause: new Error("no such table: message_tracking") });
	assert.equal(isMissingTableError(wrapped), true);
	assert.equal(isMissingTableError(new Error("D1_ERROR: no such table: x: SQLITE_ERROR")), true);
	assert.equal(isMissingTableError(new Error("Failed query", { cause: new Error("database is locked") })), false);
	assert.equal(isUniqueConstraintError(new Error("Failed query", { cause: new Error("UNIQUE constraint failed: domain_tracking_hosts.hostname") })), true);
	assert.equal(isUniqueConstraintError(new Error("no such table")), false);
});

test("message lists with sent mail keep working before migration 0068", async (t) => {
	const database = new SqliteDatabase(join(outDir, "empty.sqlite"));
	t.after(() => database.db.close());
	const states = await getTrackingStates({ DB: database }, ["m1"]);
	assert.equal(states.size, 0);
});

async function migratedDatabase(t, { withoutLinks = false, skip = withoutLinks ? ["0088_", "0089_"] : [] } = {}) {
	const directory = join(root, "drizzle/migrations");
	let source = directory;
	if (skip.length) {
		source = mkdtempSync(join(outDir, "migrations-"));
		for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql") && !skip.some((prefix) => file.startsWith(prefix)))) {
			copyFileSync(join(directory, name), join(source, name));
		}
	}
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, source);
	database.db.exec(`
		INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('owner', 'owner@example.com', 'Owner', 'x', 'admin', 0);
		INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('domain', 'owner', 'example.com', 'zone', 0);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES ('mine', 'owner', 'domain', 'owner', 'personal', 0, 0);
	`);
	const message = (id, direction, time, thread = "thread") => database.db.prepare(`INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, status, read, thread_id, created_at)
		VALUES (?, 'owner', 'mine', ?, 'owner@example.com', 'friend@example.com', ?, 1, ?, ?)`).run(id, direction, direction === "outbound" ? "sent" : "received", thread, time);
	return { env: { DB: database }, database, message };
}

test("tick states work before the click-tracking migration", async (t) => {
	const { env, database, message } = await migratedDatabase(t, { withoutLinks: true });
	message("sent", "outbound", 100);
	message("probed", "outbound", 100, "other");
	database.db.exec(`
		INSERT INTO message_tracking (token, message_id, open_count, created_at) VALUES ('t-sent', 'sent', 0, 100), ('t-probed', 'probed', 0, 100);
		INSERT INTO message_opens (id, token, opened_at, automated) VALUES ('o1', 't-probed', 101, 1);
	`);
	const states = await getTrackingStates(env, ["sent", "probed", "untracked"]);
	assert.deepEqual(states.get("sent"), { state: "sent", opens: 0, clicks: 0, lastActivityAt: null });
	assert.deepEqual(states.get("probed"), { state: "possible", opens: 0, clicks: 0, lastActivityAt: null });
	assert.equal(states.has("untracked"), false);
	const summary = await getMessageTrackingSummary(env, "sent");
	assert.deepEqual(summary.links, []);
	assert.equal(summary.clickCount, 0);
});

test("tick states and summaries work before the per-recipient migration", async (t) => {
	const { env, database, message } = await migratedDatabase(t, { skip: ["0089_"] });
	message("sent", "outbound", 100);
	database.db.exec(`INSERT INTO message_tracking (token, message_id, open_count, last_opened_at, created_at) VALUES ('t-sent', 'sent', 1, 150, 100);`);
	assert.deepEqual((await getTrackingStates(env, ["sent"])).get("sent"), { state: "opened", opens: 1, clicks: 0, lastActivityAt: "1970-01-01T00:02:30.000Z" });
	const summary = await getMessageTrackingSummary(env, "sent");
	assert.equal(summary.openCount, 1);
	assert.deepEqual(summary.recipients, []);
});

test("a real click marks a message opened and redirects to the stored target", async (t) => {
	const { env, database, message } = await migratedDatabase(t);
	message("sent", "outbound", Math.floor(Date.now() / 1000) - 600);
	database.db.prepare("INSERT INTO message_tracking (token, message_id, open_count, created_at) VALUES ('t-sent', 'sent', 0, ?)").run(Math.floor(Date.now() / 1000) - 600);
	const ids = await ensureTrackedLinks(env, "t-sent", ["https://example.com/a", "https://example.com/b"]);
	assert.equal(ids.size, 2);
	assert.deepEqual(await ensureTrackedLinks(env, "t-sent", ["https://example.com/a"]), new Map([["https://example.com/a", ids.get("https://example.com/a")], ["https://example.com/b", ids.get("https://example.com/b")]]), "a retried delivery reuses its ids");

	const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
	assert.equal(await recordClick(env, ids.get("https://example.com/b"), { method: "HEAD", userAgent: chrome }), "https://example.com/b");
	assert.deepEqual((await getTrackingStates(env, ["sent"])).get("sent"), { state: "possible", opens: 0, clicks: 0, lastActivityAt: null });
	assert.equal(await recordClick(env, ids.get("https://example.com/a"), { method: "GET", userAgent: chrome, country: "CH" }), "https://example.com/a");
	assert.equal(await recordClick(env, ids.get("https://example.com/a"), { method: "GET", userAgent: chrome, country: "CH" }), "https://example.com/a", "a duplicate click still redirects");
	const clicked = (await getTrackingStates(env, ["sent"])).get("sent");
	assert.deepEqual({ ...clicked, lastActivityAt: undefined }, { state: "opened", opens: 0, clicks: 1, lastActivityAt: undefined });
	assert.ok(Math.abs(Date.parse(clicked.lastActivityAt) - Date.now()) < 60_000, "a click is the latest activity");
	assert.equal(await recordClick(env, "unknownunknownunknown0", { method: "GET", userAgent: chrome }), null);

	const summary = await getMessageTrackingSummary(env, "sent");
	assert.equal(summary.clickCount, 1);
	assert.deepEqual(summary.links.map(({ url, clickCount, automatedClicks }) => ({ url, clickCount, automatedClicks })), [
		{ url: "https://example.com/a", clickCount: 1, automatedClicks: 0 },
		{ url: "https://example.com/b", clickCount: 0, automatedClicks: 1 },
	]);
});

test("a sent message counts as replied only after a later inbound message in its thread", async (t) => {
	const { env, message } = await migratedDatabase(t);
	message("early-reply", "inbound", 50, "a");
	message("sent-a", "outbound", 100, "a");
	message("sent-b", "outbound", 100, "b");
	message("reply-b", "inbound", 200, "b");
	const rows = [
		{ id: "sent-a", mailboxId: "mine", threadId: "a", createdAt: new Date(100_000) },
		{ id: "sent-b", mailboxId: "mine", threadId: "b", createdAt: new Date(100_000) },
		{ id: "loose", mailboxId: "mine", threadId: null, createdAt: new Date(100_000) },
	];
	assert.deepEqual([...await getRepliedMessageIds(env, rows)], ["sent-b"]);
});
