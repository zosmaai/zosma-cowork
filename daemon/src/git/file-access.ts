/**
 * File access authorization for the daemon's Git/worktree RPC.
 *
 * A faithful port of `web/lib/file-access.ts`, adapted for the standalone
 * daemon: the Next.js `globalThis` hot-reload cache becomes a plain module
 * cache (the daemon is one long-lived process), and the set of browsable
 * session roots is injected so the gate can be unit-tested without a live
 * agent session store (see daemon slice wiring).
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots.ts";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security.ts";

declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

/** Short-TTL cache for the allowed-roots set. 5s is short enough that
 *  newly-created cwds appear promptly, without rescanning on every request. */
const ALLOWED_ROOTS_TTL_MS = 5_000;
let cache: { roots: Set<string>; expiresAt: number } | undefined;

/**
 * Compute the browsable roots: roots from live sessions, `~/pi-cwd-*`
 * directories created by the default-cwd endpoint, and config roots.
 * `getSessionRoots` yields the session-derived roots (cwd + project root of
 * each session) — injected so this stays testable.
 */
export async function getAllowedFileRoots(
  getSessionRoots: () => Promise<Iterable<string>> = () => Promise.resolve([]),
  forceRefresh = false,
): Promise<Set<string>> {
  const now = Date.now();
  if (!forceRefresh && cache && cache.expiresAt > now) return cache.roots;

  const roots = new Set<string>();
  try {
    for (const root of await getSessionRoots()) roots.add(normalizeSlashes(root));
  } catch {
    // session listing must never wedge access checks
  }
  try {
    for (const name of readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) roots.add(normalizeSlashes(path.join(homedir(), name)));
    }
  } catch {
    // home is unreadable — ignore
  }
  for (const root of getAdditionalAllowedRoots()) roots.add(normalizeSlashes(root));

  cache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots);
}

export { allowFileRoot, normalizeSlashes } from "./allowed-roots.ts";
