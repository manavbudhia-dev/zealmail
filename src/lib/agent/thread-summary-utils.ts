/** A conversation message reduced to what a summary needs. */
export type SummaryMessage = {
	from: string;
	date: Date;
	direction: string;
	subject: string | null;
	text: string;
};

/** Per-message and whole-transcript budgets, in characters. */
export const SUMMARY_MESSAGE_CHARS = 3_000;
export const SUMMARY_TRANSCRIPT_CHARS = 24_000;
/** Summaries are for conversations; a single message is short enough to read. */
export const SUMMARY_MIN_MESSAGES = 2;

const ATTRIBUTION_LINE = /^\s*(On .{4,200}wrote:|-{2,}\s*Original Message\s*-{2,}|-{2,}\s*Forwarded message\s*-{2,}|From: .+)$/i;

/**
 * The new text of a plain-text reply: quoted lines (`>`) and everything from the
 * first attribution line ("On … wrote:", "Original Message", a quoted From:) on
 * are dropped, since earlier messages are in the transcript already.
 */
export function stripQuotedText(text: string): string {
	const kept: string[] = [];
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		if (ATTRIBUTION_LINE.test(line)) break;
		if (/^\s*>/.test(line)) continue;
		kept.push(line);
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Oldest-first transcript for the model. When it is over budget the oldest
 * messages go first: the latest state of a conversation matters most.
 */
export function buildThreadTranscript(messages: SummaryMessage[]): string {
	const blocks = messages.map((message, index) => {
		const body = stripQuotedText(message.text).slice(0, SUMMARY_MESSAGE_CHARS) || "(no text)";
		const who = message.direction === "outbound" ? `${message.from} (this mailbox)` : message.from;
		const subject = index === 0 && message.subject ? `\nSubject: ${message.subject}` : "";
		return `Message ${index + 1} from ${who} on ${message.date.toISOString()}${subject}\n${body}`;
	});
	const kept: string[] = [];
	let total = 0;
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const size = blocks[index].length + 2;
		if (kept.length > 0 && total + size > SUMMARY_TRANSCRIPT_CHARS) break;
		kept.unshift(blocks[index].slice(0, SUMMARY_TRANSCRIPT_CHARS));
		total += size;
	}
	const omitted = blocks.length - kept.length;
	return `${omitted > 0 ? `(${omitted} earlier message${omitted === 1 ? "" : "s"} omitted)\n\n` : ""}${kept.join("\n\n")}`;
}

/**
 * Bullet points from the model's reply. Markdown emphasis and headings are
 * removed (the reader shows plain text), and anything that is not a bullet is
 * kept as its own point so nothing the model said is lost.
 */
export function parseSummaryPoints(text: string): string[] {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line
			.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
			.replace(/^#+\s*/, "")
			.replace(/\*\*(.+?)\*\*/g, "$1")
			.replace(/__(.+?)__/g, "$1")
			.trim())
		.filter((line) => line.length > 0 && !/^(summary|here is|here's)\b.*:$/i.test(line))
		.slice(0, 12)
		.map((line) => line.slice(0, 600));
}
