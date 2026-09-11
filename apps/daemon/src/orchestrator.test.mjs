import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { startDaemon } from "./orchestrator.ts";
import { createLogger } from "./log.ts";

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const r = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
    });
    r.on("error", reject);
  });
}

const cap = createLogger({ sink: () => {} });

test("starts, becomes ready, and shuts down cleanly on SIGINT", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-daemon-orch-"));
  let exited = null;
  let ready = false;
  const handle = await startDaemon({
    token: "test-token",
    dataDir,
    logger: cap,
    exit: (code) => {
      exited = code;
    },
    onReady: () => {
      ready = true;
    },
  });
  try {
    assert.equal(handle.acquired, true);
    assert.ok(handle.port);
    assert.equal(ready, true);
    assert.equal(handle.server.getState(), "ready");

    const health = await httpGet(handle.port, "/health");
    assert.equal(health.status, 200);

    // trigger the graceful shutdown startDaemon already registered
    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(exited, 0);
    assert.equal(handle.server.getState(), "shutting-down");
    await httpGet(handle.port, "/health").catch(() => ({ status: 0 }));
  } finally {
    handle.shutdown.unregister();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("second start with same data dir is busy (not acquired)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-daemon-busy-"));
  const first = await startDaemon({ token: "t", dataDir, logger: cap, exit: () => {} });
  assert.equal(first.acquired, true);
  try {
    const second = await startDaemon({ token: "t", dataDir, logger: cap, exit: () => {} });
    assert.equal(second.acquired, false);
    assert.equal(second.port, undefined);
  } finally {
    first.shutdown.unregister();
    await first.server.stop();
    first.instance.release();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
