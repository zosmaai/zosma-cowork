import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createCommandStore } from "./store.ts";
import { createControlPlaneServer } from "./server.ts";
import { CONTROL_HELLO, CONTROL_RPC_REQUEST, CONTROL_RPC_RESPONSE, CONTROL_ACK, CONTROL_PING, CONTROL_PONG } from "@zosma-cowork/protocol";

const TOKEN = "test-token";

async function withServer(fn) {
  const store = createCommandStore(mkdtempSync(join(tmpdir(), "cp-srv-")));
  const calls = [];
  const server = createControlPlaneServer({
    token: TOKEN,
    store,
    handleRpc: async (machineId, method, params) =>
      (calls.push({ machineId, method, params }),
        method === "echo" ? { ok: true, data: { echo: params?.value } } : { ok: false, error: { code: "method_not_found", message: `no ${method}` } }),
  });
  const { port } = await server.start(0);
  try {
    await fn({ server, port, store, calls });
  } finally {
    await server.stop();
    store.close();
    rmSync(join(tmpdir(), "cp-srv-"), { recursive: true, force: true });
  }
}

function connect(port, { token = TOKEN, hello = true, watermark = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const inbox = [];
    ws.on("open", () => {
      if (hello) ws.send(JSON.stringify({ type: CONTROL_HELLO, machineId: "m-1", name: "laptop", version: 1, watermark }));
      resolve({ ws, inbox });
    });
    ws.on("error", reject);
    ws.on("message", (raw) => inbox.push(JSON.parse(String(raw))));
  });
}
function nextFrame(inbox, tag, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const idx = inbox.findIndex((f) => f.type === tag);
      if (idx >= 0) { const f = inbox.splice(idx, 1)[0]; return resolve(f); }
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${tag}; inbox=${JSON.stringify(inbox)}`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

test("rejects a missing/wrong token (connection dies before upgrade)", async () => {
  await withServer(async ({ port }) => {
    let died = false;
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Authorization: "Bearer nope" },
      });
      const finish = () => { died = ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING; resolve(); };
      ws.on("error", finish);
      ws.on("close", finish);
      setTimeout(finish, 500);
    });
    assert.equal(died, true);
  });
});

test("registers a machine on hello", async () => {
  await withServer(async ({ server, port }) => {
    const c = await connect(port);
    await new Promise((r) => setTimeout(r, 60));
    const machines = server.machines();
    assert.deepEqual(machines, [{ machineId: "m-1", connected: true, watermark: 0 }]);
    c.ws.close();
    c.ws.terminate();
  });
});

test("push while connected delivers a server-correlated command and acks clear it", async () => {
  await withServer(async ({ server, port }) => {
    const c = await connect(port);
    const pushed = await server.push("m-1", { method: "session.start", params: { cwd: "/x" } });
    assert.ok(pushed.correlationId.length > 0);
    assert.equal(pushed.seq, 1);

    const frame = await nextFrame(c.inbox, CONTROL_RPC_REQUEST);
    assert.equal(frame.correlationId, pushed.correlationId);
    assert.equal(frame.method, "session.start");
    assert.deepEqual(frame.params, { cwd: "/x" });

    // machine acks; connection closed and reopened must NOT replay the command
    c.ws.send(JSON.stringify({ type: CONTROL_ACK, correlationId: pushed.correlationId }));
    c.ws.close();
    await new Promise((r) => setTimeout(r, 30));

    const pending = await server.store.pending("m-1");
    assert.deepEqual(pending, []);
    c.ws.terminate();
  });
});

test("offline pushes replay on reconnect at the watermark gap", async () => {
  await withServer(async ({ server, port }) => {
    const c = await connect(port);
    await new Promise((r) => setTimeout(r, 30));
    c.ws.close();
    await new Promise((r) => c.ws.on("close", r));

    const a = await server.push("m-1", { method: "a" });
    const b = await server.push("m-1", { method: "b" });

    // reconnect claiming watermark 0 → must replay both
    const c2 = await connect(port);
    const f1 = await nextFrame(c2.inbox, CONTROL_RPC_REQUEST);
    const f2 = await nextFrame(c2.inbox, CONTROL_RPC_REQUEST);
    assert.deepEqual(new Set([f1.correlationId, f2.correlationId]), new Set([a.correlationId, b.correlationId]));

    // ack both, reconnect with watermark 2 → nothing replayed (idempotent)
    for (const id of [a.correlationId, b.correlationId]) {
      c2.ws.send(JSON.stringify({ type: CONTROL_ACK, correlationId: id }));
    }
    await new Promise((r) => setTimeout(r, 30));
    c2.ws.close();
    await new Promise((r) => c2.ws.on("close", r));

    const c3 = await connect(port, { watermark: 2 });
    let dupes = 0;
    const chk = () => { if (c3.inbox.some((f) => f.type === CONTROL_RPC_REQUEST)) dupes++; };
    await new Promise((r) => setTimeout(() => { chk(); r(); }, 150));
    assert.equal(dupes, 0);
    c3.ws.close();
    c3.ws.terminate();
  });
});

test("machine-initiated rpc dispatches and answers", async () => {
  await withServer(async ({ server, port }) => {
    const c = await connect(port);
    c.ws.send(JSON.stringify({ type: CONTROL_RPC_REQUEST, correlationId: "m-c1", method: "echo", params: { value: 42 } }));
    const resp = await nextFrame(c.inbox, CONTROL_RPC_RESPONSE);
    assert.equal(resp.correlationId, "m-c1");
    assert.equal(resp.ok, true);
    assert.deepEqual(resp.data, { echo: 42 });
    c.ws.close();
    c.ws.terminate();
  });
});

test("ping is answered with pong", async () => {
  await withServer(async ({ server, port }) => {
    const c = await connect(port);
    c.ws.send(JSON.stringify({ type: CONTROL_PING }));
    const pong = await nextFrame(c.inbox, CONTROL_PONG);
    assert.deepEqual(pong, { type: CONTROL_PONG });
    c.ws.close();
    c.ws.terminate();
  });
});

test("invalid frames are ignored, not fatal", async () => {
  await withServer(async ({ server, port }) => {
    const c = await connect(port);
    c.ws.send(JSON.stringify({ type: CONTROL_HELLO, machineId: 7 })); // bad payload
    c.ws.send(JSON.stringify({ type: "cowork.v1.control.unknown" }));
    c.ws.send("not json");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(c.ws.readyState, WebSocket.OPEN); // still alive
    c.ws.close();
    c.ws.terminate();
  });
});