import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createDaemonServer } from "./server.ts";

function req(port, opts, body) {
  return new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:${port}` + (opts.path ?? "/");
    const r = http.request(url, opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let bodyParsed = raw;
        if (raw) {
          try {
            bodyParsed = JSON.parse(raw);
          } catch {
            /* keep raw string */
          }
        }
        resolve({ status: res.statusCode ?? 0, body: bodyParsed });
      });
    });
    r.on("error", reject);
    if (body !== undefined) {
      r.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    r.end();
  });
}

const TOKEN = randomUUID();

test("health reports 503 while starting, 200 ready once ready", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    const starting = await req(port, { method: "GET", path: "/health" });
    assert.equal(starting.status, 503);
    server.setReady("ready");
    const ready = await req(port, { method: "GET", path: "/health" });
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body, { status: "ready" });
  } finally {
    await server.stop();
  }
});

test("ipc requires the token, accepts it, rejects bad payload", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    const noAuth = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: { "content-type": "application/json" },
    }, { type: "ping" });
    assert.equal(noAuth.status, 401);

    const wrong = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
    }, { type: "ping" });
    assert.equal(wrong.status, 401);

    const ok = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    }, { type: "ping" });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true, type: "ping" });

    const badType = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    }, { foo: "bar" });
    assert.equal(badType.status, 400);
    assert.equal(badType.body.error, "invalid_request");
  } finally {
    await server.stop();
  }
});

test("unknown routes return 404", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    const res = await req(port, { method: "GET", path: "/nope" });
    assert.equal(res.status, 404);
  } finally {
    await server.stop();
  }
});

test("file RPC routes over IPC and is denied with no session roots", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    // No session-root provider is wired in this test — the default provider
    // yields no roots, so every file op must be 403 by default (same gate
    // posture as the git RPCs).
    const res = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    }, { type: "files:list", cwd: "/tmp" });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "Access denied");
  } finally {
    await server.stop();
  }
});

test("pi ops are 501 when no Pi adapter is wired", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    const res = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    }, { type: "pi:health" });
    assert.equal(res.status, 501);
    assert.equal(res.body.error, "pi_adapter_not_configured");
  } finally {
    await server.stop();
  }
});

test("pi ops dispatch through the injected handler", async () => {
  const seen = [];
  const server = createDaemonServer({
    token: TOKEN,
    piRpc: async (request) => {
      seen.push(request);
      return { status: 200, body: { ready: true, sessionId: request.sessionId } };
    },
  });
  const { port } = await server.start();
  try {
    const res = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    }, { type: "pi:health", sessionId: "s9" });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.ready, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, "pi:health");
    assert.equal(seen[0].sessionId, "s9");
  } finally {
    await server.stop();
  }
});

test("binds a fixed port when configured (supervision)", async () => {
  const server = createDaemonServer({ token: TOKEN, port: 64_722 });
  const { port } = await server.start();
  try {
    assert.equal(port, 64_722);
    server.setReady("ready");
    const res = await req(port, {
      method: "GET",
      path: "/health",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
  } finally {
    await server.stop();
  }
});

test("ipc stream requires the token and 501 without a stream handler", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    const noAuth = await req(port, {
      method: "POST",
      path: "/ipc/stream",
      headers: { "content-type": "application/json" },
    }, { sessionId: "s1" });
    assert.equal(noAuth.status, 401);
    const noHandler = await req(port, {
      method: "POST",
      path: "/ipc/stream",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    }, { sessionId: "s1" });
    assert.equal(noHandler.status, 501);
    assert.equal(noHandler.body.error, "pi_adapter_not_configured");
  } finally {
    await server.stop();
  }
});

test("ipc stream writes SSE frames through the injected stream handler", async () => {
  const server = createDaemonServer({
    token: TOKEN,
    piStream: async (_request, sink) => {
      sink({ cid: "c1", seq: 1, kind: "message", payload: { text: "hi" } });
      sink({ cid: "c1", seq: 2, kind: "end", payload: {} });
      return { status: 200, body: {} };
    },
  });
  const { port } = await server.start();
  try {
    const res = await req(port, {
      method: "POST",
      path: "/ipc/stream",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    }, { sessionId: "s1", turn: { text: "hi" } });
    assert.equal(res.status, 200);
    const text = typeof res.body === "string" ? res.body : "";
    assert.match(text, /data: \{"cid":"c1","seq":1,"kind":"message"/);
    assert.match(text, /data: \{"cid":"c1","seq":2,"kind":"end"/);
  } finally {
    await server.stop();
  }
});

test("ipc stream frames handler errors as SSE error events", async () => {
  const server = createDaemonServer({
    token: TOKEN,
    piStream: async () => ({ status: 400, body: { error: "unknown session" } }),
  });
  const { port } = await server.start();
  try {
    const res = await req(port, {
      method: "POST",
      path: "/ipc/stream",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    }, { sessionId: "missing" });
    assert.equal(res.status, 200);
    const text = typeof res.body === "string" ? res.body : "";
    assert.match(text, /\"error\":\"unknown session\"/);
  } finally {
    await server.stop();
  }
});
