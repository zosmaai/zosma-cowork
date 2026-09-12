import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, normalize as normalizePath } from "path";
import { normalizeToolCalls } from "./lib/normalize.ts";
import { projectIdentityKey } from "../git/project-identity.ts";
import { projectTreeForResponse } from "./lib/project-tree.ts";
import { sessionPathKey } from "./lib/session-path.ts";
import { computeSessionTotalActiveMs } from "./lib/session-timing.ts";
import { resolveProject, type ProjectInfo } from "../git/worktree.ts";
import type { AgentMessage, SessionContext, SessionEntry, SessionHeader, SessionInfo, SessionTreeNode } from "./lib/types.ts";
import { BackendError } from "./lib/errors.ts";
import type { ListSessionsInput, SessionDetailsResponse, SessionIdInput, SessionMutationResponse, SessionsResponse, UpdateSessionInput } from "./lib/contracts.ts";

export { getAgentDir };

export async function attachSessionProjectInfo(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return sessions.map((session) => {
    const project = session.cwd ? projectByCwd.get(session.cwd) : undefined;
    const projectRoot = project?.projectRoot ?? session.cwd;
    return {
      ...session,
      projectRoot,
      projectKey: projectIdentityKey(projectRoot),
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export function mergeSessionLists(
  persistedSessions: SessionInfo[],
  supplementalSessions: SessionInfo[],
): SessionInfo[] {
  const byId = new Map(supplementalSessions.map((session) => [session.id, session]));
  // A disk scan is authoritative once the JSONL exists. In particular, this
  // replaces a transient registry snapshot without briefly rendering two rows.
  for (const session of persistedSessions) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(sessionPathKey(s.path), s.id);

  const sessions = piSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(sessionPathKey(s.parentSessionPath)) : undefined,
      transient: false,
    };
  });
  return attachSessionProjectInfo(sessions);
}

export async function listAllSessions(options: { force?: boolean } = {}): Promise<SessionInfo[]> {
  if (options.force) invalidateSessionListCache();
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load). Freshly created
  // sessions are merged in from the supplemental registry so the sidebar
  // sees them instantly without paying for a disk scan.
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    const supplemental = getSupplementalSessions();
    return supplemental.length > 0
      ? mergeSessionLists(globalThis.__piSessionListCache.data, supplemental)
      : globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // If a mutation invalidated this scan, make this caller join (or start) a
    // scan for the current generation. Returning the stale result here made a
    // refresh race indistinguishable from a successful refresh.
    if ((globalThis.__piSessionListGeneration ?? 0) !== generation) {
      return listAllSessions();
    }
    // This scan is authoritative: drop supplemental entries it now covers so
    // the overlay cannot shadow fresher persisted data on later cache reads.
    if (globalThis.__piSupplementalSessions) {
      for (const session of data) globalThis.__piSupplementalSessions.delete(session.id);
    }
    globalThis.__piSessionListCache = { data, ts: Date.now() };
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
  var __piSupplementalSessions: Map<string, SessionInfo> | undefined;
}

// Recents list: mutations invalidate explicitly (new session / delete / resume),
// so a long TTL just avoids re-scanning 1000+ session files on idle churn.
const SESSION_LIST_CACHE_TTL_MS = 5 * 60_000;

function getSupplementalSessions(): SessionInfo[] {
  if (!globalThis.__piSupplementalSessions) return [];
  return [...globalThis.__piSupplementalSessions.values()];
}

export type SupplementalSessionInput = {
  id: string;
  cwd: string;
  name?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage?: string;
};

/**
 * Record a just-created/resumed session so cached list reads see it without
 * paying for a disk scan. A later authoritative scan replaces these entries
 * (persisted list wins in {@link mergeSessionLists}).
 */
export function registerSupplementalSession(info: SupplementalSessionInput): void {
  if (!globalThis.__piSupplementalSessions) globalThis.__piSupplementalSessions = new Map();
  const session: SessionInfo = {
    path: "",
    id: info.id,
    cwd: info.cwd,
    name: info.name,
    created: info.created instanceof Date ? info.created.toISOString() : String(info.created ?? new Date().toISOString()),
    modified: info.modified instanceof Date ? info.modified.toISOString() : String(info.modified ?? new Date().toISOString()),
    messageCount: info.messageCount ?? 0,
    firstMessage: info.firstMessage ?? "(no messages)",
    transient: true,
  };
  globalThis.__piSupplementalSessions.set(info.id, session);
}

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine) as SessionHeader;
      return header.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  // Supported message roles: user, assistant, toolResult, bashExecution.
  // bashExecution messages enter the case "message" branch (entry.type === "message").
  // The early return at line below ("!options.deferThinking || message.role !== "assistant"")
  // passes non-assistant messages — including bashExecution — through unchanged.
  // normalizeToolCalls is a secondary guard (returns non-assistant messages as-is).
  switch (entry.type) {
    case "message": {
      const message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}

// ============================================================================
// Session coordination services.
//
// These wrap the route bodies that previously lived in
//   web/app/api/sessions/**. After the roadmap item 6 cutover the daemon owns
// live sessions, so these are pure on-disk file services: no in-process Pi
// runtime, no live-window merge. Running ids come from /api/v1/agent/running
// (daemon pi:list), live commands (prompt/close/auto-name/model) go straight
// through daemon-client at the route layer.
// ============================================================================

export async function listSessions(input: ListSessionsInput): Promise<SessionsResponse> {
  return {
    sessions: await listAllSessions(input),
    runningSessionIds: [],
  };
}

export async function getSessionDetails(
  input: SessionIdInput & { deferThinking?: boolean; deferMedia?: boolean },
): Promise<SessionDetailsResponse> {
  const { sessionId: id } = input;
  const resolvedPath = await resolveSessionPath(id);
  if (!resolvedPath || !existsSync(resolvedPath)) {
    // existsSync guard: a just-created session's path is now cached at spawn
    // time, but the file itself is only written by pi after the first
    // assistant message. Until then the session legitimately has no
    // persisted content — answer 404 (same as a cache miss) instead of a
    // half-read 500.
    throw new BackendError("session_not_found", "Session not found");
  }

  try {
    const sm = SessionManager.open(resolvedPath);
    const filePath = sm.getSessionFile() || resolvedPath || "";
    const entries = sm.getEntries();
    const leafId = sm.getLeafId();
    const tree = projectTreeForResponse(sm.getTree()) as SessionTreeNode[];
    const deferThinking = input.deferThinking ?? false;
    const deferToolResultImages = input.deferMedia ?? false;
    const context = buildSessionContext(entries as never, leafId, { deferThinking, deferToolResultImages });
    const totalActiveMs = computeSessionTotalActiveMs(entries);

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = context.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      transient: !filePath || !existsSync(filePath),
    } : null;

    return { sessionId: id, filePath, info, leafId, tree, context, totalActiveMs };
  } catch (error) {
    throw new BackendError("internal_error", error instanceof Error ? error.message : String(error));
  }
}

