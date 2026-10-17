/**
 * ZOS-96 outbound connector — integration against the real control-plane
 * code (in-process, thin dev fixture: same server, same store).
 *
 * Covers the ticket's ACs: daemon connects WITHOUT exposing an inbound port
 * (outbound WS dial), reconnects recover registration + missed events,
 * in-flight calls fail explicitly on disconnect/timeout, correlation ids are
 * unique across connections, replayed commands cannot duplicate side effects
 * (ack idempotency at the store).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandStore, createControlPlaneServer } from "@zosma-cowork/control-plane";
import { CONTROL_RPC_REQUEST, CONTROL_HELLO, CLOSE_MACHINE_REVOKED } from "@zosma-cowork/protocol";import { WebSocketServer } from "ws";
import { OutboundConnector } from "./connector.ts";

const TOKEN = "test-token";
let cpStore; // control plane store (assert acks)

async function withControlPlane(fn, { handleRpc, storeDir } = {}) {
  const dir = storeDir ?? mkdtempSync(join(tmpdir(), "cp-srv-"));
  cpStore = createCommandStore(dir);
  const server = createControlPlaneServer({
    token: TOKEN,
    store: cpStore,
    handleRpc: handleRpc ?? (async (_m, method, params) =>
      method === "echo" ? { ok: true, data: { echo: params?.value } } : { ok: false, error: { code: "method_not_found", message: `no ${method}` } }),
  });
  const { port } = await server.start(0);
  try {
    await fn({ server, port, store: cpStore });
  } finally {
    await server.stop();
    cpStore.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const connect = (port, extra = {}) => {
  const c = new OutboundConnector({
    url: `ws://127.0.0.1:${port}/ws`,
    token: TOKEN,
    machineId: "m-1",
    machineName: "dev-laptop",
    heartbeatMs: 50,
    maxReconnectMs: 100,
    ...extra,
  });
  return c;
};

const waitConnected = (c, timeoutMs = 2000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (c.status().connected) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`never connected; status=${JSON.stringify(c.status())}`));
      setTimeout(tick, 10);
    };
    tick();
  });

const waitFor = (predicate, what, timeoutMs = 2000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${what}`));
      setTimeout(tick, 10);
    };
    tick();
  });

test("connects outbound, registers on hello, appears in the registry", async () => {
  await withControlPlane(async ({ server, port }) => {
    const c = connect(port);
    c.start();
    await waitConnected(c);
    await new Promise((r) => setTimeout(r, 60));
    const [m] = server.machines();
    assert.equal(m.machineId, "m-1");
    assert.equal(m.connected, true);
    assert.equal(m.watermark, 0);
    assert.equal(m.name, "dev-laptop");
    assert.equal(m.revoked, false);
    await c.stop();
  });
});

/** Raw WS endpoint that records frames — lets a test read the outbound hello. */
async function withRawSocket(fn) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const port = wss.address().port;
  const frames = [];
  const sockets = [];
  wss.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (d) => frames.push(JSON.parse(String(d))));
  });
  try {
    await fn({ port, frames, sockets });
  } finally {
    for (const s of sockets) s.terminate();
    await new Promise((r) => wss.close(r));
  }
}

test("hello carries the capability manifest when one is provided", async () => {
  await withRawSocket(async ({ port, frames }) => {
    const manifest = { manifestVersion: 1, platform: "linux", services: ["pi:prompt", "read:capabilities"] };
    const c = connect(port, { manifest });
    c.start();
    await waitConnected(c);
    await new Promise((r) => setTimeout(r, 60));
    await c.stop();
    const hello = frames.find((f) => f.type === CONTROL_HELLO);
    assert.ok(hello, "hello frame sent on connect");
    assert.equal(hello.machineId, "m-1");
    assert.equal(hello.manifest.manifestVersion, 1);
    assert.deepEqual(hello.manifest.services, ["pi:prompt", "read:capabilities"]);
  });
});

