import { getEnv } from "@/lib/cloudflare";
import { recordClick } from "@/lib/tracking/link-tracking";
import { LINK_REDIRECT_HEADERS, parseLinkId } from "@/lib/tracking/link-tracking-utils";

type CloudflareRequest = Request & { cf?: { country?: string; city?: string } };

/** Public click-tracking redirect. The target is read from the stored link, never from the request. */
async function handle(request: Request, { params }: { params: Promise<{ linkId: string }> }) {
	const linkId = parseLinkId((await params).linkId);
	let target: string | null = null;
	if (linkId) {
		const cf = (request as CloudflareRequest).cf;
		try {
			target = await recordClick(getEnv(), linkId, {
				method: request.method,
				userAgent: request.headers.get("user-agent"),
				country: cf?.country ?? request.headers.get("cf-ipcountry"),
				city: cf?.city ?? null,
			});
		} catch (error) {
			console.error("Resolving a tracked link failed", error);
		}
	}
	if (!target) {
		return new Response("This link is no longer available.", {
			status: 404,
			headers: { ...LINK_REDIRECT_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
		});
	}
	return new Response(null, { status: 302, headers: { ...LINK_REDIRECT_HEADERS, Location: target } });
}

export const GET = handle;
export const HEAD = handle;
