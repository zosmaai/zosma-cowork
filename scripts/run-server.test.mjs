import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { dirname } from "node:path";
import test from "node:test";
import { startSupervisor } from "./run-server.mjs";

class FakeChild extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.kills = [];
    this.exitCode = null;
  }
  kill(signal) {
    this.kills.push(signal);
    this.exitCode = 0;
    queueMicrotask(() => this.emit("exit", 0, signal));
    return true;
  }
}

function harness(overrides = {}) {
  const calls = [];
  const logs = [];
  const children = [];
  const spawnChild = (command, args, options) => {
    const child = new FakeChild(children.length === 0 ? "daemon" : "web");
    children.push(child);
    calls.push({ command, args, options });
    return child;
  };
  return {
    calls,
    logs,
    children,
    options: {
      rootDir: "/bundle",
      env: {
        ZOSMA_DAEMON_PORT: "64713",
        ZOSMA_DAEMON_TOKEN: "tok123456789",
        ZOSMA_DAEMON_DATA_DIR: "/state/daemon",
        PORT: "30141",
        PI_WEB_PASSWORD: "pwd987654321",
      },
      spawnChild,
      fetchFn: async () => ({ ok: true, status: 200 }),
      sleep: async () => {},
      log: (line) => logs.push(line),
      pathExists: () => true,
      ...overrides,
    },
  };
}

test("supervisor starts daemon before web with the bundled Node executable", async () => {
  const h = harness();
  const supervisor = await startSupervisor(h.options);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].command, process.execPath);
  assert.deepEqual(h.calls[0].args, [
    "--conditions=zosma-production",
    "--experimental-strip-types",
    "/bundle/daemon/src/index.ts",
  ]);
  assert.equal(h.calls[1].command, process.execPath);
  assert.deepEqual(h.calls[1].args, [
    "/bundle/web/dist-server/bin/pi-web.js",
    "--no-open",
    "--port", "30141",
    "--hostname", "127.0.0.1",
  ]);
  assert.equal(h.calls[0].options.env.PATH, dirname(process.execPath));
  assert.equal(h.calls[1].options.env.PATH, dirname(process.execPath));
  await supervisor.stop("SIGTERM");
  assert.deepEqual(h.children.map((child) => child.kills), [["SIGTERM"], ["SIGTERM"]]);
});

test("supervisor authenticates daemon and web readiness probes", async () => {
  const seen = [];
  const h = harness({
    fetchFn: async (url, options) => {
      seen.push({ url, options });
      return { ok: true, status: 200 };
    },
  });
  const supervisor = await startSupervisor(h.options);
  assert.equal(seen[0].url, "http://127.0.0.1:64713/health");
  assert.equal(seen[0].options.headers.authorization, "Bearer tok123456789");
  assert.equal(seen[1].url, "http://127.0.0.1:30141/api/v1/health");
  assert.equal(
    seen[1].options.headers.authorization,
    `Basic ${Buffer.from("pi:pwd987654321").toString("base64")}`,
  );
  await supervisor.stop("SIGTERM");
});

test("supervisor removes both secrets from diagnostics", async () => {
  const h = harness();
  const supervisor = await startSupervisor(h.options);
  assert.doesNotMatch(h.logs.join("\n"), /tok123|tok123456789|pwd987|pwd987654321/);
  await supervisor.stop("SIGTERM");
});

test("supervisor forwards SIGINT to both children", async () => {
  const h = harness();
  const supervisor = await startSupervisor(h.options);
  await supervisor.stop("SIGINT");
  assert.deepEqual(h.children.map((child) => child.kills), [["SIGINT"], ["SIGINT"]]);
});

test("supervisor stops the sibling after an unexpected child exit", async () => {
  const h = harness();
  const supervisor = await startSupervisor(h.options);
  h.children[1].emit("exit", 7, null);
  assert.equal(await supervisor.done, 7);
  assert.deepEqual(h.children[0].kills, ["SIGTERM"]);
});

test("supervisor aborts a stalled readiness request", async () => {
  const h = harness({
    fetchFn: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    healthTimeoutMs: 5,
  });
  await assert.rejects(startSupervisor(h.options), /daemon did not become ready/);
});

test("supervisor cleans up the daemon when web readiness times out", async () => {
  let probes = 0;
  const h = harness({
    fetchFn: async () => ({ ok: ++probes === 1, status: probes === 1 ? 200 : 503 }),
    healthTimeoutMs: 0,
  });
  await assert.rejects(startSupervisor(h.options), /web did not become ready/);
  assert.deepEqual(h.children[0].kills, ["SIGTERM"]);
  assert.deepEqual(h.children[1].kills, ["SIGTERM"]);
});

