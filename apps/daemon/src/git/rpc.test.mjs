import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GIT_RPC_OPS, handleGitRpc } from "./rpc.ts";
import { allowFileRoot } from "./allowed-roots.ts";

// Seed the dirs we authorize here, before any op runs, so the file-access
// module cache is warm with exactly the roots under test. `deniedDir` is left
// un-rooted by design.
let successDir;
let validateDir;
let deniedDir;

test.before(() => {
  successDir = mkdtempSync(path.join(tmpdir(), "rpc-success-"));
  validateDir = mkdtempSync(path.join(tmpdir(), "rpc-validate-"));
  deniedDir = mkdtempSync(path.join(tmpdir(), "rpc-denied-"));
  allowFileRoot(successDir);
  allowFileRoot(validateDir);
});

test.after(() => {
  for (const d of [successDir, validateDir, deniedDir]) {
    rmSync(d, { recursive: true, force: true });
  }
});

test("GIT_RPC_OPS lists the known ops", () => {
  assert.deepEqual([...GIT_RPC_OPS], [
    "git:status",
    "git:diff",
    "cwd:validate",
    "worktrees:list",
    "worktrees:create",
    "worktrees:remove",
  ]);
});

test("git:status rejects a missing cwd", async () => {
  const r = await handleGitRpc({ type: "git:status" });
  assert.equal(r.status, 400);
});

test("git:status rejects a relative cwd", async () => {
  const r = await handleGitRpc({ type: "git:status", cwd: "relative/path" });
  assert.equal(r.status, 400);
});

test("git:status denies a cwd outside allowed roots", async () => {
  const r = await handleGitRpc({ type: "git:status", cwd: deniedDir });
  assert.equal(r.status, 403);
});

test("git:status returns a status body for an allowed dir", async () => {
  const r = await handleGitRpc({ type: "git:status", cwd: successDir });
  assert.equal(r.status, 200);
  assert.ok(r.body && typeof r.body === "object");
  assert.equal(r.body.isGitRepository, false);
});

test("git:diff rejects a missing path", async () => {
  const r = await handleGitRpc({ type: "git:diff", cwd: successDir });
  assert.equal(r.status, 400);
});

test("cwd:validate rejects a missing cwd", async () => {
  const r = await handleGitRpc({ type: "cwd:validate" });
  assert.equal(r.status, 400);
});

test("cwd:validate accepts an allowed dir", async () => {
  const r = await handleGitRpc({ type: "cwd:validate", cwd: validateDir });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.success, true);
  assert.equal(b.cwd, validateDir);
  assert.ok(b.projectKey);
  assert.ok(b.projectRoot);
});

test("worktrees:list requires a cwd", async () => {
  const r = await handleGitRpc({ type: "worktrees:list" });
  assert.equal(r.status, 400);
});

test("worktrees:create requires a branch", async () => {
  const r = await handleGitRpc({ type: "worktrees:create", cwd: successDir });
  assert.equal(r.status, 400);
});

test("worktrees:remove denies an unrooted cwd", async () => {
  const r = await handleGitRpc({ type: "worktrees:remove", cwd: deniedDir, path: "x" });
  assert.equal(r.status, 403);
});

test("unknown op returns invalid_request", async () => {
  const r = await handleGitRpc({ type: "not-an-op", cwd: successDir });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid_request");
});
