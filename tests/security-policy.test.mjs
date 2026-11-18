import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-security-policy-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: { utils: join(root, "src/lib/security/policy-utils.ts"), reminder: join(root, "src/components/auth/two-step-reminder-utils.ts") },
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});
const policy = await import(pathToFileURL(join(outDir, "utils.mjs")).href);
const reminder = await import(pathToFileURL(join(outDir, "reminder.mjs")).href);

const DAY = 86_400;

test("a missing or malformed stored policy falls back to the permissive defaults", () => {
	assert.deepEqual(policy.parseSecurityPolicy(null), policy.DEFAULT_SECURITY_POLICY);
	assert.deepEqual(policy.parseSecurityPolicy("{not json"), policy.DEFAULT_SECURITY_POLICY);
	const parsed = policy.parseSecurityPolicy(JSON.stringify({ password: { minLength: 3 }, sessionDays: 9999, twoStep: { enforcement: "everyone", graceDays: -2 }, externalForwarding: "maybe" }));
	assert.equal(parsed.password.minLength, 8);
	assert.equal(parsed.sessionDays, 365);
	assert.equal(parsed.twoStep.enforcement, "off");
	assert.equal(parsed.twoStep.graceDays, 0);
	assert.equal(parsed.twoStep.enforcedAt, null);
	assert.equal(parsed.externalForwarding, "allow");
});

test("password rules report every missing requirement", () => {
	const rules = { minLength: 12, requireLetters: true, requireNumbers: true, requireSymbols: true };
	assert.deepEqual(policy.checkPassword(rules, "short"), ["too_short", "numbers", "symbols"]);
	assert.deepEqual(policy.checkPassword(rules, "123456789012!"), ["letters"]);
	assert.deepEqual(policy.checkPassword(rules, "correct-horse-7"), []);
	assert.deepEqual(policy.checkPassword(rules, "contraseña-segura-1"), [], "non-ASCII letters count as letters");
	assert.deepEqual(policy.checkPassword(policy.DEFAULT_SECURITY_POLICY.password, "a".repeat(129)), ["too_long"]);
	assert.equal(policy.describePasswordFailures(rules, ["too_short", "numbers", "symbols"]), "Your organization requires passwords with at least 12 characters, a number and a symbol.");
});

test("widening 2-step enforcement restarts the grace period; narrowing or other edits keep it", () => {
	const base = policy.DEFAULT_SECURITY_POLICY;
	const on = policy.mergeSecurityPolicy(base, { ...base, twoStep: { enforcement: "admins", graceDays: 7, enforcedAt: null } }, 1000);
	assert.equal(on.twoStep.enforcedAt, 1000);
	const edited = policy.mergeSecurityPolicy(on, { ...on, sessionDays: 5, twoStep: { ...on.twoStep, enforcedAt: null } }, 2000);
	assert.equal(edited.twoStep.enforcedAt, 1000);
	const widened = policy.mergeSecurityPolicy(edited, { ...edited, twoStep: { ...edited.twoStep, enforcement: "all" } }, 3000);
	assert.equal(widened.twoStep.enforcedAt, 3000);
	const narrowed = policy.mergeSecurityPolicy(widened, { ...widened, twoStep: { ...widened.twoStep, enforcement: "admins" } }, 4000);
	assert.equal(narrowed.twoStep.enforcedAt, 3000);
	const off = policy.mergeSecurityPolicy(narrowed, { ...narrowed, twoStep: { ...narrowed.twoStep, enforcement: "off" } }, 5000);
	assert.equal(off.twoStep.enforcedAt, null);
});

test("2-step status follows scope, enrolment and the later of enforcement or account creation", () => {
	const active = { ...policy.DEFAULT_SECURITY_POLICY, twoStep: { enforcement: "admins", graceDays: 7, enforcedAt: 10 * DAY } };
	const admin = { role: "admin", totpEnabled: false, passkeyCount: 0, createdAt: new Date(0) };
	const user = { ...admin, role: "user" };
	assert.equal(policy.getTwoStepStatus(active, user, 100 * DAY).required, false);
	assert.deepEqual(policy.getTwoStepStatus(active, admin, 16 * DAY), { required: true, enrolled: false, deadline: 17 * DAY, overdue: false });
	assert.equal(policy.getTwoStepStatus(active, admin, 17 * DAY).overdue, true);
	assert.equal(policy.getTwoStepStatus(active, { ...admin, passkeyCount: 1 }, 99 * DAY).overdue, false, "a passkey counts");
	assert.equal(policy.getTwoStepStatus(active, { ...admin, totpEnabled: true }, 99 * DAY).overdue, false, "TOTP counts");
	const newcomer = { ...admin, createdAt: new Date(50 * DAY * 1000) };
	assert.equal(policy.getTwoStepStatus(active, newcomer, 52 * DAY).deadline, 57 * DAY, "new accounts get their own grace period");
	const everyone = { ...active, twoStep: { ...active.twoStep, enforcement: "all", graceDays: 0 } };
	assert.equal(policy.getTwoStepStatus(everyone, user, 10 * DAY).overdue, true, "a zero-day grace period applies at once");
});

