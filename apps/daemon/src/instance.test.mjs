import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
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

test("reclaims a lock whose pid was recycled by a container restart", async (t) => {
  if (!existsSync("/proc/self/stat")) return t.skip("no /proc — start-time check unavailable");
  const data = tmpData();
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" });
  try {
    const lockPath = join(data, "daemon.lock");
    // Live pid, but a start time that cannot match: a recycled PID.
    writeFileSync(lockPath, JSON.stringify({ id: "old", pid: child.pid, ts: Date.now(), start: "1" }), { mode: 0o600 });
    const inst = createInstance({ dataDir: data });
    assert.equal(inst.acquire(), true);
    inst.release();
  } finally {
    child.kill("SIGKILL");
    rmSync(data, { recursive: true, force: true });
  }
});

test("reclaims a same-pid lock from a previous container boot", (t) => {
  if (!existsSync("/proc/self/stat")) return t.skip("no /proc — start-time check unavailable");
  const data = tmpData();
  // Same PID as this process (as in a container restart where both are 1),
  // but a start time that cannot match → recycled.
  writeFileSync(join(data, "daemon.lock"), JSON.stringify({ id: "old", pid: process.pid, ts: Date.now(), start: "1" }), { mode: 0o600 });
  const inst = createInstance({ dataDir: data });
  assert.equal(inst.acquire(), true);
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
