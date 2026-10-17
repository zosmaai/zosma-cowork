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

function connect(port, { token = TOKEN, hello = true, watermark = 0, machineId = "m-1", name = "laptop", manifest } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const inbox = [];
    const closed = new Promise((res) => ws.on("close", (code, reason) => res({ code, reason: String(reason) })));
    ws.on("open", () => {
      if (hello) ws.send(JSON.stringify({ type: CONTROL_HELLO, machineId, name, version: 1, watermark, ...(manifest ? { manifest } : {}) }));
      resolve({ ws, inbox, closed });
    });
    ws.on("error", reject);
    ws.on("message", (raw) => inbox.push(JSON.parse(String(raw))));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = { Authorization: `Bearer ${TOKEN}` };
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

test("registers a machine on hello with its identity in the registry", async () => {
  await withServer(async ({ server, port }) => {
    const c = await connect(port);
    await sleep(60);
    const [m] = server.machines();
    assert.equal(m.machineId, "m-1");
    assert.equal(m.connected, true);
    assert.equal(m.watermark, 0);
    assert.equal(m.name, "laptop");
    assert.equal(m.revoked, false);
    assert.ok(!Number.isNaN(Date.parse(m.firstSeenAt)));
    c.ws.close();
    c.ws.terminate();
  });
});

// --- ZOS-91: manifest, duplicate guard, revocation ---

test("the hello manifest is stored durably and served over REST", async () => {
  await withServer(async ({ port }) => {
    const manifest = { manifestVersion: 1, platform: "darwin", arch: "arm64", services: ["pi:prompt", "read:capabilities"], adapters: [{ id: "pi", capabilities: [{ name: "streaming", version: 1 }] }] };
    const c = await connect(port, { manifest });
    await sleep(60);
    const body = await (await fetch(`http://127.0.0.1:${port}/machines`, { headers: auth })).json();
    assert.equal(body.machines.length, 1);
    assert.equal(body.machines[0].manifest.manifestVersion, 1);
    assert.equal(body.machines[0].manifest.platform, "darwin");
    assert.deepEqual(body.machines[0].manifest.services, ["pi:prompt", "read:capabilities"]);
    c.ws.close();
    c.ws.terminate();
  });
});

test("deleting a machine revokes it and drops the live connection", async () => {
  await withServer(async ({ server, port, store }) => {
    const c = await connect(port);
    await sleep(60);
    const resp = await fetch(`http://127.0.0.1:${port}/machines/m-1`, { method: "DELETE", headers: auth });
    assert.equal(resp.status, 200);
    const { code } = await c.closed;
    assert.equal(code, 4003, "live socket closed with the revoked code");
    await sleep(30);
    assert.deepEqual(server.machines(), []);
    assert.equal(store.isRevoked("m-1"), true);
    const unknown = await fetch(`http://127.0.0.1:${port}/machines/nope`, { method: "DELETE", headers: auth });
    assert.equal(unknown.status, 404);
  });
});

test("a revoked machine cannot re-register until it is re-admitted", async () => {
  await withServer(async ({ server, port, store }) => {
    const c = await connect(port);
    await sleep(60);
    await fetch(`http://127.0.0.1:${port}/machines/m-1`, { method: "DELETE", headers: auth });
    await c.closed;

    // a fresh connection with the revoked id is refused and never registered
    const denied = await connect(port);
    const { code } = await denied.closed;
    assert.equal(code, 4003);
    await sleep(30);
    assert.deepEqual(server.machines(), []);

    // operator re-admits the machine
    const readmit = await fetch(`http://127.0.0.1:${port}/machines/m-1/register`, { method: "POST", headers: auth });
    assert.equal(readmit.status, 200);
    assert.equal(store.isRevoked("m-1"), false);

    const back = await connect(port);
    await sleep(60);
    assert.equal(server.machines()[0]?.machineId, "m-1");
    back.ws.close();
    back.ws.terminate();
  });
});

test("a second live connection claiming a registered machine id is refused with 4004", async () => {
  await withServer(async ({ server, port }) => {
    const first = await connect(port);
    await sleep(60);
    const second = await connect(port);
    const { code } = await second.closed;
    assert.equal(code, 4004, "duplicate machine id refused, not silently adopted");
    await sleep(30);
    const machines = server.machines();
    assert.equal(machines.length, 1);
    assert.equal(machines[0].connected, true, "the original connection is untouched");
    first.ws.close();
    first.ws.terminate();
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

test("a delivered reply is not re-executed when its ack is lost", async () => {
  await withServer(async ({ server, port, store }) => {
    const c = await connect(port);
    await new Promise((r) => setTimeout(r, 30));

    const pushed = await server.push("m-1", { method: "pi:prompt", params: { text: "hi" } });
    const frame = await nextFrame(c.inbox, CONTROL_RPC_REQUEST);
    assert.equal(frame.correlationId, pushed.correlationId);

    // The machine runs the command and replies, but the socket dies before its
    // ack lands. The reply is durable, so a replay would run the handler twice.
    c.ws.send(JSON.stringify({ type: CONTROL_RPC_RESPONSE, correlationId: pushed.correlationId, ok: true, data: { ran: true } }));
    await new Promise((r) => setTimeout(r, 40));
    c.ws.terminate();
    await new Promise((r) => setTimeout(r, 30));

    assert.deepEqual(await store.reply(pushed.correlationId), { ok: true, data: { ran: true } }, "reply is durable for the operator");
    assert.deepEqual((await store.pending("m-1")).map((c) => c.correlationId), [pushed.correlationId], "still unacked, hence still pending");

    const c2 = await connect(port);
    await new Promise((r) => setTimeout(r, 200));
    const replayed = c2.inbox.filter((f) => f.type === CONTROL_RPC_REQUEST);
    assert.deepEqual(replayed, [], "answered command must not be replayed (no duplicate side effects)");
    c2.ws.terminate();
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

test("binds to the configured host (docker 0.0.0.0) and reports it", async () => {
  const store = createCommandStore(mkdtempSync(join(tmpdir(), "cp-host-")));
  const server = createControlPlaneServer({ token: TOKEN, store });
  try {
    const { port, host } = await server.start(0, "0.0.0.0");
    assert.equal(host, "0.0.0.0");
    const resp = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(resp.status, 200);
  } finally {
    await server.stop();
    store.close();
  }
});

test("defaults to loopback bind when no host given", async () => {
  const store = createCommandStore(mkdtempSync(join(tmpdir(), "cp-host-")));
  const server = createControlPlaneServer({ token: TOKEN, store });
  try {
    const { host } = await server.start(0);
    assert.equal(host, "127.0.0.1");
  } finally {
    await server.stop();
    store.close();
  }
});
test("machine reply to a pushed command is stored and readable via REST", async () => {
  await withServer(async ({ server, port, store }) => {
    const c = await connect(port);
    const pushed = await server.push("m-1", { method: "pi:health" });
    const req = await nextFrame(c.inbox, CONTROL_RPC_REQUEST);
    assert.equal(req.correlationId, pushed.correlationId);
    c.ws.send(JSON.stringify({ type: CONTROL_RPC_RESPONSE, correlationId: pushed.correlationId, ok: true, data: { status: "ready" } }));
    c.ws.send(JSON.stringify({ type: CONTROL_ACK, correlationId: pushed.correlationId }));
    await new Promise((r) => setTimeout(r, 50));

    const resp = await fetch(`http://127.0.0.1:${port}/machines/m-1/commands/${pushed.correlationId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.command.method, "pi:health");
    assert.deepEqual(body.reply, { ok: true, data: { status: "ready" } });
    // error replies are stored too
    const pushed2 = await server.push("m-1", { method: "pi:prompt" });
    const req2 = await nextFrame(c.inbox, CONTROL_RPC_REQUEST);
    c.ws.send(JSON.stringify({ type: CONTROL_RPC_RESPONSE, correlationId: req2.correlationId, ok: false, error: { code: "cmd_failed", message: "busy" } }));
    await new Promise((r) => setTimeout(r, 50));
    const body2 = await (await fetch(`http://127.0.0.1:${port}/machines/m-1/commands/${req2.correlationId}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    assert.deepEqual(body2.reply, { ok: false, error: { code: "cmd_failed", message: "busy" } });
    c.ws.close();
    c.ws.terminate();
  });
});

test("reading an unknown correlation id is 404", async () => {
  await withServer(async ({ port }) => {
    const c = await connect(port);
    const resp = await fetch(`http://127.0.0.1:${port}/machines/m-1/commands/unknown-id`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(resp.status, 404);
    c.ws.close();
    c.ws.terminate();
  });
});
