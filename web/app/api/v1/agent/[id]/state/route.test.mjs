import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createV1Jiti } from "../../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(
  new URL("./route.ts", import.meta.url).href,
);
const { cacheSessionPath } = await jiti.import(
  "../../../lib/session-paths.ts",
);

const id = "state-route-test";
const oldUrl = process.env.ZOSMA_DAEMON_URL;
const oldToken = process.env.ZOSMA_DAEMON_TOKEN;

/** Answer daemon `/ipc` calls in request order. */
function stubDaemon(handlers) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const handler = handlers[i++];
    assert.ok(handler, `unexpected daemon call ${i}: ${JSON.stringify(body)}`);
    const reply = handler(body);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return () => {
    globalThis.fetch = original;
  };
}

test("GET /api/v1/agent/[id]/state reports a live agent's state", async (t) => {
  process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
  process.env.ZOSMA_DAEMON_TOKEN = "tok";
  t.after(() => {
    process.env.ZOSMA_DAEMON_URL = oldUrl;
    process.env.ZOSMA_DAEMON_TOKEN = oldToken;
    stubDaemon.restore?.();
  });
  stubDaemon.restore = stubDaemon([
    (body) => {
      assert.equal(body.type, "pi:list");
      return { body: { ok: true, sessions: [{ sessionId: id, state: "running" }] } };
    },
    (body) => {
      assert.deepEqual(body, { type: "pi:command", sessionId: id, command: { type: "get_state" } });
      return { body: { ok: true, result: { isStreaming: true } } };
    },
  ]);

  const res = await GET(
    new Request(`http://localhost/api/v1/agent/${id}/state`),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.running, true);
  assert.deepEqual(body.data.state, { isStreaming: true });
  assert.equal(body.error, undefined);
});

test("GET /api/v1/agent/[id]/state reports a cold session as running:false", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "api-v1-state-cold-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({
      type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: dir,
    })}\n${JSON.stringify({
      type: "message", id: "m1", timestamp: "2026-01-01T00:00:00.100Z",
      message: { role: "user", content: "hello" },
    })}\n`,
    );
    cacheSessionPath(id, filePath);
    process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
    process.env.ZOSMA_DAEMON_TOKEN = "tok";
    t.after(() => {
      process.env.ZOSMA_DAEMON_URL = oldUrl;
      process.env.ZOSMA_DAEMON_TOKEN = oldToken;
      stubDaemon.restore?.();
    });
    stubDaemon.restore = stubDaemon([
      (body) => {
        assert.equal(body.type, "pi:list");
        return { body: { ok: true, sessions: [] } };
      },
    ]);
    const res = await GET(
      new Request(`http://localhost/api/v1/agent/${id}/state`),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.running, false);
    assert.equal(body.error, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/v1/agent/[id]/state maps an unknown session to session_not_found 404", async (t) => {
  process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
  process.env.ZOSMA_DAEMON_TOKEN = "tok";
  t.after(() => {
    process.env.ZOSMA_DAEMON_URL = oldUrl;
    process.env.ZOSMA_DAEMON_TOKEN = oldToken;
    stubDaemon.restore?.();
  });
  stubDaemon.restore = stubDaemon([
    (body) => {
      assert.equal(body.type, "pi:list");
      return { body: { ok: true, sessions: [] } };
    },
    (body) => {
      // resolveSessionPath falls back to the relayed session list.
      assert.equal(body.type, "read:list-sessions");
      return { body: { ok: true, data: { sessions: [] } } };
    },
  ]);
  const res = await GET(
    new Request("http://localhost/api/v1/agent/nope/state"),
    { params: Promise.resolve({ id: "nope" }) },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
});