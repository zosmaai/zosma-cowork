import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, resolveToken, resolvePort } from "./index.ts";
import { createLogger } from "./log.ts";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test("resolveToken prefers env, else persists a fresh token file", () => {
  const dir = mkdtempSync(join(tmpdir(), "zosma-daemon-tok-"));
  const token = resolveToken(dir, { ZOSMA_DAEMON_TOKEN: "from-env" });
  assert.equal(token, "from-env");
  const token2 = resolveToken(dir, {});
  assert.ok(token2.length > 8);
  rmSync(dir, { recursive: true, force: true });
});

test("resolvePort reads a valid ZOSMA_DAEMON_PORT, else undefined", () => {
  assert.equal(resolvePort({ ZOSMA_DAEMON_PORT: "64713" }), 64713);
  assert.equal(resolvePort({}), undefined);
  assert.equal(resolvePort({ ZOSMA_DAEMON_PORT: "abc" }), undefined);
  assert.equal(resolvePort({ ZOSMA_DAEMON_PORT: "70000" }), undefined);
});

async function stopHandle(handle) {
  handle.shutdown?.unregister();
  await handle.server?.stop();
  handle.instance?.release();
}

test("run() starts the daemon, becomes ready, and shuts down cleanly", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-daemon-run-"));
  let exited = null;
  let healthReady = null;
  const handle = await run({
    dataDir,
    logger: createLogger({ sink: () => {} }),
    exit: (code) => {
      exited = code;
    },
  });
  try {
    assert.equal(handle.acquired, true);
    assert.ok(handle.port);
    assert.equal(handle.server.getState(), "ready");
    // fire a signal to trigger the graceful shutdown run() registered
    process.emit("SIGTERM");
    await wait(30);
    assert.equal(exited, 0);
    assert.equal(handle.server.getState(), "shutting-down");
  } finally {
    await stopHandle(handle);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("run() exits BUSY on a second launch in the same data dir", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-daemon-run-busy-"));
  let firstExited = null;
  let secondExited = null;
  const first = await run({
    dataDir,
    logger: createLogger({ sink: () => {} }),
    exit: (code) => {
      firstExited = code;
    },
  });
  assert.equal(first.acquired, true);
  assert.equal(firstExited, null);

  const second = await run({
    dataDir,
    logger: createLogger({ sink: () => {} }),
    exit: (code) => {
      secondExited = code;
    },
  });
  assert.equal(second.acquired, false);
  assert.equal(secondExited, 3);

  await stopHandle(first);
  rmSync(dataDir, { recursive: true, force: true });
});
