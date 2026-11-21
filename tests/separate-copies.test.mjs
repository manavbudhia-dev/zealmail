import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Runs the real sendEmail against an in-memory SQLite database and a recording send binding,
// so per-recipient copies, their tracking rows, retries and reply threading are checked end to end.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-separate-copies-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		send: join(root, "src/lib/email/send.ts"),
		tracking: join(root, "src/lib/tracking/open-tracking.ts"),
		threading: join(root, "src/lib/email/threading.ts"),
		db: join(root, "src/db/index.ts"),
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
const { sendEmail, processOutboundQueue } = await load("send");
const { getTrackingStates, getMessageTrackingSummary } = await load("tracking");
const { resolveThreadId } = await load("threading");
const { getDb } = await load("db");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

async function fixture(t, { failFor = [] } = {}) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('owner', 'owner@example.com', 'Owner', 'x', 'admin', 0);
		INSERT INTO domains (id, user_id, hostname, zone_id, sending_provider, created_at) VALUES ('domain', 'owner', 'example.com', 'zone', 'cloudflare', 0);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES ('mine', 'owner', 'domain', 'owner', 'personal', 0, 0);
	`);
	const sent = [];
	let counter = 0;
	const env = {
		DB: database,
		APP_URL: "https://mail.example.com",
		OUTBOUND_QUEUE: { queued: [], async send(message) { this.queued.push(message); } },
		EMAIL: {
			async send(message) {
				if (failFor.includes(message.to[0])) throw new Error(`rejected ${message.to[0]}`);
				sent.push(message);
				counter += 1;
				return { messageId: `<copy-${counter}@cloudflare.test>` };
			},
		},
	};
	const send = (overrides = {}) => sendEmail(env, {
		userId: "owner",
		from: "owner@example.com",
		to: ["Ann <ann@acme.test>", "bob@acme.test"],
		cc: ["cat@acme.test"],
		subject: "Proposal",
		html: `<p>See <a href="https://example.org/pricing">pricing</a></p>`,
		text: "See pricing",
		mailboxId: "mine",
		trackOpens: true,
		separateCopies: true,
		...overrides,
	});
	const rows = (sql, ...params) => database.db.prepare(sql).all(...params);
	return { env, database, sent, send, rows };
}

test("each recipient gets a copy addressed only to them, with its own pixel and links", async (t) => {
	const { env, database, sent, send, rows } = await fixture(t);
	const { messageId } = await send();
	assert.deepEqual(sent.map((message) => message.to), [["Ann <ann@acme.test>"], ["bob@acme.test"], ["cat@acme.test"]]);
	for (const message of sent) {
		assert.equal(message.cc, undefined);
		assert.equal(message.bcc, undefined);
	}
	const pixels = sent.map((message) => message.html.match(/\/api\/i\/([\w-]+)\.gif/)[1]);
	const links = sent.map((message) => message.html.match(/\/api\/l\/([\w-]+)/)[1]);
	assert.equal(new Set(pixels).size, 3);
	assert.equal(new Set(links).size, 3);

	const tracking = rows("SELECT recipient, provider_message_id FROM message_tracking WHERE message_id = ? ORDER BY recipient", messageId);
	assert.deepEqual(tracking.map((row) => row.recipient), ["ann@acme.test", "bob@acme.test", "cat@acme.test"]);
	assert.ok(tracking.every((row) => row.provider_message_id));
	const [stored] = rows("SELECT status, to_addr, cc_addr, provider_message_id, thread_id, html_body FROM messages WHERE id = ?", messageId);
	assert.equal(stored.status, "sent");
	assert.equal(stored.to_addr, "Ann <ann@acme.test>, bob@acme.test");
	assert.equal(stored.cc_addr, "cat@acme.test");
	assert.equal(stored.provider_message_id, "<copy-1@cloudflare.test>");
	assert.equal(stored.html_body, `<p>See <a href="https://example.org/pricing">pricing</a></p>`, "the stored Sent copy has no pixel or click links");

	// Opens are counted per recipient: Bob opens his copy.
	const bobToken = pixels[1];
	database.db.prepare("UPDATE message_tracking SET open_count = 2, last_opened_at = 999999999 WHERE token = ?").run(bobToken);
	assert.deepEqual((await getTrackingStates(env, [messageId])).get(messageId), { state: "opened", opens: 2, clicks: 0, recipients: 3, openedBy: 1 });
	const summary = await getMessageTrackingSummary(env, messageId);
	assert.equal(summary.openCount, 2);
	assert.deepEqual(summary.recipients.map((recipient) => [recipient.recipient, recipient.state, recipient.openCount]), [
		["ann@acme.test", "sent", 0],
		["bob@acme.test", "opened", 2],
		["cat@acme.test", "sent", 0],
	]);
	assert.deepEqual(summary.links.map((link) => link.url), ["https://example.org/pricing"], "the same link in every copy is one line");
});

test("a reply to any copy joins the conversation", async (t) => {
	const { env, send } = await fixture(t);
	const { messageId } = await send();
	const db = getDb(env);
	const [row] = env.DB.db.prepare("SELECT thread_id FROM messages WHERE id = ?").all(messageId);
	for (const [copy, sender] of [["copy-1@cloudflare.test", "ann@acme.test"], ["copy-3@cloudflare.test", "cat@acme.test"]]) {
		const threadId = await resolveThreadId(db, { mailboxId: "mine", inReplyTo: copy, references: [], messageId: `reply-${copy}`, senderAddress: sender });
		assert.equal(threadId, row.thread_id, copy);
	}
	const stranger = await resolveThreadId(db, { mailboxId: "mine", inReplyTo: "copy-2@cloudflare.test", references: [], messageId: "reply-x", senderAddress: "mallory@evil.test" });
	assert.notEqual(stranger, row.thread_id, "a non-participant cannot join by naming a copy");
});

test("a failed copy does not fail the send, and is reported on the job", async (t) => {
	const { send, sent, rows } = await fixture(t, { failFor: ["bob@acme.test"] });
	const { messageId } = await send();
	assert.deepEqual(sent.map((message) => message.to[0]), ["Ann <ann@acme.test>", "cat@acme.test"]);
	const [job] = rows("SELECT status, error FROM outbound_jobs WHERE message_id = ?", messageId);
	assert.equal(job.status, "sent");
	assert.equal(job.error, "Not delivered to: bob@acme.test");
	assert.equal(rows("SELECT provider_message_id FROM message_tracking WHERE message_id = ? AND recipient = 'bob@acme.test'", messageId)[0].provider_message_id, null);
});

test("when every copy fails the send fails", async (t) => {
	const { send, rows } = await fixture(t, { failFor: ["Ann <ann@acme.test>", "bob@acme.test", "cat@acme.test"] });
	await assert.rejects(send(), /rejected/);
	assert.equal(rows("SELECT status FROM messages")[0].status, "failed");
});

test("one recipient, tracking off, or separate copies off send a single copy as before", async (t) => {
	for (const overrides of [{ to: ["ann@acme.test"], cc: [] }, { trackOpens: false }, { separateCopies: false }]) {
		const { send, sent, rows } = await fixture(t);
		const { messageId } = await send(overrides);
		assert.equal(sent.length, 1, JSON.stringify(overrides));
		const tracking = rows("SELECT recipient FROM message_tracking WHERE message_id = ?", messageId);
		assert.deepEqual(tracking.map((row) => row.recipient), overrides.trackOpens === false ? [] : [""]);
	}
});

test("the composer's undo-send path keeps separate copies through the queue", async (t) => {
	const { env, send, sent, database } = await fixture(t);
	const result = await send({ undoSend: true });
	assert.equal(result.scheduled, true);
	assert.equal(sent.length, 0, "nothing goes out during the undo window");
	const [payload] = env.OUTBOUND_QUEUE.queued;
	database.db.prepare("UPDATE outbound_jobs SET scheduled_at = 1").run();
	await processOutboundQueue(env, payload);
	assert.deepEqual(sent.map((message) => message.to), [["Ann <ann@acme.test>"], ["bob@acme.test"], ["cat@acme.test"]]);
});
