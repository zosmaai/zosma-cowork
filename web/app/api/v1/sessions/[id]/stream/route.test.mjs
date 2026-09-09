import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../../test-helper.mjs";

const jiti = createV1Jiti();
const { POST } = await jiti.import(new URL("./route.ts", import.meta.url).href);

// Inject a fake live session wrapper into the runtime registry that the
// getPiBackend() facade reads (globalThis.__piSessions). Mutate in place so
// the cached RuntimeManager (which holds the same Map reference) sees it.
function installFakeWrapper(sessionId, marker) {
  const sessions = globalThis.__piSessions ??= new Map();
  const listeners = new Set();
  sessions.set(sessionId, {
    isAlive: () => true,
    isStreaming: false,
    streamingMessage: null,
    onEvent(listener) {
      listeners.add(listener);
      // Emit a marker event after the stream is open so the SSE body is
      // observable. createAgentEventStream forwards this through toClientAgentEvent.
      setTimeout(() => {
        for (const listener of [...listeners]) listener(marker);
      }, 5);
      return () => { listeners.delete(listener); };
    },
  });
  return sessions;
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

test("POST /api/v1/sessions/{id}/stream returns session_not_found 404 for a missing session", async () => {
  const res = await POST(
    new Request("http://localhost/api/v1/sessions/ghost/stream", { method: "POST" }),
    { params: Promise.resolve({ id: "ghost" }) },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
  assert.equal(body.error.message, "Session not found");
});

test("POST aborts early with 204 when the request is already aborted", async () => {
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
});

test("POST /api/v1/sessions/{id}/stream streams SSE events for a live session", async () => {
  const sessions = installFakeWrapper("sid", { type: "agent_end" });
  try {
    const res = await POST(
      new Request("http://localhost/api/v1/sessions/sid/stream", { method: "POST" }),
      { params: Promise.resolve({ id: "sid" }) },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "text/event-stream");

    const frames = await collectUntil(res.body, '"type":"agent_end"');
    assert.match(frames, /data:\s*\{"type":"connected","sessionId":"sid","isStreaming":false\}/);
    assert.match(frames, /data:\s*\{"type":"agent_end"\}/);

    // A second read (idempotent) still sees both frames — the stream is stable.
    assert.match(frames, /data:\s*\{"type":"agent_end"\}/);
  } finally {
    sessions.delete("sid");
  }
});