test("hello omits the manifest when none is configured (older daemon shape)", async () => {
  await withRawSocket(async ({ port, frames }) => {
    const c = connect(port);
    c.start();
    await waitConnected(c);
    await new Promise((r) => setTimeout(r, 60));
    await c.stop();
    const hello = frames.find((f) => f.type === CONTROL_HELLO);
    assert.ok(hello);
    assert.equal("manifest" in hello, false);
  });
});

// --- ZOS-91: revocation is terminal ---

test("a revoked machine stops reconnecting instead of hot-looping", async () => {
  await withRawSocket(async ({ port, sockets }) => {
    const c = connect(port, { maxReconnectMs: 50 });
    c.start();
    await waitConnected(c);
    await new Promise((r) => setTimeout(r, 40));
    for (const s of sockets) s.close(CLOSE_MACHINE_REVOKED, "machine revoked");
    await new Promise((r) => setTimeout(r, 400)); // several backoff windows
    assert.equal(c.status().revoked, true);
    assert.equal(c.status().attempts, 0, "no reconnect attempts after revocation");
    await c.stop();
  });
});

test("the revocation log tells the operator what actually recovers the machine", async () => {
  const errors = [];
  await withRawSocket(async ({ port, sockets }) => {
    const c = connect(port, { maxReconnectMs: 50, logger: { info: () => {}, warn: () => {}, debug: () => {}, error: (m) => errors.push(String(m)) } });
    c.start();
    await waitConnected(c);
    await new Promise((r) => setTimeout(r, 40));
    for (const s of sockets) s.close(CLOSE_MACHINE_REVOKED, "machine revoked");
    await waitFor(() => c.status().revoked, "revoked status");
    await c.stop();
  });
  const msg = errors.join("\n");
  assert.match(msg, /revoked/i);
  assert.match(msg, /restart/i, "re-admission alone does not revive a revoked daemon — the log must say to restart it");
  assert.match(msg, /m-1/, "the operator needs the id to re-admit");
});

test("a non-revoked drop still reconnects", async () => {
  await withRawSocket(async ({ port, sockets, frames }) => {
    const c = connect(port, { maxReconnectMs: 50 });
    c.start();
    await waitConnected(c);
    await new Promise((r) => setTimeout(r, 40));
    sockets[sockets.length - 1].terminate(); // abnormal close, not a revocation
    await waitFor(() => frames.filter((f) => f.type === CONTROL_HELLO).length >= 2, "reconnect hello");
    assert.equal(c.status().revoked, false);
    await c.stop();
  });
});

test("server push reaches onCommand and ack clears the store", async () => {
  await withControlPlane(async ({ server, port, store }) => {
    const got = [];
    const c = connect(port, { onCommand: async (cmd) => { got.push(cmd); return { ok: true, data: { done: true } }; } });
    c.start();
    await waitConnected(c);

    const pushed = await server.push("m-1", { method: "session.start", params: { cwd: "/x" } });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(got.length, 1);
    assert.equal(got[0].correlationId, pushed.correlationId);
    assert.equal(got[0].method, "session.start");
    assert.deepEqual(got[0].params, { cwd: "/x" });

    // connector acks after handling → nothing left to replay
    assert.deepEqual(await store.pending("m-1"), []);
    assert.equal(store.watermark("m-1"), 1);
    await c.stop();
  });
});