// ---------------------------------------------------------------------------
// Task 4: startup-safe signal cleanup through the direct-run seam
// ---------------------------------------------------------------------------

import { runDirect, installSignalHandlers } from "./run-server.mjs";

class StubbornChild extends FakeChild {
  kill(signal) {
    this.kills.push(signal);
    if (signal === "SIGKILL") {
      this.exitCode = 0;
      queueMicrotask(() => this.emit("exit", 0, signal));
    }
    return true;
  }
}

function blockingFetch() {
  return (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function blockingHarness(overrides = {}) {
  return harness({
    fetchFn: blockingFetch(),
    sleep: () => new Promise((r) => setTimeout(r, 10)),
    ...overrides,
  });
}

test("direct runner installs signals before startup and exits 0 for SIGINT during daemon readiness", async () => {
  const h = blockingHarness();
  let exitCode = null;
  const emitter = new EventEmitter();
  const run = runDirect({
    signalEmitter: emitter,
    setExitCode: (c) => { exitCode = c; },
    start: (opts) => startSupervisor({ ...h.options, ...opts }),
  });
  await new Promise((r) => setTimeout(r, 60));
  emitter.emit("SIGINT");
  const result = await run;
  assert.equal(result.shutdownRequested, true);
  assert.equal(exitCode, 0);
  assert.equal(h.calls.length, 1, "web child must not be spawned after shutdown");
  assert.deepEqual(h.children[0].kills, ["SIGTERM"]);
});

test("direct runner aborts web readiness on SIGTERM, stops both children, exit 0", async () => {
  const h = harness({
    fetchFn: (url, opts) => {
      if (url.endsWith("/api/v1/health")) return blockingFetch()(url, opts);
      return Promise.resolve({ ok: true, status: 200 });
    },
    sleep: () => new Promise((r) => setTimeout(r, 10)),
  });
  let exitCode = null;
  const emitter = new EventEmitter();
  const run = runDirect({
    signalEmitter: emitter,
    setExitCode: (c) => { exitCode = c; },
    start: (opts) => startSupervisor({ ...h.options, ...opts }),
  });
  await new Promise((r) => setTimeout(r, 60));
  emitter.emit("SIGTERM");
  const result = await run;
  assert.equal(result.shutdownRequested, true);
  assert.equal(exitCode, 0);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.children.map((c) => c.kills), [["SIGTERM"], ["SIGTERM"]]);
});

test("a child that ignores the first signal is escalated only after the grace period", async () => {
  const calls = [];
  const children = [];
  const spawnChild = () => {
    const child = new StubbornChild("daemon");
    children.push(child);
    calls.push(1);
    return child;
  };
  const started = Date.now();
  const supervisor = await startSupervisor({
    ...harness().options,
    spawnChild,
    fetchFn: async () => ({ ok: true, status: 200 }),
    sleep: async () => {},
    stopGraceMs: 25,
    stopObserveMs: 15,
  });
  await supervisor.stop("SIGTERM");
  const elapsed = Date.now() - started;
  assert.deepEqual(children[0].kills, ["SIGTERM", "SIGKILL"]);
  assert.ok(elapsed < 1000, `escalation took ${elapsed}ms instead of the injected bound`);
  assert.equal(await supervisor.done, 0);
});

test("signal handlers are removed after the direct run completes", async () => {
  const emitter = new EventEmitter();
  const h = harness();
  const run = runDirect({
    signalEmitter: emitter,
    setExitCode: () => {},
    start: (opts) => startSupervisor({ ...h.options, ...opts }),
  });
  await new Promise((r) => setTimeout(r, 40));
  emitter.emit("SIGTERM");
  await run;
  assert.equal(emitter.listenerCount("SIGINT"), 0);
  assert.equal(emitter.listenerCount("SIGTERM"), 0);
});

test("installSignalHandlers is usable before startup and forwards both signals", () => {
  const received = [];
  const emitter = new EventEmitter();
  const remove = installSignalHandlers({ signalEmitter: emitter, onSignal: (s) => received.push(s) });
  emitter.emit("SIGINT");
  emitter.emit("SIGTERM");
  assert.deepEqual(received, ["SIGINT", "SIGTERM"]);
  remove();
  assert.equal(emitter.listenerCount("SIGINT"), 0);
});
