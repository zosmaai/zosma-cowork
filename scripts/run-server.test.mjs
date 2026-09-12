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