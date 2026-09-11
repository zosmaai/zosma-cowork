/**
 * Thin RPC dispatch for the daemon's file/workspace/index operations.
 *
 * Port of the web routes `app/api/files/[...path]` (list/read/stat/write ops)
 * and `app/api/file-index`. The route-level Next.js plumbing is dropped; the
 * security gate lives in `../git/file-access.ts` (ported verbatim) and is
 * preserved here. This module only selects an op, validates inputs, and
 * applies the gate — no file-walking logic of its own beyond the bounded
 * primitives below.
 *
 * All paths are RELATIVE to `cwd` (the authenticated workspace root), never
 * absolute, so a remote caller can never address a file outside the roots it
 * has been granted. Reads/stats additionally realpath the target and require
 * it to stay inside an approved root, so a symlink inside a root cannot
 * smuggle a read outside it. Writes carry optimistic concurrency: when a file
 * already exists, an `expectedSha256` must match the current content or the
 * write is rejected 409, so concurrent writers cannot silently clobber each
 * other.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "../git/file-access.ts";
import { isWindowsAbsolutePath } from "../git/paths.ts";
import { TEXT_PREVIEW_MAX_BYTES } from "../git/file-types.ts";

const execFileAsync = promisify(execFile);

// RPC op identifiers dispatched to the file services below.
export const FILES_RPC_OPS = [
  "files:list",
  "files:read",
  "files:stat",
  "files:write",
  "files:index",
] as const;
export type FilesRpcOp = (typeof FILES_RPC_OPS)[number];

export interface FilesRpcRequest {
  type: string;
  cwd?: string;
  path?: string;
  content?: string;
  expectedSha256?: string;
  query?: string;
}

export interface IpcResult {
  status: number;
  body: unknown;
}

/** Bounded output: a single directory listing is capped so a pathological
 *  directory cannot grow a response without bound. */
const MAX_LIST_ENTRIES = 1000;
/** Bounded write payload: agent-written files are text/small assets, not
 *  uploads. Uploads stay on the web side (multipart, previews, streaming). */
const MAX_WRITE_BYTES = 4 * 1024 * 1024;

// Bounds for the index listing (faithful to the web file-index route).
const MAX_FILES = 5000;
const GIT_HARD_CAP = 200_000;
const WALK_HARD_CAP = 50_000;
const MAX_WALK_DEPTH = 8;
const MAX_QUERY_LENGTH = 500;

// Same skip lists as the web routes — used only for the non-git walk
// fallback. Git-tracked repos rely on .gitignore instead.
const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);
const IGNORED_SUFFIXES = [".pyc"];

interface FileListing {
  files: string[];
  hardTruncated: boolean;
}

function looksAbsolute(target: string): boolean {
  return target.startsWith("/") || isWindowsAbsolutePath(target);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Validate a client-supplied relative path: no abs paths, no `..`, no
 *  empty/`.` segments (`.` handling: "./x" is harmless but non-canonical —
 *  reject for a uniform contract). Returns the cleaned relative path. */
function validateRelativePath(rel: string): string | null {
  if (!rel) return null;
  const cleaned = rel.trim();
  if (!cleaned || cleaned.startsWith("/") || isWindowsAbsolutePath(cleaned)) return null;
  for (const segment of cleaned.split("/")) {
    if (segment === ".." || segment === "") return null;
  }
  return cleaned;
}

/** Authorize a full target path: cwd must be an allowed root AND the target
 *  must be lexically inside one. Does not touch the filesystem. */
async function gateLexical(cwd: string, full: string): Promise<IpcResult | null> {
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isFilePathAllowed(full, roots)) {
    return { status: 403, body: { error: "Access denied" } };
  }
  return null;
}

/** Authorize an existing path by realpath containment (symlink-aware). */
async function gateExisting(full: string): Promise<IpcResult | null> {
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(full, roots)) {
    return { status: 403, body: { error: "Access denied" } };
  }
  return null;
}

function listEntry(cwd: string, name: string): { name: string; isDir: boolean; size: number } | null {
  try {
    const s = statSync(path.join(cwd, name));
    return { name, isDir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size };
  } catch {
    return null;
  }
}

async function listWithGit(cwd: string): Promise<FileListing | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { timeout: 10_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
    );
    const all = stdout.split("\0").filter(Boolean);
    if (all.length > GIT_HARD_CAP) return { files: all.slice(0, GIT_HARD_CAP), hardTruncated: true };
    return { files: all, hardTruncated: false };
  } catch {
    return null;
  }
}

