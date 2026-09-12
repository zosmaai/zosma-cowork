import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstance } from "./instance.ts";

function tmpData() {
  const dir = mkdtempSync(join(tmpdir(), "zosma-daemon-test-"));
  return dir;
}

test("acquires the lock on a fresh data dir", () => {
  const data = tmpData();
  const inst = createInstance({ dataDir: data });
  assert.equal(inst.acquire(), true);
  assert.ok(existsSync(inst.lockPath));
  inst.release();
  assert.ok(!existsSync(inst.lockPath));
  rmSync(data, { recursive: true, force: true });
});

test("rejects a second instance while the first holds the lock", () => {
  const data = tmpData();
  const inst = createInstance({ dataDir: data });
  assert.equal(inst.acquire(), true);
  const second = createInstance({ dataDir: data });
  assert.equal(second.acquire(), false);
  inst.release();
  rmSync(data, { recursive: true, force: true });
});

test("reclaims a stale lock (dead pid or old timestamp)", () => {
  const data = tmpData();
  const lockPath = join(data, "daemon.lock");
  // dead pid + stale timestamp
  const stale = { id: "old", pid: 999999, ts: Date.now() - 60_000 };
  writeFileSync(lockPath, JSON.stringify(stale), { mode: 0o600 });

  const inst = createInstance({ dataDir: data });
  assert.equal(inst.acquire(), true); // reclaimed
  assert.ok(inst.lockPath);
  const now = JSON.parse(readFileSync(inst.lockPath, "utf8"));
  assert.equal(now.pid, process.pid);
  inst.release();
  rmSync(data, { recursive: true, force: true });
});

test("does not reclaim a fresh lock owned by a live pid", () => {
  const data = tmpData();
  const inst = createInstance({ dataDir: data });
  assert.equal(inst.acquire(), true);
  const real = JSON.parse(readFileSync(inst.lockPath, "utf8"));

  const other = createInstance({ dataDir: data });
  assert.equal(other.acquire(), false); // live owner honored
  assert.equal(other.id, real.id);

  inst.release();
  rmSync(data, { recursive: true, force: true });
});
