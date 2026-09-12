// Session-path helpers for the daemon-relay era (roadmap item 6 end-to-end).
// The session list scan and context building live in the daemon's read:* ops;
// web keeps only the path-resolution helpers its routes need to find session
// files on disk for daemon resume, backed by the relayed list.
import { normalize as normalizePath } from "path";
import { piRead } from "./daemon-client";
import { sessionPathKey } from "./session-path";
import type { SessionEntry, SessionInfo } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __piSessionListGeneration: number | undefined;
  // eslint-disable-next-line no-var
  var __piSessionListCache: unknown;
  // eslint-disable-next-line no-var
  var __piSessionPathCache: Map<string, string> | undefined;
  // eslint-disable-next-line no-var
  var __piPathToSessionIdCache: Map<string, string> | undefined;
}

export async function listAllSessions(options: { force?: boolean } = {}): Promise<SessionInfo[]> {
  const data = (await piRead("list-sessions", options.force ? { force: true } : {})) as {
    sessions: SessionInfo[];
  };
  const sessions = data.sessions ?? [];
  for (const s of sessions) {
    if (s.path) cacheSessionPath(s.id, s.path);
  }
  return sessions;
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

/** Read a session file's entries through the daemon (read:session-entries). */
export async function getSessionEntries(filePath: string): Promise<SessionEntry[]> {
  const data = (await piRead("session-entries", { filePath })) as { entries?: SessionEntry[] };
  return data.entries ?? [];
}