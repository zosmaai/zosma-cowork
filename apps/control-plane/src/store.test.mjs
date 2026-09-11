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