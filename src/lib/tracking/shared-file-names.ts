import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { messageAttachments, sharedAttachmentLinks } from "@/db/schema";
import { parseSharedFileId } from "./link-tracking-utils";

/** File names behind links to this installation's shared-file downloads (tracked files), by URL. */
export async function getSharedFileNames(env: CloudflareEnv, urls: string[]): Promise<Map<string, string>> {
	const shareIdByUrl = new Map<string, string>();
	for (const url of urls) {
		const shareId = parseSharedFileId(url);
		if (shareId) shareIdByUrl.set(url, shareId);
	}
	if (shareIdByUrl.size === 0) return new Map();
	const rows = await getDb(env)
		.select({ id: sharedAttachmentLinks.id, filename: messageAttachments.filename })
		.from(sharedAttachmentLinks)
		.innerJoin(messageAttachments, eq(messageAttachments.id, sharedAttachmentLinks.attachmentId))
		.where(inArray(sharedAttachmentLinks.id, [...new Set(shareIdByUrl.values())]));
	const nameById = new Map(rows.map((row) => [row.id, row.filename]));
	const names = new Map<string, string>();
	for (const [url, id] of shareIdByUrl) {
		const name = nameById.get(id);
		if (name) names.set(url, name);
	}
	return names;
}

