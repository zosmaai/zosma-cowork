import { test } from "node:test";
import assert from "node:assert/strict";
import { createShutdown } from "./signal.ts";

test("runs onShutdown and exits 0 on SIGTERM", async () => {
  let exited = null;
  let ran = false;
  const shutdown = createShutdown({
    signals: ["SIGTERM"],
    exit: (code) => {
      exited = code;
    },
    onShutdown: async () => {
      ran = true;
    },
  });
  shutdown.register();
  process.emit("SIGTERM");
  await new Promise((r) => setTimeout(r, 20));
  shutdown.unregister();
  assert.equal(ran, true);
  assert.equal(exited, 0);
});

test("exits non-zero when shutdown throws", async () => {
  let exited = null;
  const shutdown = createShutdown({
    signals: ["SIGINT"],
    exit: (code) => {
      exited = code;
    },
    onShutdown: async () => {
      throw new Error("cleanup failed");
    },
  });
  shutdown.register();
  process.emit("SIGINT");
  await new Promise((r) => setTimeout(r, 20));
  shutdown.unregister();
  assert.equal(exited, 1);
});

test("second signal is ignored (single pass)", async () => {
  let calls = 0;
  let exited = null;
  const shutdown = createShutdown({
    signals: ["SIGTERM"],
    exit: (code) => {
      exited = code;
      calls += 1;
    },
  });
  shutdown.register();
  process.emit("SIGTERM");
  process.emit("SIGTERM");
  await new Promise((r) => setTimeout(r, 20));
  shutdown.unregister();
  assert.equal(calls, 1);
  assert.equal(exited, 0);
});