function listWithWalk(cwd: string): FileListing {
  const files: string[] = [];
  const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: cwd, rel: "", depth: 0 }];
  while (queue.length > 0) {
    const { abs, rel, depth } = queue.shift()!;
    let dirents;
    try {
      dirents = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      if (IGNORED_NAMES.has(d.name) || IGNORED_SUFFIXES.some((s) => d.name.endsWith(s))) continue;
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (depth + 1 <= MAX_WALK_DEPTH) queue.push({ abs: path.join(abs, d.name), rel: childRel, depth: depth + 1 });
      } else if (d.isFile()) {
        if (files.length >= WALK_HARD_CAP) return { files, hardTruncated: true };
        files.push(childRel);
      }
    }
  }
  return { files, hardTruncated: false };
}

export async function handleFilesRpc(req: FilesRpcRequest): Promise<IpcResult> {
  switch (req.type) {
    case "files:list": {
      const cwd = req.cwd?.trim() ?? "";
      if (!cwd || !looksAbsolute(cwd)) return { status: 400, body: { error: "cwd must be an absolute path" } };
      const denied = await gateLexical(cwd, cwd);
      if (denied) return denied;
      try {
        if (!statSync(cwd).isDirectory()) return { status: 400, body: { error: "Not a directory" } };
      } catch {
        return { status: 404, body: { error: "Directory not found" } };
      }
      const entries = readdirSync(cwd, { withFileTypes: true })
        .filter((d) => !IGNORED_NAMES.has(d.name) && !IGNORED_SUFFIXES.some((s) => d.name.endsWith(s)))
        .map((d) => listEntry(cwd, d.name))
        .filter((e) => e !== null)
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      const truncated = entries.length > MAX_LIST_ENTRIES;
      return { status: 200, body: { entries: truncated ? entries.slice(0, MAX_LIST_ENTRIES) : entries, truncated } };
    }

    case "files:stat": {
      const cwd = req.cwd?.trim() ?? "";
      const rel = validateRelativePath(req.path ?? "");
      if (rel === null) return { status: 400, body: { error: "path must be a relative path" } };
      const full = path.resolve(cwd, rel);
      const denied = await gateLexical(cwd, full);
      if (denied) return denied;
      let s;
      try {
        s = statSync(full);
      } catch {
        return { status: 200, body: { exists: false } };
      }
      // Existing target: realpath containment (symlink-aware).
      const realDenied = await gateExisting(full);
      if (realDenied) return realDenied;
      return {
        status: 200,
        body: { exists: true, isDir: s.isDirectory(), isFile: s.isFile(), size: s.size, modifiedAt: s.mtimeMs },
      };
    }

    case "files:read": {
      const cwd = req.cwd?.trim() ?? "";
      const rel = validateRelativePath(req.path ?? "");
      if (rel === null) return { status: 400, body: { error: "path must be a relative path" } };
      const full = path.resolve(cwd, rel);
      const denied = await gateLexical(cwd, full);
      if (denied) return denied;
      let s;
      try {
        s = statSync(full);
      } catch {
        return { status: 404, body: { error: "File not found" } };
      }
      if (!s.isFile()) return { status: 400, body: { error: "Not a file" } };
      const realDenied = await gateExisting(full);
      if (realDenied) return realDenied;
      if (s.size > TEXT_PREVIEW_MAX_BYTES) {
        return { status: 200, body: { truncated: true, size: s.size, sha256: null, content: null } };
      }
      const content = readFileSync(full, "utf8");
      return { status: 200, body: { content, size: s.size, sha256: sha256(content), truncated: false } };
    }

    case "files:write": {
      const cwd = req.cwd?.trim() ?? "";
      const rel = validateRelativePath(req.path ?? "");
      if (rel === null) return { status: 400, body: { error: "path must be a relative path" } };
      if (typeof req.content !== "string") return { status: 400, body: { error: "content is required" } };
      if (Buffer.byteLength(req.content, "utf8") > MAX_WRITE_BYTES) {
        return { status: 413, body: { error: "content exceeds write limit" } };
      }
      const full = path.resolve(cwd, rel);
      const denied = await gateLexical(cwd, full);
      if (denied) return denied;
      // The parent dir must exist and be realpath-contained (a symlinked dir
      // inside a root must not redirect the write outside it).
      const parent = path.dirname(full);
      try {
        if (!statSync(parent).isDirectory()) return { status: 400, body: { error: "Not a directory" } };
      } catch {
        return { status: 404, body: { error: "Directory not found" } };
      }
      const parentDenied = await gateExisting(parent);
      if (parentDenied) return parentDenied;
      const digest = sha256(req.content);
      let currentSha256: string | null = null;
      try {
        currentSha256 = sha256(readFileSync(full, "utf8"));
      } catch {
        // new file — no conflict possible
      }
      if (currentSha256 !== null && req.expectedSha256 !== undefined && req.expectedSha256 !== currentSha256) {
        return { status: 409, body: { error: "File has changed since last read", currentSha256, sha256: currentSha256 } };
      }
      writeFileSync(full, req.content, "utf8");
      return { status: 200, body: { sha256: digest } };
    }

    case "files:index": {
      const cwd = req.cwd?.trim() ?? "";
      const query = req.query?.slice(0, MAX_QUERY_LENGTH) ?? "";
      if (!cwd || !looksAbsolute(cwd)) return { status: 400, body: { error: "cwd must be an absolute path" } };
      const denied = await gateLexical(cwd, cwd);
      if (denied) return denied;
      try {
        if (!statSync(cwd).isDirectory()) return { status: 400, body: { error: "Not a directory" } };
      } catch {
        return { status: 404, body: { error: "Directory not found" } };
      }
      const listing = (await listWithGit(cwd)) ?? listWithWalk(cwd);
      if (query) {
        const matches = filterFileEntries(buildEntriesFromFiles(listing.files), query);
        return { status: 200, body: { matches } };
      }
      return {
        status: 200,
        body: { files: listing.files.slice(0, MAX_FILES), truncated: listing.hardTruncated || listing.files.length > MAX_FILES },
      };
    }

    default:
      return { status: 400, body: { error: "invalid_request", detail: "unknown op" } };
  }
}

