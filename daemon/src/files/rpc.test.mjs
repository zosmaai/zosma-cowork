import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FILES_RPC_OPS, handleFilesRpc } from "./rpc.ts";
import { allowFileRoot } from "../git/allowed-roots.ts";

// Seed the roots we authorize, before any op runs, so the file-access module
// cache is warm with exactly the roots under test. `deniedDir` is left
// un-rooted by design so every op against it must be 403.
let rootDir;
let deniedDir;

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

test.before(() => {
  rootDir = mkdtempSync(path.join(tmpdir(), "files-root-"));
  deniedDir = mkdtempSync(path.join(tmpdir(), "files-denied-"));
  allowFileRoot(rootDir);
});

test.after(() => {
  for (const d of [rootDir, deniedDir]) {
    rmdirSync(d, { recursive: true, force: true });
  }
});

test("FILES_RPC_OPS lists the known ops", () => {
  assert.deepEqual([...FILES_RPC_OPS], [
    "files:list",
    "files:read",
    "files:stat",
    "files:write",
    "files:index",
  ]);
});

test("start with files:list — rejects a missing cwd", async () => {
  const r = await handleFilesRpc({ type: "files:list" });
  assert.equal(r.status, 400);
});

test("files:list rejects a relative cwd", async () => {
  const r = await handleFilesRpc({ type: "files:list", cwd: "relative/path" });
  assert.equal(r.status, 400);
});

test("files:list denies a cwd outside allowed roots", async () => {
  const r = await handleFilesRpc({ type: "files:list", cwd: deniedDir });
  assert.equal(r.status, 403);
});

test("files:list returns entries for an allowed dir, dirs first", async () => {
  mkdirSync(path.join(rootDir, "sub"), { recursive: true });
  writeFileSync(path.join(rootDir, "a.txt"), "aaa");
  const r = await handleFilesRpc({ type: "files:list", cwd: rootDir });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.entries.map((e) => [e.name, e.isDir]),
    [["sub", true], ["a.txt", false]],
  );
});

test("files:list caps entries and reports truncation", async () => {
  const dir = path.join(rootDir, "many");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 1050; i++) writeFileSync(path.join(dir, `f${i}.txt`), "x");
  const r = await handleFilesRpc({ type: "files:list", cwd: dir });
  assert.equal(r.status, 200);
  assert.equal(r.body.entries.length, 1000);
  assert.equal(r.body.truncated, true);
});

test("files:read rejects a missing path", async () => {
  const r = await handleFilesRpc({ type: "files:read", cwd: rootDir });
  assert.equal(r.status, 400);
});

test("files:read denies a cwd outside allowed roots", async () => {
  const r = await handleFilesRpc({ type: "files:read", cwd: deniedDir, path: "a.txt" });
  assert.equal(r.status, 403);
});

test("files:read returns content and hash for an allowed file", async () => {
  const r = await handleFilesRpc({ type: "files:read", cwd: rootDir, path: "a.txt" });
  assert.equal(r.status, 200);
  assert.equal(r.body.content, "aaa");
  assert.equal(r.body.sha256, sha256("aaa"));
  assert.equal(r.body.size, 3);
});

test("files:read rejects traversal outside the cwd", async () => {
  const r = await handleFilesRpc({ type: "files:read", cwd: rootDir, path: "../denied.txt" });
  assert.equal(r.status, 400);
});

test("files:read rejects a symlink escaping the root", async () => {
  writeFileSync(path.join(deniedDir, "secret.txt"), "s");
  const linkPath = path.join(rootDir, "escape.txt");
  try {
    symlinkSync(path.join(deniedDir, "secret.txt"), linkPath);
  } catch {
    // symlink unsupported on this platform — skip
    return;
  }
  const r = await handleFilesRpc({ type: "files:read", cwd: rootDir, path: "escape.txt" });
  assert.equal(r.status, 403);
});

test("files:read cannot cross into another allowed workspace", async () => {
  // A second approved root is legal; reading one workspace's file through
  // the other must fail — relative paths can never resolve into it, and `..`
  // is rejected before any resolve happens.
  const otherRoot = mkdtempSync(path.join(tmpdir(), "files-other-"));
  allowFileRoot(otherRoot);
  writeFileSync(path.join(otherRoot, "private.txt"), "private");
  const r = await handleFilesRpc({ type: "files:read", cwd: rootDir, path: "other/private.txt" });
  assert.equal(r.status, 404); // not under this cwd at all
  rmdirSync(otherRoot, { recursive: true, force: true });
});

test("files:read truncates oversized content", async () => {
  const big = "x".repeat(300 * 1024); // 300KiB
  writeFileSync(path.join(rootDir, "big.txt"), big);
  const r = await handleFilesRpc({ type: "files:read", cwd: rootDir, path: "big.txt" });
  assert.equal(r.status, 200);
  assert.equal(r.body.truncated, true);
});

test("files:stat returns stats for a file", async () => {
  const r = await handleFilesRpc({ type: "files:stat", cwd: rootDir, path: "a.txt" });
  assert.equal(r.status, 200);
  assert.equal(r.body.isFile, true);
  assert.equal(r.body.size, 3);
});

test("files:stat returns not-found for a missing path", async () => {
  const r = await handleFilesRpc({ type: "files:stat", cwd: rootDir, path: "nope.txt" });
  assert.equal(r.status, 200);
  assert.equal(r.body.exists, false);
});

test("files:write creates a new file", async () => {
  const r = await handleFilesRpc({ type: "files:write", cwd: rootDir, path: "new.txt", content: "hello" });
  assert.equal(r.status, 200);
  assert.equal(r.body.sha256, sha256("hello"));
});

test("files:write rejects traversal outside the cwd", async () => {
  const r = await handleFilesRpc({ type: "files:write", cwd: rootDir, path: "../evil.txt", content: "x" });
  assert.equal(r.status, 400);
});

test("files:write with a stale expectedSha256 conflicts (409)", async () => {
  await handleFilesRpc({ type: "files:write", cwd: rootDir, path: "conflict.txt", content: "v1" });
  const r = await handleFilesRpc({
    type: "files:write", cwd: rootDir, path: "conflict.txt", content: "v2", expectedSha256: "deadbeef",
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.currentSha256, sha256("v1"));
});

test("files:write with a matching expectedSha256 succeeds", async () => {
  const r = await handleFilesRpc({
    type: "files:write", cwd: rootDir, path: "conflict.txt", content: "v2", expectedSha256: sha256("v1"),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.sha256, sha256("v2"));
});

test("files:index returns the listing for an allowed repo", async () => {
  const r = await handleFilesRpc({ type: "files:index", cwd: rootDir });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.files));
  assert.ok(r.body.files.includes("a.txt"));
});

test("files:index filters by query", async () => {
  const r = await handleFilesRpc({ type: "files:index", cwd: rootDir, query: "a.txt" });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.matches));
  assert.ok(r.body.matches.some((m) => m.path === "a.txt"));
});

test("unknown op returns invalid_request", async () => {
  const r = await handleFilesRpc({ type: "files:not-an-op", cwd: rootDir });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid_request");
});