/**
 * Gmail message formatter.
 *
 * Converts raw Gmail API responses into clean markdown for LLM consumption.
 * Handles HTML stripping, body truncation, attachment listing, and thread formatting.
 */

import type {
	AttachmentInfo,
	GmailMessage,
	GmailMessagePart,
	GmailThread,
	ParsedEmail,
} from "./types.js";

// Max body length to include (keep well under 50KB tool limit)
const MAX_BODY_LENGTH = 10_000;

// ── Parse a single message ──────────────────────────────────────

export function parseMessage(msg: GmailMessage): ParsedEmail {
	const headers = msg.payload?.headers ?? [];
	const getHeader = (name: string) =>
		headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

	const attachments = extractAttachments(msg.payload, msg.id);
	const body = extractBody(msg.payload);

	return {
		id: msg.id,
		threadId: msg.threadId,
		from: getHeader("From"),
		to: getHeader("To"),
		cc: getHeader("Cc"),
		bcc: getHeader("Bcc"),
		subject: getHeader("Subject"),
		date: getHeader("Date"),
		snippet: msg.snippet ?? "",
		body: truncateBody(body),
		labels: msg.labelIds ?? [],
		attachments,
		isUnread: msg.labelIds?.includes("UNREAD") ?? false,
	};
}

// ── Format a single email as markdown ───────────────────────────

export function formatEmail(parsed: ParsedEmail): string {
	const lines: string[] = [];

	const unreadTag = parsed.isUnread ? " 🔵" : "";
	lines.push(`**Subject:** ${parsed.subject || "(no subject)"}${unreadTag}`);
	lines.push(`**From:** ${parsed.from}`);
	if (parsed.to) lines.push(`**To:** ${parsed.to}`);
	if (parsed.cc) lines.push(`**Cc:** ${parsed.cc}`);
	lines.push(`**Date:** ${parsed.date}`);
	lines.push(`**ID:** ${parsed.id}`);
	lines.push(`**Thread:** ${parsed.threadId}`);

	if (parsed.labels.length > 0) {
		lines.push(`**Labels:** ${parsed.labels.join(", ")}`);
	}

	lines.push("");
	lines.push(parsed.body || "(empty body)");

	if (parsed.attachments.length > 0) {
		lines.push("");
		lines.push("---");
		lines.push(
			`📎 **Attachments:** ${parsed.attachments.map((a) => `${a.filename} (${formatSize(a.size)})`).join(", ")}`,
		);
	}

	return lines.join("\n");
}

// ── Format a thread ─────────────────────────────────────────────

export function formatThread(thread: GmailThread): string {
	if (!thread.messages || thread.messages.length === 0) {
		return `Thread ${thread.id}: (no messages)`;
	}

	const parsed = thread.messages.map(parseMessage);
	const subject = parsed[0]?.subject || "(no subject)";

	const lines: string[] = [];
	lines.push(`# Thread: ${subject}`);
	lines.push(`**Thread ID:** ${thread.id} · **Messages:** ${parsed.length}`);
	lines.push("");

	for (let i = 0; i < parsed.length; i++) {
		if (i > 0) lines.push("\n---\n");
		lines.push(`## Message ${i + 1}/${parsed.length}`);
		lines.push(formatEmail(parsed[i]!));
	}

	return lines.join("\n");
}

// ── Format search results (compact) ────────────────────────────

export function formatSearchResult(msg: GmailMessage, index: number): string {
	const headers = msg.payload?.headers ?? [];
	const getHeader = (name: string) =>
		headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

	const unread = msg.labelIds?.includes("UNREAD") ? "🔵 " : "";
	const hasAttachment =
		msg.labelIds?.includes("ATTACHMENT") || hasAttachments(msg.payload) ? " 📎" : "";

	const from = shortenAddress(getHeader("From"));
	const subject = getHeader("Subject") || "(no subject)";
	const date = formatShortDate(getHeader("Date"));
	const snippet = (msg.snippet ?? "").slice(0, 100);

	return `${index + 1}. ${unread}**${subject}**${hasAttachment}\n   From: ${from} · ${date} · ID: ${msg.id}\n   ${snippet}`;
}

export function formatMessageList(messages: GmailMessage[], title: string): string {
	if (messages.length === 0) return `${title}: No messages found.`;

	const lines = [
		`**${title} (${messages.length}):**`,
		"",
		...messages.map((m, i) => formatSearchResult(m, i)),
	];

	return lines.join("\n");
}

