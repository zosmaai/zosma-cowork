import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../../test-helper.mjs";

const jiti = createV1Jiti();
const { POST } = await jiti.import(new URL("./route.ts", import.meta.url).href);

const oldUrl = process.env.ZOSMA_DAEMON_URL;
const oldToken = process.env.ZOSMA_DAEMON_TOKEN;

/** Stub the daemon `/ipc/stream` reply via the env/fetch seam. */
function stubDaemon(responseFactory) {
  const originalFetch = globalThis.fetch;
  process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
  process.env.ZOSMA_DAEMON_TOKEN = "tok";
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return responseFactory(seen[seen.length - 1]);
  };
  return {
    seen,
    restore() {
      globalThis.fetch = originalFetch;
      process.env.ZOSMA_DAEMON_URL = oldUrl;
      process.env.ZOSMA_DAEMON_TOKEN = oldToken;
    },
  };
}

async function collectUntil(body, needle, timeoutMs = 1500) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes(needle)) break;
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return buffer;
}

test("POST /api/v1/sessions/{id}/stream returns session_not_found 404 for a missing session", async (t) => {
  const stub = stubDaemon(() =>
    new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 }));
  t.after(stub.restore);

  const res = await POST(
    new Request("http://localhost/api/v1/sessions/ghost/stream", { method: "POST" }),
    { params: Promise.resolve({ id: "ghost" }) },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
  assert.equal(body.error.message, "Session not found");
});

test("POST aborts early with 204 when the request is already aborted", async (t) => {
  const stub = stubDaemon(() => new Response("", { status: 200 }));
  t.after(stub.restore);
  const controller = new AbortController();
  controller.abort();
  const res = await POST(
    new Request("http://localhost/api/v1/sessions/sid/stream", {
      method: "POST",
      signal: controller.signal,
    }),
    { params: Promise.resolve({ id: "sid" }) },
  );
  assert.equal(res.status, 204);
  assert.equal(stub.seen.length, 0, "no daemon call for an already-aborted request");
});

test("POST /api/v1/sessions/{id}/stream relays daemon SSE events byte-for-byte", async (t) => {
  const frames = 'data: {"type":"agent_end"}\n\n';
  const stub = stubDaemon(() =>
    new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames));
        controller.close();
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  t.after(stub.restore);

  const res = await POST(
    new Request("http://localhost/api/v1/sessions/sid/stream", { method: "POST" }),
    { params: Promise.resolve({ id: "sid" }) },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/event-stream");
  assert.deepEqual(stub.seen[0].body, { type: "pi:stream", sessionId: "sid" });

  const body = await collectUntil(res.body, '"type":"agent_end"');
  assert.match(body, /data:\s*\{"type":"agent_end"\}/);
});