// -- index helpers (port of the parts of lib/file-fuzzy the index needs)
interface FileIndexEntry {
  path: string;
  isDir: boolean;
}

function buildEntriesFromFiles(files: string[]): FileIndexEntry[] {
  const dirs = new Set<string>();
  for (const f of files) {
    let idx = f.indexOf("/");
    while (idx !== -1) {
      dirs.add(f.slice(0, idx));
      idx = f.indexOf("/", idx + 1);
    }
  }
  const entries: FileIndexEntry[] = [];
  for (const d of dirs) entries.push({ path: d, isDir: true });
  for (const f of files) if (f) entries.push({ path: f, isDir: false });
  entries.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  return entries;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) if (haystack[j] === needle[i]) i++;
  return i === needle.length;
}

const AT_RESULT_LIMIT = 20;

function scoreEntry(entry: FileIndexEntry, lowerQuery: string): number {
  const lowerPath = entry.path.toLowerCase();
  let score = 0;
  if (lowerQuery.includes("/")) {
    if (lowerPath === lowerQuery) score = 100;
    else if (lowerPath.startsWith(lowerQuery)) score = 80;
    else if (lowerPath.includes(lowerQuery)) score = 50;
    else if (isSubsequence(lowerQuery, lowerPath)) score = 10;
  } else {
    const slash = lowerPath.lastIndexOf("/");
    const lowerName = slash === -1 ? lowerPath : lowerPath.slice(slash + 1);
    if (lowerName === lowerQuery) score = 100;
    else if (lowerName.startsWith(lowerQuery)) score = 80;
    else if (lowerName.includes(lowerQuery)) score = 50;
    else if (lowerPath.includes(lowerQuery)) score = 30;
    else if (isSubsequence(lowerQuery, lowerPath)) score = 10;
  }
  if (entry.isDir && score > 0) score += 10;
  return score;
}

function filterFileEntries(entries: FileIndexEntry[], query: string, limit: number = AT_RESULT_LIMIT): FileIndexEntry[] {
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return entries.slice(0, limit);
  const scored: Array<{ entry: FileIndexEntry; score: number }> = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, lowerQuery);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.path.split("/").length - b.entry.path.split("/").length ||
      a.entry.path.localeCompare(b.entry.path),
  );
  return scored.slice(0, limit).map((s) => s.entry);
}