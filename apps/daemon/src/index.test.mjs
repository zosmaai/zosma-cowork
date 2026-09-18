import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, resolveToken, resolvePort, resolveDataDir, resolveMachineId, resolveHost, DATA_DIR } from "./index.ts";
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

import { createCommandStore, createControlPlaneServer } from "@zosma-cowork/control-plane";

async function waitFor(fn, what, timeoutMs = 8000) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await wait(25);
  }
}

function waitForReply(port, token, correlationId) {
  return waitFor(async () => {
    const resp = await fetch(`http://127.0.0.1:${port}/machines/m-fleet-1/commands/${correlationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status !== 200) return false;
    const body = await resp.json();
    return body.reply !== undefined ? body.reply : false;
  }, `reply for ${correlationId}`);
}

test("resolveDataDir prefers env, else the default data dir", () => {
  assert.equal(resolveDataDir({ ZOSMA_DAEMON_DATA_DIR: "/x/y" }), "/x/y");
  assert.equal(resolveDataDir({}), DATA_DIR);
});

test("resolveHost prefers env, else loopback", () => {
  assert.equal(resolveHost({ ZOSMA_DAEMON_HOST: "0.0.0.0" }), "0.0.0.0");
  assert.equal(resolveHost({}), "127.0.0.1");
});

test("resolveMachineId prefers env, else persists a stable id", () => {
  const dir = mkdtempSync(join(tmpdir(), "zosma-daemon-mid-"));
  assert.equal(resolveMachineId(dir, { ZOSMA_MACHINE_ID: "env-machine" }), "env-machine");
  const a = resolveMachineId(dir, {});
  const b = resolveMachineId(dir, {});
  assert.equal(a, b);
  assert.ok(a.length > 4);
  rmSync(dir, { recursive: true, force: true });
});

test("run() wires the outbound control-plane connector when ZOSMA_CONTROL_PLANE_URL is set", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-daemon-cp-"));
  const cpDir = mkdtempSync(join(tmpdir(), "zosma-daemon-cpd-"));
  const cpStore = createCommandStore(cpDir);
  const cpToken = "cp-token";
  const cpServer = createControlPlaneServer({ token: cpToken, store: cpStore });
  const { port: cpPort } = await cpServer.start(0);
  const saved = { url: process.env.ZOSMA_CONTROL_PLANE_URL, tok: process.env.ZOSMA_CONTROL_PLANE_TOKEN, id: process.env.ZOSMA_MACHINE_ID };
  process.env.ZOSMA_CONTROL_PLANE_URL = `ws://127.0.0.1:${cpPort}/ws`;
  process.env.ZOSMA_CONTROL_PLANE_TOKEN = cpToken;
  process.env.ZOSMA_MACHINE_ID = "m-fleet-1";
  const handle = await run({ dataDir, logger: createLogger({ sink: () => {} }), exit: () => {} });
  try {
    assert.equal(handle.acquired, true);
    // 1. registers the machine on hello
    await waitFor(() => cpServer.machines().some((m) => m.machineId === "m-fleet-1" && m.connected), "machine registration");
    // 2. operator REST push executes on the daemon and the reply is readable
    const pushedResponse = await fetch(`http://127.0.0.1:${cpPort}/machines/m-fleet-1/commands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cpToken}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "pi:health" }),
    });
    assert.equal(pushedResponse.status, 200);
    const pushed = await pushedResponse.json();
    const reply = await waitForReply(cpPort, cpToken, pushed.correlationId);
    assert.equal(reply.ok, true);
    // 3. daemon errors map to an explicit failure reply
    const bad = await cpServer.push("m-fleet-1", { method: "nope:op" });
    const badReply = await waitForReply(cpPort, cpToken, bad.correlationId);
    assert.equal(badReply.ok, false);
    assert.equal(typeof badReply.error?.message, "string");
    // 4. daemon shutdown tears the connector down
    process.emit("SIGTERM");
    await waitFor(() => !cpServer.machines().some((m) => m.machineId === "m-fleet-1" && m.connected), "connector disconnect");
  } finally {
    process.env.ZOSMA_CONTROL_PLANE_URL = saved.url;
    process.env.ZOSMA_CONTROL_PLANE_TOKEN = saved.tok;
    process.env.ZOSMA_MACHINE_ID = saved.id;
    await stopHandle(handle);
    await cpServer.stop();
    cpStore.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(cpDir, { recursive: true, force: true });
  }
});

test("run() without ZOSMA_CONTROL_PLANE_URL stays off the control plane", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-daemon-cpoff-"));
  const cpDir = mkdtempSync(join(tmpdir(), "zosma-daemon-cpdoff-"));
  const cpStore = createCommandStore(cpDir);
  const cpServer = createControlPlaneServer({ token: "cp-token", store: cpStore });
  const { port: cpPort } = await cpServer.start(0);
  const saved = { url: process.env.ZOSMA_CONTROL_PLANE_URL, tok: process.env.ZOSMA_CONTROL_PLANE_TOKEN };
  delete process.env.ZOSMA_CONTROL_PLANE_URL;
  delete process.env.ZOSMA_CONTROL_PLANE_TOKEN;
  const handle = await run({ dataDir, logger: createLogger({ sink: () => {} }), exit: () => {} });
  try {
    assert.equal(handle.acquired, true);
    await wait(250);
    assert.deepEqual(cpServer.machines(), []);
  } finally {
    if (saved.url === undefined) delete process.env.ZOSMA_CONTROL_PLANE_URL; else process.env.ZOSMA_CONTROL_PLANE_URL = saved.url;
    if (saved.tok === undefined) delete process.env.ZOSMA_CONTROL_PLANE_TOKEN; else process.env.ZOSMA_CONTROL_PLANE_TOKEN = saved.tok;
    await stopHandle(handle);
    await cpServer.stop();
    cpStore.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(cpDir, { recursive: true, force: true });
  }
});

// --- ZOS-91 end to end: identity + capability manifest + revocation ---

/** Boot a plane + daemon(s) for one ZOS-91 scenario, with REST helpers. */
async function withFleet(fn, env = {}) {
  const cpDir = mkdtempSync(join(tmpdir(), "zosma-e2e-cp-"));
  const cpStore = createCommandStore(cpDir);
  const cpToken = "cp-e2e";
  const cpServer = createControlPlaneServer({ token: cpToken, store: cpStore });
  const { port: cpPort } = await cpServer.start(0);
  // Save/restore every ZOS-91 env key so a scenario cannot leak into the next test.
  const keys = ["ZOSMA_CONTROL_PLANE_URL", "ZOSMA_CONTROL_PLANE_TOKEN", "ZOSMA_MACHINE_ID", "ZOSMA_MACHINE_ID_RESET", "ZOSMA_MACHINE_NAME"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.ZOSMA_CONTROL_PLANE_URL = `ws://127.0.0.1:${cpPort}/ws`;
  process.env.ZOSMA_CONTROL_PLANE_TOKEN = cpToken;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const auth = { Authorization: `Bearer ${cpToken}`, "content-type": "application/json" };
  const machines = async () => (await (await fetch(`http://127.0.0.1:${cpPort}/machines`, { headers: auth })).json()).machines;
  const handles = [];
  const start = async (dataDir) => {
    const h = await run({ dataDir, logger: createLogger({ sink: () => {} }), exit: () => {} });
    handles.push(h);
    return h;
  };
  // stopHandle alone leaves the outbound connector running (it is torn down by
  // the daemon's signal path), so a scenario that must go offline says so.
  const shutdown = async (h) => {
    process.emit("SIGTERM");
    await waitFor(() => h.server.getState() === "shutting-down", "daemon shutdown");
    await stopHandle(h);
  };
  try {
    await fn({ cpServer, cpPort, cpStore, cpToken, auth, machines, start, shutdown, stopHandle });
  } finally {
    for (const h of handles) await stopHandle(h);
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await cpServer.stop();
    cpStore.close();
    rmSync(cpDir, { recursive: true, force: true });
  }
}

test("ZOS-91: manifest registers, re-register is idempotent, revoke is terminal, reset recovers", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-e2e-daemon-"));
  await withFleet(
    async ({ machines, start, shutdown, auth, cpPort, cpServer }) => {
      // 1. registers with a capability manifest
      const a = await start(dataDir);
      assert.equal(a.acquired, true);
      await waitFor(async () => (await machines()).some((m) => m.machineId === "m-e2e-1" && m.connected), "registration");
      const [rec] = await machines();
      assert.equal(rec.manifest.manifestVersion, 1);
      assert.ok(rec.manifest.services.includes("pi:prompt"), "pi surface advertised");
      assert.deepEqual(rec.manifest.adapters.map((x) => x.id), ["pi"]);
      assert.equal(rec.manifest.platform, process.platform);
      assert.equal(rec.name, rec.manifest.hostname);
      const firstSeenAt = rec.firstSeenAt;

      // 2. an offline machine stays in the registry; a restart re-registers once
      await shutdown(a);
      await waitFor(async () => !(await machines())[0]?.connected, "disconnect");
      assert.equal((await machines()).length, 1, "durable record survives the disconnect");
      const b = await start(dataDir);
      await waitFor(async () => (await machines()).some((m) => m.machineId === "m-e2e-1" && m.connected), "re-registration");
      const after = await machines();
      assert.equal(after.length, 1, "idempotent — still one record");
      assert.equal(after[0].firstSeenAt, firstSeenAt, "identity is stable across restarts");

      // 3. revoke: gone from the registry, and the connector does NOT come back
      const revoked = await fetch(`http://127.0.0.1:${cpPort}/machines/m-e2e-1`, { method: "DELETE", headers: auth });
      assert.equal(revoked.status, 200);
      await waitFor(async () => (await machines()).length === 0, "revoked machine leaves the registry");
      assert.equal(cpServer.store.isRevoked("m-e2e-1"), true);
      await wait(500); // several reconnect backoff windows
      assert.deepEqual(await machines(), [], "a revoked machine must not re-register");

      // 4. identity reset registers a new machine id (the machine's own remedy)
      await shutdown(b);
      process.env.ZOSMA_MACHINE_ID = "m-e2e-2";
      process.env.ZOSMA_MACHINE_ID_RESET = "1";
      await start(dataDir);
      await waitFor(async () => (await machines()).some((m) => m.machineId === "m-e2e-2" && m.connected), "reset identity registered");
    },
    { ZOSMA_MACHINE_ID: "m-e2e-1" },
  );
  rmSync(dataDir, { recursive: true, force: true });
});

test("ZOS-91: a duplicate machine id cannot hijack a live registration", async () => {
  const d1 = mkdtempSync(join(tmpdir(), "zosma-e2e-dup1-"));
  const d2 = mkdtempSync(join(tmpdir(), "zosma-e2e-dup2-"));
  await withFleet(
    async ({ machines, start }) => {
      await start(d1);
      await waitFor(async () => (await machines()).some((m) => m.machineId === "m-dup" && m.connected), "first registration");
      await start(d2); // same id from a second daemon
      await wait(400);
      const dupes = (await machines()).filter((m) => m.machineId === "m-dup");
      assert.equal(dupes.length, 1, "one registry record");
      assert.equal(dupes[0].connected, true, "exactly one live connection");
    },
    { ZOSMA_MACHINE_ID: "m-dup" },
  );
  rmSync(d1, { recursive: true, force: true });
  rmSync(d2, { recursive: true, force: true });
});

test("run() warns instead of silently running single-host when fleet wiring is half-configured", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-daemon-cphalf-"));
  const saved = { url: process.env.ZOSMA_CONTROL_PLANE_URL, tok: process.env.ZOSMA_CONTROL_PLANE_TOKEN, id: process.env.ZOSMA_MACHINE_ID };
  const lines = [];
  // Token + machine id present, URL missing: the daemon used to stay silent and
  // run single-host, which is invisible inside a container.
  delete process.env.ZOSMA_CONTROL_PLANE_URL;
  process.env.ZOSMA_CONTROL_PLANE_TOKEN = "cp-token";
  process.env.ZOSMA_MACHINE_ID = "m-half-1";
  const handle = await run({ dataDir, logger: createLogger({ sink: (l) => lines.push(l) }), exit: () => {} });
  try {
    const warned = lines.some((l) => l.includes("ZOSMA_CONTROL_PLANE_URL") && /warn/i.test(l));
    assert.ok(warned, `expected a warning naming ZOSMA_CONTROL_PLANE_URL; got:\n${lines.join("\n")}`);
  } finally {
    await handle.server?.stop();
    handle.instance?.release();
    if (saved.url === undefined) delete process.env.ZOSMA_CONTROL_PLANE_URL; else process.env.ZOSMA_CONTROL_PLANE_URL = saved.url;
    if (saved.tok === undefined) delete process.env.ZOSMA_CONTROL_PLANE_TOKEN; else process.env.ZOSMA_CONTROL_PLANE_TOKEN = saved.tok;
    if (saved.id === undefined) delete process.env.ZOSMA_MACHINE_ID; else process.env.ZOSMA_MACHINE_ID = saved.id;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
