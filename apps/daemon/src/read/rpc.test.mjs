import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { READ_RPC_OPS, handleReadRpc } from "./rpc.ts";
import { allowFileRoot } from "../git/allowed-roots.ts";

let rootDir;
let deniedDir;

test.before(() => {
  rootDir = mkdtempSync(path.join(tmpdir(), "read-root-"));
  deniedDir = mkdtempSync(path.join(tmpdir(), "read-denied-"));
  allowFileRoot(rootDir);
});

test.after(() => {
  try { rmdirSync(rootDir, { recursive: true }); } catch { /* gone */ }
  try { rmdirSync(deniedDir, { recursive: true }); } catch { /* gone */ }
});

test("read ops are dispatched by the server op registry", () => {
  assert.ok(READ_RPC_OPS.includes("read:list-sessions"));
  assert.ok(READ_RPC_OPS.includes("read:session-details"));
  assert.ok(READ_RPC_OPS.includes("read:session-thinking"));
  assert.ok(READ_RPC_OPS.includes("read:models"));
  assert.ok(READ_RPC_OPS.includes("read:skills-list"));
  assert.ok(READ_RPC_OPS.includes("read:plugins-list"));
});

test("read:list-sessions returns an empty sessions array on a fresh index", async () => {
  const r = await handleReadRpc({ type: "read:list-sessions", force: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.data.sessions));
});

test("read:session-details returns 404 session_not_found for an unknown id", async () => {
  const r = await handleReadRpc({ type: "read:session-details", sessionId: "nope" });
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
});

test("read:session-thinking rejects a bad blockIndex", async () => {
  const r = await handleReadRpc({ type: "read:session-thinking", sessionId: "x", entryId: "y", blockIndex: -1 });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "invalid_request");
});