export async function getSessionContext(
  input: SessionIdInput & { leafId?: string; deferThinking?: boolean; deferMedia?: boolean },
): Promise<SessionContext> {
  const { sessionId: id } = input;
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    throw new BackendError("session_not_found", "Session not found");
  }

  try {
    const sm = SessionManager.open(filePath);
    return buildSessionContext(sm.getEntries() as never, input.leafId, {
      deferThinking: input.deferThinking ?? false,
      deferToolResultImages: input.deferMedia ?? false,
    });
  } catch (error) {
    throw new BackendError("internal_error", error instanceof Error ? error.message : String(error));
  }
}

export async function renameSession(input: UpdateSessionInput): Promise<SessionMutationResponse> {
  // JSON bodies are a trust boundary: validate at runtime even though the
  // contract type already says `name: string`.
  if (typeof input.name !== "string") {
    throw new BackendError("invalid_request", "name is required");
  }
  const filePath = await resolveSessionPath(input.sessionId);
  if (!filePath) {
    throw new BackendError("session_not_found", "Session not found");
  }
  try {
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(input.name.trim());
  } catch (error) {
    throw new BackendError("internal_error", error instanceof Error ? error.message : String(error));
  }
  invalidateSessionListCache();
  return { success: true, sessionId: input.sessionId };
}

export async function deleteSession(
  input: SessionIdInput,
): Promise<SessionMutationResponse> {
  const { sessionId: id } = input;
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    throw new BackendError("session_not_found", "Session not found");
  }

  // Preserve the current ordering exactly: read parent, re-parent children,
  // unlink (the live session, if any, is closed via daemon pi:close at the
  // route layer before this runs), invalidate caches.
  const parentSessionPath = readSessionHeader(filePath)?.parentSession;
  const targetPathKey = sessionPathKey(filePath);
  const dir = dirname(filePath);
  try {
    const files = readdirSync(dir).filter(
      (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
    );
    for (const file of files) {
      const childPath = join(dir, file);
      try {
        const content = readFileSync(childPath, "utf8");
        const lines = content.split("\n");
        const header = JSON.parse(lines[0]!) as { type?: string; parentSession?: string };
        if (
          header.type === "session" &&
          header.parentSession &&
          sessionPathKey(header.parentSession) === targetPathKey
        ) {
          header.parentSession = parentSessionPath;
          lines[0] = JSON.stringify(header);
          writeFileSync(childPath, lines.join("\n"));
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* skip if dir unreadable */ }

  try {
    unlinkSync(filePath);
  } catch (error) {
    throw new BackendError("internal_error", error instanceof Error ? error.message : String(error));
  }
  invalidateSessionPathCache(id);
  invalidateSessionListCache();
  return { success: true, sessionId: id };
}

export async function getSessionThinking(
  input: SessionIdInput & { entryId: string; blockIndex: number },
): Promise<{ thinking: string }> {
  const { sessionId: id, entryId, blockIndex } = input;
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    throw new BackendError("invalid_request", "Valid blockIndex is required");
  }

  const filePath = await resolveSessionPath(id);
  if (!filePath) throw new BackendError("session_not_found", "Session not found");

  // SessionManager-backed parsing preserves the SDK's malformed-line tolerance.
  let entry: SessionEntry | undefined;
  try {
    entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
  } catch (error) {
    throw new BackendError("internal_error", error instanceof Error ? error.message : String(error));
  }
  if (!entry || entry.type !== "message" || entry.message.role !== "assistant") {
    throw new BackendError("entry_not_found", "Assistant message not found");
  }

  const block = entry.message.content[blockIndex];
  if (!block || block.type !== "thinking") {
    throw new BackendError("thinking_block_not_found", "Thinking block not found");
  }

  return { thinking: block.thinking };
}
