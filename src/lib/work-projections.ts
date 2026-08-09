import type { ChatMessage, ToolCallInfo } from "@/types";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface WorkOutput {
	kind: "file";
	identity: string;
	displayValue: string;
	path: string;
	title: string;
	messageId: string;
	toolCallId: string;
}

export type WorkSource =
	| {
			kind: "url";
			identity: string;
			displayValue: string;
			title: string;
			messageId: string;
	  }
	| {
			kind: "file";
			identity: string;
			displayValue: string;
			title: string;
			messageId: string;
	  };

export interface WorkProjection {
	outputs: WorkOutput[];
	sources: WorkSource[];
}

/**
 * Normalize a URL for identity/display. Drops fragment, lowercases host,
 * removes default ports, and trims a non-root trailing slash. Only http(s)
 * survives; every other scheme and malformed input returns null.
 */
export function normalizeSourceUrl(value: string): string | null {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		url.hash = "";
		url.hostname = url.hostname.toLowerCase();
		if (
			(url.protocol === "http:" && url.port === "80") ||
			(url.protocol === "https:" && url.port === "443")
		) {
			url.port = "";
		}
		if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
		return url.toString();
	} catch {
		return null;
	}
}

/**
 * Lexical display/identity normalizer for file paths — NOT an authorization
 * check. Resolves relative paths against `cwd`, normalizes separators, and
 * folds only the Windows drive letter (path case is preserved).
 */
export function normalizeFileIdentity(value: string, cwd: string): string | null {
	let raw = value.trim().replace(/\\/g, "/");
	if (!raw) return null;
	const drive = raw.match(/^([a-zA-Z]):(?:\/|$)/)?.[1];
	const unc = raw.startsWith("//");
	const posix = raw.startsWith("/") && !unc;
	const absolute = Boolean(drive || unc || posix);
	if (!absolute) {
		const base = cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
		if (!base) return null;
		raw = `${base}/${raw}`;
	}

	const driveAfterJoin = raw.match(/^([a-zA-Z]):(?:\/|$)/)?.[1];
	const uncAfterJoin = raw.startsWith("//");
	const prefix = driveAfterJoin ? `${driveAfterJoin.toUpperCase()}:/` : uncAfterJoin ? "//" : "/";
	const body = driveAfterJoin ? raw.slice(3) : uncAfterJoin ? raw.slice(2) : raw.slice(1);
	const segments: string[] = [];
	for (const segment of body.split(/\/+/)) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length > 0) segments.pop();
			continue;
		}
		segments.push(segment);
	}
	if (driveAfterJoin && segments.length === 0) return prefix;
	if (!driveAfterJoin && !uncAfterJoin && segments.length === 0) return "/";
	return `${prefix}${segments.join("/")}`;
}

interface MarkdownNode {
	type?: string;
	url?: string;
	identifier?: string;
	value?: string;
	children?: MarkdownNode[];
}

function textOf(node: MarkdownNode): string {
	if (typeof node.value === "string") return node.value;
	return (node.children ?? []).map(textOf).join("");
}

/** Parse Markdown links with the same parser used for rendering. */
export function extractMarkdownLinks(
	markdown: string,
): Array<{ url: string; title: string }> {
	const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
	const definitions = new Map<string, string>();
	const collectDefinitions = (node: MarkdownNode) => {
		if (node.type === "definition" && node.identifier && node.url) {
			definitions.set(node.identifier.toLowerCase(), node.url);
		}
		for (const child of node.children ?? []) collectDefinitions(child);
	};
	collectDefinitions(tree);

	const links: Array<{ url: string; title: string }> = [];
	const visit = (node: MarkdownNode) => {
		const rawUrl =
			node.type === "link"
				? node.url
				: node.type === "linkReference" && node.identifier
					? definitions.get(node.identifier.toLowerCase())
					: undefined;
		if (rawUrl) {
			const identity = normalizeSourceUrl(rawUrl);
			if (identity) links.push({ url: rawUrl, title: textOf(node).trim() || identity });
		}
		for (const child of node.children ?? []) visit(child);
	};
	visit(tree);
	return links;
}

const SOURCE_TOOLS = new Set([
	"web_search",
	"code_search",
	"fetch_content",
	"web_search_exa",
	"web_search_advanced_exa",
	"web_fetch_exa",
	"web_answer_exa",
	"web_research_exa",
	"web_find_similar_exa",
]);

const FILE_MARKER_RE = /\[File:\s+([^\]]+)\]\s+(\S+)\s+(\d+)\s+(\S+)/g;

/** Legacy `Written ... to <path>` success format for older records. */
const LEGACY_OUTPUT_RE =
	/(?:Written|Created|Wrote)\s+(?:\d+\s+lines\s+)?(?:to\s+)?(.+?)(?:\s+\(|$)/m;

/** Deeply collect exact `url`/`href`/`link` string fields from a value. */
function collectUrlStrings(value: unknown, out: string[]): void {
	if (typeof value === "string") {
		out.push(value);
		return;
	}
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) collectUrlStrings(item, out);
		return;
	}
	const record = value as Record<string, unknown>;
	for (const key of ["url", "href", "link"]) {
		if (typeof record[key] === "string") out.push(record[key]);
	}
	for (const val of Object.values(record)) collectUrlStrings(val, out);
}