// ── Body extraction ─────────────────────────────────────────────

function extractBody(part: GmailMessagePart | undefined): string {
	if (!part) return "";

	// Prefer text/plain
	const plainText = findPart(part, "text/plain");
	if (plainText) return decodeBase64Url(plainText);

	// Fall back to text/html, strip tags
	const htmlContent = findPart(part, "text/html");
	if (htmlContent) return stripHtml(decodeBase64Url(htmlContent));

	return "";
}

function findPart(part: GmailMessagePart, mimeType: string): string | null {
	if (part.mimeType === mimeType && part.body?.data) {
		return part.body.data;
	}
	if (part.parts) {
		for (const child of part.parts) {
			const found = findPart(child, mimeType);
			if (found) return found;
		}
	}
	return null;
}

// ── Attachment extraction ───────────────────────────────────────

function extractAttachments(
	part: GmailMessagePart | undefined,
	messageId: string,
): AttachmentInfo[] {
	const attachments: AttachmentInfo[] = [];
	if (!part) return attachments;
	collectAttachments(part, messageId, attachments);
	return attachments;
}

function collectAttachments(
	part: GmailMessagePart,
	messageId: string,
	acc: AttachmentInfo[],
): void {
	if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
		acc.push({
			filename: part.filename,
			mimeType: part.mimeType,
			size: part.body.size ?? 0,
			attachmentId: part.body.attachmentId,
			messageId,
		});
	}
	if (part.parts) {
		for (const child of part.parts) {
			collectAttachments(child, messageId, acc);
		}
	}
}

function hasAttachments(part: GmailMessagePart | undefined): boolean {
	if (!part) return false;
	if (part.filename && part.filename.length > 0 && part.body?.attachmentId) return true;
	if (part.parts) {
		for (const child of part.parts) {
			if (hasAttachments(child)) return true;
		}
	}
	return false;
}

// ── HTML stripping ──────────────────────────────────────────────

/** URL-safe chars used as the href replacement for unparseable links. */
const NOOP_HREF = "";

/** Entity lookup for common HTML escapes. */
const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	"#39": "'",
	nbsp: " ",
};

/** Block-level tag names that map to a newline in the output. */
const BLOCK_TAGS = new Set([
	"br",
	"p",
	"div",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"tr",
	"blockquote",
]);

/**
 * Convert HTML email markup to plain text. No regex for tag parsing (CodeQL
 * flags js/bad-tag-filter / js/incomplete-multi-character-sanitization on
 * regex-based HTML stripping). Instead walks the string character by
 * character with a small state machine:
 *  • &lt;style&gt; / &lt;script&gt; — skip entire block;
 *  • block elements — emit newline;
 *  • &lt;a href=&quot;…&quot;&gt;…&lt;/a&gt; — rewrite as [text](url);
 *  • other tags — stripped silently;
 *  • HTML entities — decoded from the ENTITIES map.
 */
function stripHtml(html: string): string {
	let out = "";
	let i = 0;

	while (i < html.length) {
		if (html[i] !== "<") {
			// Normal character — check for entity before appending
			if (html[i] === "&") {
				const semi = html.indexOf(";", i + 1);
				if (semi !== -1) {
					const name = html.slice(i + 1, semi);
					const decoded = ENTITIES[name];
					if (decoded !== undefined) {
						out += decoded;
						i = semi + 1;
						continue;
					}
				}
			}
			out += html[i];
			i++;
			continue;
		}

		// ── we hit a '<' — parse the tag ─────────────────────────────
		const gt = html.indexOf(">", i);
		if (gt === -1) break; // malformed, stop

		const rawTag = html.slice(i + 1, gt);
		const tag = rawTag.trim();
		const isEnd = tag.startsWith("/");
		// Extract tag name — first run of alphanumeric chars; ">" or whitespace
		// terminates. Avoids / inside the character class (tsc parser quirk).
		const tn = isEnd ? tag.slice(1) : tag;
		const base = tn.match(/[a-zA-Z0-9]+/)?.[0]?.toLowerCase() ?? "";

		// Skip <style …> … </style> and <script …> … </script> entirely
		if (!isEnd && (base === "style" || base === "script")) {
			const closer = `</${base}>`;
			const closeIdx = html.indexOf(closer, gt + 1);
			if (closeIdx !== -1) {
				i = closeIdx + closer.length;
				continue;
			}
			// No closing tag found — skip the opening tag only
			i = gt + 1;
			continue;
		}

		// Block-level tags emit a newline
		if (BLOCK_TAGS.has(base)) {
			out += "\n";
		}

		// Link: <a href="url">text</a> → [text](url)
		if (base === "a" && !isEnd) {
			const hrefMatch = /href="([^"]*)"/i.exec(rawTag);
			const href = hrefMatch ? hrefMatch[1] : NOOP_HREF;
			const textStart = gt + 1;
			const closeA = html.indexOf("</a>", textStart);
			const linkText =
				closeA !== -1
					? stripHtml(html.slice(textStart, closeA))
					: "";
			out += `[${linkText}](${href})`;
			i = closeA !== -1 ? closeA + 4 : gt + 1;
			continue;
		}

		// All other tags (including </a>) are stripped silently
		i = gt + 1;
	}

	// Collapse multiple blank lines, trim
	return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ── Utilities ───────────────────────────────────────────────────