test("read:session-rename with no name is 400", async () => {
  const r = await handleReadRpc({ type: "read:session-rename", sessionId: "whatever" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "invalid_request");
});

test("read:session-delete on an unknown session is 404, not a crash", async () => {
  const r = await handleReadRpc({ type: "read:session-delete", sessionId: "missing-session" });
  assert.equal(r.status, 404);
});

test("read:models without a cwd resolves the default workspace catalog", async () => {
  const r = await handleReadRpc({ type: "read:models" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.data.models !== undefined || r.body.data.modelError !== undefined);
});

test("read:skills-list does not gate cwd (trust status reported, not denied)", async () => {
  const r = await handleReadRpc({ type: "read:skills-list", cwd: deniedDir });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("read:skills-install requires a source", async () => {
  const r = await handleReadRpc({ type: "read:skills-install" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "invalid_request");
});

test("read:skills-search requires a query", async () => {
  const r = await handleReadRpc({ type: "read:skills-search" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "invalid_request");
});

test("read:plugins-list gates cwd outside allowed roots as 403", async () => {
  const r = await handleReadRpc({ type: "read:plugins-list", cwd: deniedDir });
  assert.equal(r.status, 403);
});

test("read:plugins-manage requires an action", async () => {
  const r = await handleReadRpc({ type: "read:plugins-manage" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "invalid_request");
});
test("read:capabilities returns the v1 capability manifest", async () => {
  const r = await handleReadRpc({ type: "read:capabilities" });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.apiVersion, "v1");
  assert.ok(Array.isArray(r.body.data.commandTransports));
  assert.equal(r.body.data.features.prompt, true);
  assert.equal(r.body.data.features.sessionBranches, true);
});

test("read:health reports ok with a pi version string", async () => {
  const r = await handleReadRpc({ type: "read:health" });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, "ok");
  assert.equal(r.body.data.apiVersion, "v1");
  assert.equal(typeof r.body.data.piVersion, "string");
  assert.ok(r.body.data.piVersion.length > 0);
});

test("read:allow-root admits a new root for cwd-gated read ops", async () => {
  const newRoot = mkdtempSync(path.join(tmpdir(), "read-newroot-"));
  try {
    const before = await handleReadRpc({ type: "read:plugins-list", cwd: newRoot });
    assert.equal(before.status, 403);
    const allow = await handleReadRpc({ type: "read:allow-root", root: newRoot });
    assert.equal(allow.status, 200);
    const after = await handleReadRpc({ type: "read:plugins-list", cwd: newRoot });
    assert.notEqual(after.status, 403);
  } finally {
    try { rmdirSync(newRoot, { recursive: true }); } catch { /* gone */ }
  }
});

test("read:models does not gate cwd (catalog parity with the old web route)", async () => {
  const r = await handleReadRpc({ type: "read:models", cwd: deniedDir });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("read:allow-root without a root is 400", async () => {
  const r = await handleReadRpc({ type: "read:allow-root" });
  assert.equal(r.status, 400);
});

test("read:invalidate-models busts the daemon model cache", async () => {
  const r = await handleReadRpc({ type: "read:invalidate-models" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { ok: true });
});

test("read:skills-toggle requires filePath", async () => {
  const r = await handleReadRpc({ type: "read:skills-toggle", disableModelInvocation: true });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "invalid_request");
});

test("read:skills-toggle flips the frontmatter key on and off", async () => {
  const file = path.join(rootDir, "SKILL.md");
  writeFileSync(file, "---\nname: demo\n---\nBody\n", "utf8");
  const on = await handleReadRpc({ type: "read:skills-toggle", filePath: file, disableModelInvocation: true });
  assert.equal(on.status, 200);
  assert.match(readFileSync(file, "utf8"), /disable-model-invocation: true/);
  const off = await handleReadRpc({ type: "read:skills-toggle", filePath: file, disableModelInvocation: false });
  assert.equal(off.status, 200);
  assert.doesNotMatch(readFileSync(file, "utf8"), /disable-model-invocation/);
});

test("read:skills-toggle denies files outside allowed roots and reports missing files", async () => {
  const outside = path.join(deniedDir, "SKILL.md");
  writeFileSync(outside, "---\nname: x\n---\n", "utf8");
  const denied = await handleReadRpc({ type: "read:skills-toggle", filePath: outside, disableModelInvocation: true });
  assert.equal(denied.status, 403);
  const missing = await handleReadRpc({ type: "read:skills-toggle", filePath: path.join(rootDir, "nope.md"), disableModelInvocation: true });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "entry_not_found");
});

test("read:skills-check forwards package/scope and rejects an unpaired package", async () => {
  const r = await handleReadRpc({ type: "read:skills-check", cwd: rootDir, package: "x@y" });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "invalid_request");
});

test("read:project-trust reports status and records trust", async () => {
  // No trust-requiring resources in an empty root → trusted by default.
  const status = await handleReadRpc({ type: "read:project-trust", cwd: rootDir });
  assert.equal(status.status, 200);
  assert.equal(status.body.data.requiresTrust, false);
  assert.equal(status.body.data.trusted, true);

  const set = await handleReadRpc({ type: "read:project-trust", cwd: rootDir, trust: true });
  assert.equal(set.status, 200);
  assert.equal(set.body.data.trusted, true);

  const missing = await handleReadRpc({ type: "read:project-trust" });
  assert.equal(missing.status, 400);
});

test("read:pi-package-dir returns a package directory", async () => {
  const r = await handleReadRpc({ type: "read:pi-package-dir" });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.data.packageDir, "string");
  assert.ok(r.body.data.packageDir.length > 0);
});

test("read:session-entries requires filePath and denies unknown files", async () => {
  const missing = await handleReadRpc({ type: "read:session-entries" });
  assert.equal(missing.status, 400);

  // The op gates filePath to allowed roots (agent dir also permitted); a
  // clearly-outside path is denied.
  const denied = await handleReadRpc({ type: "read:session-entries", filePath: deniedDir });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "access_denied");
});

test("read:session-entries reads entries from a session file", async () => {
  // Minimal JSONL session file inside an allowed root (session-file layout).
  const sessionFile = path.join(rootDir, "entry-probe.jsonl");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", id: "entry-probe", cwd: rootDir, created: new Date().toISOString() }),
      JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: "hi" } }),
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const r = await handleReadRpc({ type: "read:session-entries", filePath: sessionFile });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data.entries));
    assert.ok(r.body.data.entries.length >= 1);
  } finally {
    rmSync(sessionFile, { force: true });
  }
});