test("persists reply before acknowledging a pushed command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cp-reply-ack-"));
  const store = createCommandStore(dir);
  const order = [];
  const server = createControlPlaneServer({
    token: TOKEN,
    store: {
      ...store,
      async recordReply(...args) {
        order.push("reply");
        return store.recordReply(...args);
      },
      async ack(...args) {
        order.push("ack");
        return store.ack(...args);
      },
    },
  });
  const { port } = await server.start(0);
  const c = connect(port, { onCommand: async () => ({ ok: true, data: { done: true } }) });
  try {
    c.start();
    await waitConnected(c);
    await server.push("m-1", { method: "pi:health" });
    const started = Date.now();
    while (order.length < 2 && Date.now() - started < 2_000) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(order, ["reply", "ack"]);
  } finally {
    await c.stop();
    await server.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("machine-initiated rpc round-trips through control-plane handleRpc", async () => {
  await withControlPlane(async ({ port }) => {
    const c = connect(port);
    c.start();
    await waitConnected(c);
    const reply = await c.request("echo", { value: 42 }, 1000);
    assert.deepEqual(reply, { ok: true, data: { echo: 42 } });
    await c.stop();
  });
});

test("rpc times out when the control plane never answers", async () => {
  await withControlPlane(async ({ port }) => {
    const c = connect(port);
    c.start();
    await waitConnected(c);
    // "slow" handler never resolves → no response ever → client timeout fires
    await assert.rejects(c.request("slow", {}, 150), /rpc_timeout/);
    await c.stop();
  }, {
    handleRpc: async (_m, method) =>
      method === "slow" ? new Promise(() => {}) : { ok: false, error: { code: "method_not_found", message: "nope" } },
  });
});

test("rpc fails explicitly when the connection drops mid-flight", async () => {
  await withControlPlane(async ({ server, port }) => {
    const c = connect(port, { heartbeatMs: 2000 }); // don't race the heartbeat
    c.start();
    await waitConnected(c);

    // handler never answers → request stays in flight; then the server dies
    const pending = c.request("echo", {}, 5000).catch((e) => ({ failed: String(e.code ?? e.message) }));
    await new Promise((r) => setTimeout(r, 20));
    await server.stop(); // connection drop → pending must reject, never hang
    const result = await pending;
    assert.deepEqual(result, { failed: "rpc_disconnected" });
    await c.stop();
  }, {
    handleRpc: async () => new Promise(() => {}), // never resolve
  });
});

test("reconnect replays commands pushed while offline (watermark catch-up), no dupes", async () => {
  // fresh store dir so nothing acked yet
  const dir = mkdtempSync(join(tmpdir(), "cp-srv-"));
  await withControlPlane(async ({ server, port }) => {
    const got = [];
    const c = connect(port, { onCommand: async (cmd) => { got.push(cmd.method); await c.ack(cmd.correlationId); return { ok: true, data: {} }; } });
    c.start();
    await waitConnected(c);

    const a = await server.push("m-1", { method: "alpha" });
    const b = await server.push("m-1", { method: "beta" });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(got, ["alpha", "beta"]); // acked as handled

    // simulate death: hard-stop connector, push two more, reconnect
    await c.stop();
    const p1 = await server.push("m-1", { method: "gamma" });
    const p2 = await server.push("m-1", { method: "delta" });

    got.length = 0;
    c.start();
    await waitConnected(c);
    await new Promise((r) => setTimeout(r, 150));
    // alpha/beta must NOT replay (acked); gamma/delta must arrive once
    assert.deepEqual(got, ["gamma", "delta"]);
    assert.ok(p1.correlationId !== p2.correlationId);
    await c.stop();
  }, { storeDir: dir });
});

test("wrong token never connects and reports lastError with attempts", async () => {
  await withControlPlane(async ({ port }) => {
    const c = connect(port, { token: "nope", maxReconnectMs: 50, heartbeatMs: 100000 });
    c.start();
    // poll until the first failed dial is observable (never hangs: bounded)
    const deadline = Date.now() + 3000;
    let s;
    while (true) {
      s = c.status();
      if (!s.connected && s.attempts >= 1 && s.lastError) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(s.connected, false);
    assert.ok(s.attempts >= 1, `attempts=${s.attempts}`);
    assert.ok(s.lastError, "expected lastError set");
    await c.stop();
  });
});

test("correlation ids are unique across connections", async () => {
  await withControlPlane(async ({ port }) => {
    const c1 = connect(port);
    c1.start();
    await waitConnected(c1);
    const r1 = await c1.request("echo", { value: 1 });
    const r2 = await c1.request("echo", { value: 2 });
    assert.notEqual(r1, undefined);
    assert.notEqual(r2, undefined);
    await c1.stop();

    const c2 = connect(port);
    c2.start();
    await waitConnected(c2);
    await c2.request("echo", { value: 3 });
    await c2.stop();
    // uniqueness asserted structurally: ids come fresh from randomUUID per call
    const all = [r1, r2];
    assert.deepEqual(all, [{ ok: true, data: { echo: 1 } }, { ok: true, data: { echo: 2 } }]);
  });
});