test("forwarding stays internal only for the installation's domains and their subdomains", () => {
	const hosts = ["example.com", "Mail.Example.org."];
	assert.equal(policy.isExternalAddress("someone@example.com", hosts), false);
	assert.equal(policy.isExternalAddress("Someone <a@team.example.com>", hosts), false);
	assert.equal(policy.isExternalAddress("a@mail.example.org", hosts), false);
	assert.equal(policy.isExternalAddress("a@example.org", hosts), true);
	assert.equal(policy.isExternalAddress("a@notexample.com", hosts), true);
	assert.equal(policy.isExternalAddress("a@example.com.evil.net", hosts), true);
	assert.equal(policy.isExternalAddress("no-at-sign", hosts), true);
});

test("the reminder shows during the grace period and the restriction once it passes", () => {
	assert.equal(reminder.twoStepReminderKind({ required: false, enrolled: false, deadline: null, overdue: false }), null);
	assert.equal(reminder.twoStepReminderKind({ required: true, enrolled: true, deadline: 1, overdue: false }), null);
	assert.equal(reminder.twoStepReminderKind({ required: true, enrolled: false, deadline: 1, overdue: false }), "grace");
	assert.equal(reminder.twoStepReminderKind({ required: true, enrolled: false, deadline: 1, overdue: true }), "overdue");
	assert.equal(reminder.isTwoStepSetupPath("/settings/security"), true);
	assert.equal(reminder.isTwoStepSetupPath("/settings/securityx"), false);
	assert.equal(reminder.isTwoStepSetupPath("/inbox"), false);
});

await build({
	entryPoints: {
		service: join(root, "src/lib/security/policy.ts"),
		forwarding: join(root, "src/lib/email/account-forwarding.ts"),
		database: join(root, "server/runtime/sqlite-database.ts"),
		migrate: join(root, "server/runtime/migrate.ts"),
	},
	// One shared copy of policy.ts, so its cache is the one both entry points read.
	splitting: true,
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
const service = await load("service");
const forwarding = await load("forwarding");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

async function createFixture(t) {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const now = Math.floor(Date.now() / 1000);
	database.db.prepare("INSERT INTO users (id, email, name, password_hash, forwarding_email, created_at) VALUES ('u1', 'kevin@example.com', 'Kevin', 'x', 'kevin@gmail.com', ?)").run(now);
	database.db.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at) VALUES ('d1', 'u1', 'example.com', 'zone', 'active', ?)").run(now);
	database.db.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES ('mb1', 'u1', 'd1', 'kevin', ?)").run(now);
	return { env: { DB: database }, database, now };
}

test("the policy is stored, enforced on passwords and caps existing sessions", async (t) => {
	const { env, database, now } = await createFixture(t);
	const saved = await service.saveSecurityPolicy(env, { ...policy.DEFAULT_SECURITY_POLICY, password: { minLength: 10, requireLetters: false, requireNumbers: true, requireSymbols: false }, sessionDays: 2 });
	assert.equal(saved.sessionDays, 2);
	assert.equal(JSON.parse(database.db.prepare("SELECT security_policy FROM app_settings WHERE id = 'default'").get().security_policy).sessionDays, 2);
	assert.match(await service.getPasswordPolicyError(env, "abcdefghij"), /a number/);
	assert.equal(await service.getPasswordPolicyError(env, "abcdefghi1"), null);
	assert.equal(await service.getSessionLifetimeMs(env), 2 * DAY * 1000);

	const insert = database.db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, 'u1', ?, ?, ?)");
	insert.run("old", "h1", now + 20 * DAY, now - 5 * DAY);
	insert.run("new", "h2", now + DAY, now);
	await service.capSessionLifetimes(env, 2);
	const expiry = (id) => database.db.prepare("SELECT expires_at FROM sessions WHERE id = ?").get(id).expires_at;
	assert.equal(expiry("old"), now - 3 * DAY, "an old session now expires two days after it began");
	assert.equal(expiry("new"), now + DAY, "a session already inside the limit is untouched");
});

test("blocking external forwarding stops saved outside forwards but keeps internal ones", async (t) => {
	const { env, database } = await createFixture(t);
	await service.saveSecurityPolicy(env, { ...policy.DEFAULT_SECURITY_POLICY, externalForwarding: "allow" });
	assert.equal(await forwarding.getAccountForwardingDestination(env, "kevin@example.com"), "kevin@gmail.com");
	await service.saveSecurityPolicy(env, { ...policy.DEFAULT_SECURITY_POLICY, externalForwarding: "block" });
	assert.equal(await forwarding.getAccountForwardingDestination(env, "kevin@example.com"), null);
	assert.equal((await service.checkForwardingAddress(env, "x@gmail.com"))?.status, 403);
	assert.equal(await service.checkForwardingAddress(env, "team@sales.example.com"), null);
	database.db.prepare("UPDATE users SET forwarding_email = 'archive@example.com'").run();
	assert.equal(await forwarding.getAccountForwardingDestination(env, "kevin@example.com"), "archive@example.com");
});
