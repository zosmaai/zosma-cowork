import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandStore } from "./store.ts";

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "cp-store-"));
  return dir;
}
function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test("append assigns increasing per-machine sequence numbers", async () => {
  const dir = freshDir();
  const store = createCommandStore(dir);
  try {
    const s1 = await store.append("m-1", { correlationId: "c-1", method: "session.start", params: {} });
    const s2 = await store.append("m-1", { correlationId: "c-2", method: "session.stop" });
    const s3 = await store.append("m-1", { correlationId: "c-3", method: "session.start" });
    assert.deepEqual([s1, s2, s3], [1, 2, 3]);
    // different machines have independent sequences
    const s4 = await store.append("m-2", { correlationId: "d-1", method: "ping" });
    assert.equal(s4, 1);
  } finally {
    store.close();
    cleanup(dir);
  }
});

test("pending returns unacked commands in sequence order", async () => {
  const dir = freshDir();
  const store = createCommandStore(dir);
  try {
    await store.append("m-1", { correlationId: "c-1", method: "a" });
    await store.append("m-1", { correlationId: "c-2", method: "b" });
    await store.append("m-2", { correlationId: "d-1", method: "other" });
    const pending = await store.pending("m-1");
    assert.deepEqual(pending.map((c) => c.correlationId), ["c-1", "c-2"]);
    assert.deepEqual(pending.map((c) => c.method), ["a", "b"]);
  } finally {
    store.close();
    cleanup(dir);
  }
});

test("ack removes a command from pending", async () => {
  const dir = freshDir();
  const store = createCommandStore(dir);
  try {
    await store.append("m-1", { correlationId: "c-1", method: "a" });
    await store.append("m-1", { correlationId: "c-2", method: "b" });
    await store.ack("c-1");
    const pending = await store.pending("m-1");
    assert.deepEqual(pending.map((c) => c.correlationId), ["c-2"]);
    // double ack is a no-op, not an error (idempotent replay safety)
    await store.ack("c-1");
    const again = await store.pending("m-1");
    assert.deepEqual(again.map((c) => c.correlationId), ["c-2"]);
  } finally {
    store.close();
    cleanup(dir);
  }
});

test("acks and pendings survive a store reopen (durability)", async () => {
  const dir = freshDir();
  let store = createCommandStore(dir);
  await store.append("m-1", { correlationId: "c-1", method: "a" });
  await store.append("m-1", { correlationId: "c-2", method: "b" });
  await store.ack("c-1");
  store.close();

  store = createCommandStore(dir);
  try {
    const pending = await store.pending("m-1");
    assert.deepEqual(pending.map((c) => c.correlationId), ["c-2"]);
    // watermark = highest seq seen
    assert.equal(store.watermark("m-1"), 2);
  } finally {
    store.close();
    cleanup(dir);
  }
});
test("recordReply persists a machine's answer keyed by correlation id", async () => {
  const dir = freshDir();
  const store = createCommandStore(dir);
  try {
    await store.append("m-1", { correlationId: "c-1", method: "pi:health" });
    await store.recordReply("c-1", { ok: true, data: { status: "ready" } });
    assert.deepEqual(await store.reply("c-1"), { ok: true, data: { status: "ready" } });
    assert.equal(await store.reply("nope"), undefined);
  } finally {
    store.close();
    cleanup(dir);
  }
});

test("replies survive a store restart (journal replay)", async () => {
  const dir = freshDir();
  const store = createCommandStore(dir);
  await store.append("m-1", { correlationId: "c-1", method: "pi:health" });
  await store.recordReply("c-1", { ok: false, error: { code: "cmd_failed", message: "boom" } });
  store.close();

  const reloaded = createCommandStore(dir);
  try {
    assert.deepEqual(await reloaded.reply("c-1"), { ok: false, error: { code: "cmd_failed", message: "boom" } });
  } finally {
    reloaded.close();
    cleanup(dir);
  }
});

// --- ZOS-91: durable machine registry + revocation ---

test("register upserts a machine record (firstSeenAt preserved, lastSeenAt advances)", async () => {
  const dir = freshDir();
  const store = createCommandStore(dir);
  try {
    const first = await store.register("m-1", "laptop", { manifestVersion: 1 });
    assert.equal(first.machineId, "m-1");
    assert.equal(first.name, "laptop");
    assert.deepEqual(first.manifest, { manifestVersion: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.register("m-1", "laptop-renamed", { manifestVersion: 2 });
    assert.equal(second.firstSeenAt, first.firstSeenAt, "re-registration keeps the original firstSeenAt");
    assert.ok(second.lastSeenAt >= first.lastSeenAt);
    assert.equal(second.name, "laptop-renamed");
    const all = await store.registry();
    assert.equal(all.length, 1, "idempotent — one record");
  } finally {
    store.close();
    cleanup(dir);
  }
});

test("the registry survives a store restart", async () => {
  const dir = freshDir();
  const store = createCommandStore(dir);
  await store.register("m-1", "laptop", { manifestVersion: 1, services: ["pi:prompt"] });
  store.close();

  const reloaded = createCommandStore(dir);
  try {
    const all = await reloaded.registry();
    assert.equal(all.length, 1);
    assert.equal(all[0].machineId, "m-1");
    assert.deepEqual(all[0].manifest.services, ["pi:prompt"]);
  } finally {
    reloaded.close();
    cleanup(dir);
  }
});

test("revocation is durable, hides the record, and is clearable", async () => {
  const dir = freshDir();
  const store = createCommandStore(dir);
  await store.register("m-1", "laptop");
  await store.revoke("m-1");
  assert.equal(store.isRevoked("m-1"), true);
  assert.deepEqual(await store.registry(), [], "a revoked machine leaves the registry");
  store.close();

  // the tombstone survives a restart, and a stray re-register cannot resurrect it
  const reloaded = createCommandStore(dir);
  try {
    assert.equal(reloaded.isRevoked("m-1"), true);
    await reloaded.register("m-1", "laptop");
    assert.deepEqual(await reloaded.registry(), [], "the tombstone wins over a re-register");
    await reloaded.clearRevocation("m-1");
    assert.equal(reloaded.isRevoked("m-1"), false);
    await reloaded.register("m-1", "laptop");
    assert.equal((await reloaded.registry()).length, 1);
  } finally {
    reloaded.close();
    cleanup(dir);
  }
});
