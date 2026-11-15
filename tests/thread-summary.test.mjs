import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailflare-thread-summary-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `export * from "./src/lib/agent/thread-summary-utils.ts";`,
		resolveDir: root,
		sourcefile: "thread-summary-test-entry.js",
	},
	outfile: join(outDir, "thread-summary.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});

const { stripQuotedText, buildThreadTranscript, parseSummaryPoints, SUMMARY_TRANSCRIPT_CHARS } = await import(pathToFileURL(join(outDir, "thread-summary.mjs")).href);

const message = (text, extra = {}) => ({ from: "a@example.com", date: new Date("2026-11-01T10:00:00Z"), direction: "inbound", subject: "Plan", text, ...extra });

test("quoted replies and attribution tails are dropped", () => {
	assert.equal(stripQuotedText("Sounds good.\n\n> earlier text\n> more"), "Sounds good.");
	assert.equal(stripQuotedText("Yes, Friday.\r\n\r\nOn Mon, 2 Nov 2026 at 10:00, Ann <a@x.y> wrote:\r\n> Can you?"), "Yes, Friday.");
	assert.equal(stripQuotedText("FYI\n-----Original Message-----\nFrom: someone"), "FYI");
});

test("the transcript is oldest first, marks this mailbox and names the subject once", () => {
	const transcript = buildThreadTranscript([
		message("Can we meet Friday?"),
		message("Friday works.", { from: "me@example.com", direction: "outbound", subject: "Re: Plan" }),
	]);
	assert.match(transcript, /^Message 1 from a@example\.com on 2026-11-01T10:00:00\.000Z\nSubject: Plan\nCan we meet Friday\?/);
	assert.match(transcript, /Message 2 from me@example\.com \(this mailbox\)/);
	assert.doesNotMatch(transcript, /Re: Plan/);
});

test("over budget, the oldest messages are omitted and the latest kept", () => {
	const long = "x".repeat(2_900);
	const transcript = buildThreadTranscript(Array.from({ length: 20 }, (_, index) => message(`${index} ${long}`)));
	assert.ok(transcript.length <= SUMMARY_TRANSCRIPT_CHARS + 100);
	assert.match(transcript, /^\(\d+ earlier messages omitted\)/);
	assert.match(transcript, /Message 20 from/);
	assert.doesNotMatch(transcript, /Message 1 from/);
});

test("summary points lose bullets and markdown and drop a lead-in line", () => {
	assert.deepEqual(
		parseSummaryPoints("Here is a summary:\n- **Ann** asked to meet Friday\n* Bob agreed\n2. Room still open\n\n## Next\n"),
		["Ann asked to meet Friday", "Bob agreed", "Room still open", "Next"],
	);
	assert.deepEqual(parseSummaryPoints("   \n\n"), []);
});
