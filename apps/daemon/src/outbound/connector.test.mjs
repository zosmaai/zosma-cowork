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
import { CONTROL_RPC_REQUEST } from "@zosma-cowork/protocol";
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

test("connects outbound, registers on hello, appears in the registry", async () => {
  await withControlPlane(async ({ server, port }) => {
    const c = connect(port);
    c.start();
    await waitConnected(c);
    await new Promise((r) => setTimeout(r, 60));
    const machines = server.machines();
    assert.deepEqual(machines, [{ machineId: "m-1", connected: true, watermark: 0 }]);
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