/**
 * Coverage for ZOS-89 session-to-harness persistence (store.ts): recovery of
 * invalid records on load and atomic persistence to disk.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  recover,
  SessionStore,
  sessionRecordSchema,
} from "./store.ts";
import type { SessionRecord } from "./store.ts";
import { sessionStateSchema } from "./session-state.ts";

function handle(state: SessionRecord["handle"]["state"] = "running"): SessionRecord["handle"] {
  return { sessionId: "cowork-1", state };
}

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "zosma-store-"));
  return dir;
}

test("record schema requires a handle with a valid state", () => {
  assert.ok(sessionRecordSchema({ handle: handle() }).ok);
  assert.ok(!sessionRecordSchema({ handle: { sessionId: "x", state: "bogus" } }).ok);
  assert.ok(!sessionRecordSchema({ handle: { sessionId: "x" } }).ok);
  assert.ok(!sessionRecordSchema({ adapterId: "pi" }).ok);
});

test("recover keeps valid records and drops invalid ones", () => {
  const raw = [
    { handle: handle() },
    { handle: handle("idle"), adapterId: "pi" },
    { handle: { sessionId: "bad", state: "nope" } },
    "not-an-object",
    { handle: { sessionId: "with-pid", state: "paused" }, pid: 4242, workspace: "/ws", createdAt: 1 },
  ];
  const res = recover(raw);
  assert.equal(res.dropped, 2);
  assert.equal(res.ok.length, 3);
  assert.equal(res.ok[0]!.handle.sessionId, "cowork-1");
  assert.equal(res.ok[1]!.adapterId, "pi");
  const withPid = res.ok.find((r) => r.handle.sessionId === "with-pid")!;
  assert.equal(withPid.pid, 4242);
  assert.equal(withPid.workspace, "/ws");
  assert.equal(withPid.createdAt, 1);
});

test("recover on a non-array returns empty (nothing to rebuild)", () => {
  const res = recover({ sessions: [] });
  assert.equal(res.ok.length, 0);
  assert.equal(res.dropped, 0);
});

test("recover with no input returns empty", () => {
  const res = recover(undefined);
  assert.deepEqual(res, { ok: [], dropped: 0, invalid: 0 });
});

test("SessionStore round-trips add -> get -> list", async () => {
  const dir = await tempDir();
  const store = new SessionStore(dir);

  await store.add({ handle: handle("running") });

  const got = await store.get("cowork-1");
  assert.ok(got);
  assert.equal(got?.handle.state, "running");

  const list = await store.list();
  assert.equal(list.length, 1);
});

test("SessionStore.add overwrites existing record for the same session", async () => {
  const dir = await tempDir();
  const store = new SessionStore(dir);

  await store.add({ handle: handle("running") });
  await store.add({ handle: handle("paused"), adapterId: "pi" });

  const list = await store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.handle.state, "paused");
  assert.equal(list[0]!.adapterId, "pi");
});

test("SessionStore.remove drops the record", async () => {
  const dir = await tempDir();
  const store = new SessionStore(dir);
  await store.add({ handle: handle() });

  await store.remove("cowork-1");
  assert.equal((await store.list()).length, 0);
  assert.equal(await store.get("cowork-1"), undefined);
});

test("SessionStore reloads from disk (restart recovery)", async () => {
  const dir = await tempDir();
  const store = new SessionStore(dir);
  await store.add({ handle: handle("idle"), workspace: "/ws" });

  // New store instance against same dir = process restart.
  const reopened = new SessionStore(dir);
  const list = await reopened.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.handle.state, "idle");
  assert.equal(list[0]!.workspace, "/ws");
});

test("persist writes atomically and leaves no temp files", async () => {
  const dir = await tempDir();
  const store = new SessionStore(dir);
  await store.add({ handle: handle() });

  const files = await fs.readdir(dir);
  assert.equal(files.length, 1);
  assert.equal(files[0], "sessions.json");
});

test("recover tolerates a corrupt (non-JSON) store file", async () => {
  const dir = await tempDir();
  await fs.writeFile(join(dir, "sessions.json"), "{ not json", "utf8");
  const store = new SessionStore(dir);
  // Corrupt file = nothing to recover; load returns empty, no throw.
  assert.deepEqual(await store.list(), []);
});