/** Parse anchored `Title:` immediately-preceding-`URL:` lines from a result. */
function parseAnchoredResult(result: string): Array<{ url: string; title: string }> {
	const lines = result.split(/\r?\n/);
	const found: Array<{ url: string; title: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		const urlMatch = lines[i].match(/^URL:\s*(\S+)\s*$/);
		if (!urlMatch) continue;
		const title =
			i > 0 ? lines[i - 1].match(/^Title:\s*(.+)\s*$/)?.[1]?.trim() : undefined;
		found.push({ url: urlMatch[1], title: title || urlMatch[1] });
	}
	return found;
}

function upsertLatest<T extends { identity: string }>(
	items: T[],
	positions: Map<string, number>,
	item: T,
): void {
	const position = positions.get(item.identity);
	if (position === undefined) {
		positions.set(item.identity, items.length);
		items.push(item);
	} else {
		items[position] = item;
	}
}

function toolOutputPath(tc: ToolCallInfo, cwd: string): string | null {
	if (tc.outputPath?.path) return tc.outputPath.path;
	const raw = tc.args?.path ?? tc.args?.file_path;
	if (typeof raw === "string" && raw.trim()) return normalizeFileIdentity(raw, cwd);
	if (typeof tc.result === "string") {
		const match = tc.result.match(LEGACY_OUTPUT_RE);
		if (match?.[1]) return normalizeFileIdentity(match[1].trim(), cwd);
	}
	return null;
}

/**
 * Project a Work transcript (messages plus the streaming message) into a
 * stable, deduplicated Outputs/Sources document.
 */
export function deriveWorkProjection(
	messages: readonly ChatMessage[],
	cwd: string,
): WorkProjection {
	const outputs: WorkOutput[] = [];
	const sources: WorkSource[] = [];
	const outputPositions = new Map<string, number>();
	const urlPositions = new Map<string, number>();
	const filePositions = new Map<string, number>();

	for (const message of messages) {
		if (message.role === "assistant") {
			// URL sources from assistant Markdown links.
			for (const link of extractMarkdownLinks(message.content)) {
				const identity = normalizeSourceUrl(link.url);
				if (!identity) continue;
				upsertLatest(
					sources,
					urlPositions,
					{
						kind: "url",
						identity,
						displayValue: link.url,
						title: link.title,
						messageId: message.id,
					},
				);
			}

			// Outputs + allowlisted tool sources.
			for (const tc of message.toolCalls ?? []) {
				const safe: Partial<ToolCallInfo> =
					tc && typeof tc === "object" ? (tc as Partial<ToolCallInfo>) : {};
				const name = typeof safe.name === "string" ? safe.name : "";
				const status = safe.status;
				const isError = safe.isError === true;

				if (status === "completed" && !isError && (name === "write" || name === "edit")) {
					const identity = toolOutputPath(safe as ToolCallInfo, cwd);
					if (identity) {
						const displayValue =
							safe.outputPath?.displayPath ??
							(typeof safe.args?.path === "string"
								? safe.args.path
								: typeof safe.args?.file_path === "string"
									? safe.args.file_path
									: identity);
						const argsForPath =
							typeof safe.args?.path === "string" ? safe.args.path : undefined;
						upsertLatest(
							outputs,
							outputPositions,
							{
								kind: "file",
								identity,
								displayValue,
								path: identity,
								title: safe.outputPath?.displayPath ?? argsForPath ?? identity,
								messageId: message.id,
								toolCallId: typeof safe.id === "string" ? safe.id : `${message.id}-tc`,
							},
						);
					}
				}

				if (status === "completed" && !isError && SOURCE_TOOLS.has(name)) {
					const urls = new Map<string, { raw: string; title: string }>();
					// Structured url/href/link fields from details + JSON args.
					if (safe.details) {
						const collected: string[] = [];
						collectUrlStrings(safe.details, collected);
						for (const raw of collected) {
							const identity = normalizeSourceUrl(raw);
							if (identity && !urls.has(identity)) urls.set(identity, { raw, title: identity });
						}
					}
					// Anchored URL:/Title: lines from the result.
					if (typeof safe.result === "string") {
						for (const anchor of parseAnchoredResult(safe.result)) {
							const identity = normalizeSourceUrl(anchor.url);
							if (identity && !urls.has(identity)) {
								urls.set(identity, { raw: anchor.url, title: anchor.title || identity });
							}
						}
					}
					for (const [identity, entry] of urls) {
						upsertLatest(
							sources,
							urlPositions,
							{
								kind: "url",
								identity,
								displayValue: entry.raw,
								title: entry.title,
								messageId: message.id,
							},
						);
					}
				}
			}
		}

		if (message.role === "user") {
			// Structured attachments.
			for (const attachment of message.attachments ?? []) {
				if (typeof attachment?.path !== "string" || !attachment.path.trim()) continue;
				const identity = normalizeFileIdentity(attachment.path, cwd);
				if (!identity) continue;
				upsertLatest(
					sources,
					filePositions,
					{
						kind: "file",
						identity,
						displayValue: identity,
						title: attachment.name || identity,
						messageId: message.id,
					},
				);
			}
			// Existing inline `[File: path] name size mime` marker.
			for (const match of message.content.matchAll(FILE_MARKER_RE)) {
				const identity = normalizeFileIdentity(match[1], cwd);
				if (!identity) continue;
				upsertLatest(
					sources,
					filePositions,
					{
						kind: "file",
						identity,
						displayValue: identity,
						title: match[2] || identity,
						messageId: message.id,
					},
				);
			}
		}
	}

	return { outputs, sources };
}