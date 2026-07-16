/**
 * pi-session-store — session persistence backed by pi-coding-agent's native
 * SessionManager, which auto-persists to ~/.pi/agent/sessions/<encoded-cwd>/.
 *
 * This replaces the old bespoke ~/.zosmaai/cowork/sessions JSONL store: pi
 * already writes sessions during the agent loop, so cowork no longer keeps a
 * parallel copy. We only overlay two cowork-only bits of UI state that pi has
 * no concept of — pinning and custom titles — in a small sidecar meta file
 * (~/.pi/agent/cowork-meta.json), keyed by the session's absolute file path.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { extractChatMessages } from "./extract-chat-messages.js";

/** Sidebar list entry — same shape the frontend already consumes. */
export interface CoworkSessionEntry {
	/** Absolute path to the pi session file — the opaque identity used by the UI. */
	file: string;
	title: string;
	model?: string;
	provider?: string;
	cwd?: string;
	messageCount: number;
	createdAt: number;
	lastActivity: number;
	pinned: boolean;
	titleLocked: boolean;
	preview: string;
}

export interface CoworkMeta {
	/** Absolute paths of pinned sessions. */
	pinned: string[];
	/** Absolute path → user-renamed title (locks auto-titling). */
	titles: Record<string, string>;
}

export interface CoworkSearchMatch {
	file: string;
	snippet: string;
	matchCount: number;
}

const EMPTY_META: CoworkMeta = { pinned: [], titles: {} };

function metaPath(agentDir: string): string {
	return join(agentDir, "cowork-meta.json");
}

export function readMeta(agentDir: string): CoworkMeta {
	const p = metaPath(agentDir);
	if (!existsSync(p)) return { pinned: [], titles: {} };
	try {
		const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<CoworkMeta>;
		return {
			pinned: Array.isArray(raw.pinned) ? raw.pinned : [],
			titles: raw.titles && typeof raw.titles === "object" ? raw.titles : {},
		};
	} catch {
		return { pinned: [], titles: {} };
	}
}

export function writeMeta(agentDir: string, meta: CoworkMeta): void {
	writeFileSync(metaPath(agentDir), JSON.stringify(meta), "utf-8");
}

/** Auto-derive a title from the first user message. */
export function deriveTitle(firstMessage: string): string {
	const trimmed = (firstMessage || "").replace(/\s+/g, " ").trim();
	if (!trimmed) return "Chat";
	return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

/** Overlay cowork meta (pin + custom title) onto a pi SessionInfo. */
export function mapSessionInfoToEntry(info: SessionInfo, meta: CoworkMeta): CoworkSessionEntry {
	const customTitle = meta.titles[info.path];
	return {
		file: info.path,
		title: customTitle ?? info.name ?? deriveTitle(info.firstMessage),
		cwd: info.cwd || undefined,
		messageCount: info.messageCount,
		createdAt: info.created.getTime(),
		lastActivity: info.modified.getTime(),
		pinned: meta.pinned.includes(info.path),
		titleLocked: customTitle != null || info.name != null,
		preview: deriveTitle(info.firstMessage),
	};
}

/** Pinned-first, then most-recently-modified. */
export function sortEntries(entries: CoworkSessionEntry[]): CoworkSessionEntry[] {
	return [...entries].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.lastActivity - a.lastActivity;
	});
}

/**
 * Convert pi AgentMessage[] (from buildSessionContext) into the frontend
 * ChatMessage shape, assigning stable ids the UI's React keys need.
 */
export function convertAgentMessagesToChat(
	agentMessages: unknown[],
): Array<Record<string, unknown>> {
	const chat = extractChatMessages(agentMessages);
	return chat.map((m, i) => ({
		id: `${m.timestamp ?? "m"}-${i}`,
		...m,
	}));
}

/**
 * List pi sessions overlaid with cowork meta. Scoped to `cwd` (the current
 * workspace folder) by default — matching how pi shows only the sessions for
 * the directory it was opened in. Pass no cwd to list every project folder.
 */
export async function listPiSessions(
	agentDir: string,
	cwd?: string,
): Promise<CoworkSessionEntry[]> {
	const infos = cwd ? await SessionManager.list(cwd) : await SessionManager.listAll();
	const meta = readMeta(agentDir);
	const entries = infos
		.filter((info) => info.messageCount > 0) // hide empty/aborted sessions
		.map((info) => mapSessionInfoToEntry(info, meta));
	return sortEntries(entries);
}

/** Open a persisted pi session file and return its chat history + metadata. */
export function loadPiSession(path: string): {
	messages: Array<Record<string, unknown>>;
	title: string;
	model?: string;
	provider?: string;
	cwd?: string;
	manager: SessionManager;
} {
	const manager = SessionManager.open(path);
	const ctx = manager.buildSessionContext();
	const messages = convertAgentMessagesToChat(ctx.messages as unknown[]);
	const header = manager.getHeader();
	return {
		messages,
		title: manager.getSessionName() ?? "",
		model: ctx.model?.modelId,
		provider: ctx.model?.provider,
		cwd: header?.cwd,
		manager,
	};
}

export function deletePiSession(agentDir: string, path: string): boolean {
	if (!existsSync(path)) return false;
	try {
		unlinkSync(path);
	} catch {
		return false;
	}
	// Prune stale meta.
	const meta = readMeta(agentDir);
	const nextPinned = meta.pinned.filter((p) => p !== path);
	const nextTitles = { ...meta.titles };
	delete nextTitles[path];
	writeMeta(agentDir, { pinned: nextPinned, titles: nextTitles });
	return true;
}

export function renamePiSession(agentDir: string, path: string, title: string): boolean {
	const clean = title.trim();
	if (!clean) return false;
	const meta = readMeta(agentDir);
	meta.titles[path] = clean;
	writeMeta(agentDir, meta);
	return true;
}

export function setPiSessionPinned(agentDir: string, path: string, pinned: boolean): boolean {
	const meta = readMeta(agentDir);
	const has = meta.pinned.includes(path);
	if (pinned && !has) meta.pinned.push(path);
	else if (!pinned && has) meta.pinned = meta.pinned.filter((p) => p !== path);
	writeMeta(agentDir, meta);
	return true;
}

/** Substring search over first message + display name, returning matched files. */
export async function searchPiSessions(
	agentDir: string,
	query: string,
	cwd?: string,
): Promise<CoworkSearchMatch[]> {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const infos = cwd ? await SessionManager.list(cwd) : await SessionManager.listAll();
	const meta = readMeta(agentDir);
	const matches: CoworkSearchMatch[] = [];
	for (const info of infos) {
		if (info.messageCount === 0) continue;
		const hay = `${info.allMessagesText}\n${info.name ?? ""}\n${meta.titles[info.path] ?? ""}`;
		const idx = hay.toLowerCase().indexOf(q);
		if (idx === -1) continue;
		const start = Math.max(0, idx - 40);
		matches.push({
			file: info.path,
			snippet: hay.slice(start, idx + q.length + 40).replace(/\s+/g, " ").trim(),
			matchCount: 1,
		});
	}
	return matches;
}