function decodeBase64Url(data: string): string {
	// Gmail uses URL-safe base64
	const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(base64, "base64").toString("utf-8");
}

function truncateBody(body: string): string {
	if (body.length <= MAX_BODY_LENGTH) return body;
	return body.slice(0, MAX_BODY_LENGTH) + `\n\n[... truncated at ${MAX_BODY_LENGTH} chars]`;
}

function shortenAddress(address: string): string {
	// "John Doe <john@example.com>" → "John Doe"
	const match = address.match(/^"?([^"<]+)"?\s*</);
	if (match) return match[1]!.trim();
	return address;
}

function formatShortDate(dateStr: string): string {
	if (!dateStr) return "";
	try {
		const d = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffDays = Math.floor(diffMs / 86_400_000);

		if (diffDays === 0) {
			return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
		}
		if (diffDays === 1) return "Yesterday";
		if (diffDays < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
		return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	} catch {
		return dateStr;
	}
}

export function formatSize(bytes: number): string {
	if (bytes === 0) return "0B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)}${units[i]}`;
}

// ── RFC 2822 message builder ────────────────────────────────────

/**
 * RFC 2047 encode a header value if it contains non-ASCII characters.
 * Uses UTF-8 base64 encoding: =?UTF-8?B?<base64>?=
 */
function rfc2047Encode(value: string): string {
	// eslint-disable-next-line no-control-regex
	if (/^[\x00-\x7F]*$/.test(value)) return value;
	const encoded = Buffer.from(value, "utf-8").toString("base64");
	return `=?UTF-8?B?${encoded}?=`;
}

/**
 * RFC 2047 encode an address header, encoding only display names.
 * Handles quoted display names: "Foo <Bar>" <user@x.com>
 * "Éspen <e@x.com>, 日本語 <j@x.com>" → "=?UTF-8?B?...?= <e@x.com>, =?UTF-8?B?...?= <j@x.com>"
 */
function rfc2047EncodeAddress(header: string): string {
	// Match: optional quoted or unquoted display name, then <email>
	// Quoted: "anything" <email>  |  Unquoted: non-<, chars <email>
	return header.replace(
		/("(?:[^"\\]|\\.)*"|[^,<]*)<([^>]+)>/g,
		(_match, name: string, email: string) => {
			const trimmed = name.trim().replace(/^"|"$/g, "");
			if (!trimmed) return `<${email}>`;
			return `${rfc2047Encode(trimmed)} <${email}>`;
		},
	);
}

export function buildRawMessage(opts: {
	to: string;
	from?: string;
	cc?: string;
	bcc?: string;
	subject: string;
	body: string;
	inReplyTo?: string;
	references?: string;
	threadId?: string;
}): string {
	const lines: string[] = [];
	if (opts.from) lines.push(`From: ${rfc2047EncodeAddress(opts.from)}`);
	lines.push(`To: ${rfc2047EncodeAddress(opts.to)}`);
	if (opts.cc) lines.push(`Cc: ${rfc2047EncodeAddress(opts.cc)}`);
	if (opts.bcc) lines.push(`Bcc: ${rfc2047EncodeAddress(opts.bcc)}`);
	lines.push(`Subject: ${rfc2047Encode(opts.subject)}`);
	lines.push("MIME-Version: 1.0");
	lines.push("Content-Type: text/plain; charset=utf-8");
	if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
	if (opts.references) lines.push(`References: ${opts.references}`);
	lines.push("");
	lines.push(opts.body);

	const raw = lines.join("\r\n");
	// Gmail API requires URL-safe base64
	return Buffer.from(raw)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
