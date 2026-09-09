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
