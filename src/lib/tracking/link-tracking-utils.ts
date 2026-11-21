import { AUTOMATED_OPEN_WINDOW_MS, detectDevice } from "./open-tracking-utils";
import type { ClickRequestInfo, OpenClassification } from "./types";

/** Links beyond this many distinct URLs in one message are sent untouched. */
export const MAX_TRACKED_LINKS = 50;
/** Longer URLs are sent untouched rather than stored. */
export const MAX_TRACKED_URL_LENGTH = 2048;
/** Clicks beyond this per link still update the counter but are not stored individually. */
export const MAX_STORED_CLICKS = 50;

export const LINK_REDIRECT_HEADERS = {
	"Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
	"X-Robots-Tag": "noindex, nofollow",
};

const LINK_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
/** An `<a ...>` start tag; quoted attribute values may contain `>`. */
const ANCHOR_TAG = /<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const HREF_ATTRIBUTE = /(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
/** Opt-out marker for links that must reach the recipient unchanged (e.g. unsubscribe). */
const NO_TRACK_ATTRIBUTE = /\sdata-no-track\b/i;
/** Link scanners, unfurlers and HTTP libraries; none of them is a person clicking. */
const AUTOMATED_CLICK_AGENT = /bot\b|crawler|spider|scanner|safelinks|proofpoint|mimecast|barracuda|bitdefender|forcepoint|symantec|trendmicro|python-|python\/|curl\/|wget|go-http-client|java\/|okhttp|axios|node-fetch|headless|phantomjs|facebookexternalhit|slackbot|whatsapp|skypeuripreview|linkpreview|microsoft office existence discovery/i;

export function parseLinkId(segment: string): string | null {
	return LINK_ID_PATTERN.test(segment) ? segment : null;
}

export function buildTrackedLinkUrl(origin: string, linkId: string): string {
	return `${origin.replace(/\/+$/, "")}/api/l/${linkId}`;
}

function decodeAttribute(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|#39);/gi, (match, entity: string) => {
		const lower = entity.toLowerCase();
		if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
		if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
		return ({ amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">" } as Record<string, string>)[lower] ?? match;
	});
}

/** The decoded href of an anchor start tag when it is an http(s) link we may track. */
function trackableHref(tag: string): { url: string; match: RegExpExecArray } | null {
	if (NO_TRACK_ATTRIBUTE.test(tag)) return null;
	const match = HREF_ATTRIBUTE.exec(tag);
	if (!match) return null;
	const url = decodeAttribute(match[2] ?? match[3] ?? match[4] ?? "").trim();
	if (!url || url.length > MAX_TRACKED_URL_LENGTH) return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
		// Already a click link (e.g. a forwarded tracked message): leave it alone.
		if (/^\/api\/l\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) return null;
	} catch {
		return null;
	}
	return { url, match };
}

/** Distinct http(s) link targets in document order, at most `MAX_TRACKED_LINKS`. */
export function extractTrackableLinks(html: string): string[] {
	const urls: string[] = [];
	for (const [tag] of html.matchAll(ANCHOR_TAG)) {
		const href = trackableHref(tag);
		if (href && !urls.includes(href.url)) {
			urls.push(href.url);
			if (urls.length >= MAX_TRACKED_LINKS) break;
		}
	}
	return urls;
}

/** Points every anchor whose target is in `trackedUrls` at its click URL; other markup is untouched. */
export function rewriteTrackedLinks(html: string, trackedUrls: Map<string, string>): string {
	if (trackedUrls.size === 0) return html;
	return html.replace(ANCHOR_TAG, (tag) => {
		const href = trackableHref(tag);
		const tracked = href ? trackedUrls.get(href.url) : undefined;
		if (!href || !tracked) return tag;
		const escaped = tracked.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
		const start = href.match.index;
		return `${tag.slice(0, start)}${href.match[1]}"${escaped}"${tag.slice(start + href.match[0].length)}`;
	});
}

function detectBrowser(userAgent: string): string | null {
	if (/Outlook-iOS|Outlook-Android|Microsoft Outlook|MSOffice|ms-office/i.test(userAgent)) return "Outlook";
	if (/Thunderbird/i.test(userAgent)) return "Thunderbird";
	if (/Edg(e|A|iOS)?\//.test(userAgent)) return "Edge";
	if (/OPR\/|Opera/.test(userAgent)) return "Opera";
	if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
	if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
	if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
	if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return "Safari";
	return null;
}

/**
 * Names the browser behind a click and flags clicks no person made: HEAD probes,
 * link scanners (which follow every link moments after delivery) and bare HTTP clients.
 */
export function classifyClick(info: ClickRequestInfo): OpenClassification {
	const userAgent = info.userAgent?.trim() ?? "";
	const automated = info.method.toUpperCase() !== "GET" ||
		!userAgent ||
		AUTOMATED_CLICK_AGENT.test(userAgent) ||
		info.clickedAt.getTime() - info.sentAt.getTime() < AUTOMATED_OPEN_WINDOW_MS;
	// Cloudflare reports XX for unknown and T1 for Tor.
	const country = info.country && /^[A-Z]{2}$/.test(info.country) && info.country !== "XX" && info.country !== "T1" ? info.country : null;
	return {
		client: userAgent ? detectBrowser(userAgent) : null,
		device: userAgent ? detectDevice(userAgent) : null,
		country,
		city: info.city ?? null,
		automated,
	};
}
