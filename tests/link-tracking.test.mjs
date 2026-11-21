import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = mkdtempSync(join(root, "node_modules", "mailflare-link-tracking-bundle-"));
await build({
	stdin: {
		contents: `export * from "./src/lib/tracking/link-tracking-utils.ts"; export { describeTicks, displayLinkUrl } from "./src/components/messages/message-open-status-utils.ts";`,
		resolveDir: root,
		sourcefile: "link-tracking-test-entry.ts",
	},
	outfile: join(bundleDirectory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});
const links = await import(pathToFileURL(join(bundleDirectory, "entry.mjs")).href);
rmSync(bundleDirectory, { recursive: true, force: true });

const sentAt = new Date("2026-11-21T10:00:00Z");
const later = new Date("2026-11-21T10:05:00Z");
const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("only distinct http(s) links are tracked, decoded and in order", () => {
	const html = `
		<p><a href="https://example.com/a?x=1&amp;y=2">A</a>
		<a class="btn" href='http://example.com/b'>B</a>
		<a href=https://example.com/c>C</a>
		<a href="https://example.com/a?x=1&amp;y=2">A again</a>
		<a href="mailto:me@example.com">mail</a> <a href="tel:+41">tel</a> <a href="#top">top</a>
		<a href="javascript:alert(1)">js</a> <a name="x">anchor</a>
		<a data-no-track href="https://example.com/unsubscribe">unsubscribe</a>
		<a href="https://mail.example.com/api/l/abcdefghijklmnopqrstuvwx">already tracked</a>
		<area href="https://example.com/area"></p>`;
	assert.deepEqual(links.extractTrackableLinks(html), ["https://example.com/a?x=1&y=2", "http://example.com/b", "https://example.com/c"]);
});

test("rewriting replaces only the href of tracked anchors and escapes the new value", () => {
	const html = `<a title="go > there" href="https://example.com/a?x=1&amp;y=2" target="_blank">A</a> <a href="https://other.example/">O</a> <a href="mailto:x@y.z">m</a>`;
	const tracked = new Map([["https://example.com/a?x=1&y=2", "https://t.example.com/api/l/id1?z=1&w=2"]]);
	assert.equal(
		links.rewriteTrackedLinks(html, tracked),
		`<a title="go > there" href="https://t.example.com/api/l/id1?z=1&amp;w=2" target="_blank">A</a> <a href="https://other.example/">O</a> <a href="mailto:x@y.z">m</a>`,
	);
	assert.equal(links.rewriteTrackedLinks(html, new Map()), html);
});

test("unquoted and single-quoted hrefs are rewritten to a double-quoted value", () => {
	const html = `<a href=https://example.com/c>C</a><a href='https://example.com/d'>D</a>`;
	const tracked = new Map([["https://example.com/c", "https://t/api/l/c"], ["https://example.com/d", "https://t/api/l/d"]]);
	assert.equal(links.rewriteTrackedLinks(html, tracked), `<a href="https://t/api/l/c">C</a><a href="https://t/api/l/d">D</a>`);
});

test("the number of tracked links and the URL length are capped", () => {
	const many = Array.from({ length: links.MAX_TRACKED_LINKS + 5 }, (_, i) => `<a href="https://example.com/${i}">${i}</a>`).join("");
	assert.equal(links.extractTrackableLinks(many).length, links.MAX_TRACKED_LINKS);
	const long = `<a href="https://example.com/${"x".repeat(links.MAX_TRACKED_URL_LENGTH)}">long</a>`;
	assert.deepEqual(links.extractTrackableLinks(long), []);
});

test("link ids round-trip through the click path", () => {
	const id = "abcdefghijklmnopqrstuvwx";
	assert.equal(links.parseLinkId(id), id);
	assert.equal(links.parseLinkId("../etc"), null);
	assert.equal(links.parseLinkId("short"), null);
	assert.equal(links.buildTrackedLinkUrl("https://mail.example.com/", id), `https://mail.example.com/api/l/${id}`);
});

test("a person clicking in a browser is a real click with browser and device", () => {
	assert.deepEqual(
		links.classifyClick({ method: "GET", userAgent: chrome, country: "CH", city: "Zürich", sentAt, clickedAt: later }),
		{ client: "Chrome", device: "Windows", country: "CH", city: "Zürich", automated: false },
	);
	const safari = links.classifyClick({ method: "GET", userAgent: iphoneSafari, country: "XX", sentAt, clickedAt: later });
	assert.equal(safari.client, "Safari");
	assert.equal(safari.device, "iPhone");
	assert.equal(safari.country, null);
});

test("scanners, HEAD probes, bare clients and clicks right after delivery are automated", () => {
	const automated = (overrides) => links.classifyClick({ method: "GET", userAgent: chrome, sentAt, clickedAt: later, ...overrides }).automated;
	assert.equal(automated({ method: "HEAD" }), true);
	assert.equal(automated({ userAgent: "" }), true);
	assert.equal(automated({ userAgent: null }), true);
	assert.equal(automated({ userAgent: "python-requests/2.32" }), true);
	assert.equal(automated({ userAgent: "Mozilla/5.0 (compatible; Barracuda Sentinel)" }), true);
	assert.equal(automated({ userAgent: "Mozilla/5.0 (compatible; bingbot/2.0)" }), true);
	assert.equal(automated({ clickedAt: new Date(sentAt.getTime() + 3_000) }), true);
	assert.equal(automated({}), false);
});

test("tick labels describe state, opens, clicks and replies", () => {
	const t = (key, vars) => `${key}${vars ? JSON.stringify(vars) : ""}`;
	assert.equal(links.describeTicks({ state: "sent", opens: 0, clicks: 0 }, false, t), "list.ticks.sent");
	assert.equal(links.describeTicks({ state: "possible", opens: 0, clicks: 0 }, true, t), "list.ticks.possible · list.replied");
	assert.equal(links.describeTicks({ state: "opened", opens: 2, clicks: 1 }, false, t), `list.opened{"count":2} · list.clicked{"count":1}`);
	assert.equal(links.describeTicks({ state: "opened", opens: 0, clicks: 3 }, false, t), `list.clicked{"count":3}`);
	assert.equal(links.describeTicks(undefined, true, t), "list.replied");
});

test("link URLs are shortened for display", () => {
	assert.equal(links.displayLinkUrl("https://www.example.com/"), "example.com");
	assert.equal(links.displayLinkUrl("https://example.com/pricing?plan=pro"), "example.com/pricing?plan=pro");
	assert.equal(links.displayLinkUrl("not a url"), "not a url");
});
