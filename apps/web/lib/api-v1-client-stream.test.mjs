import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../app/api/v1/test-helper.mjs";

const jiti = createV1Jiti();
const client = await jiti.import(new URL("./api-v1-client.ts", import.meta.url).href);
const { streamSession, ApiV1Error } = client;

function waitFor(handle, type) {
  return new Promise((resolve, reject) => {
    const off = handle.onEvent((e) => {
      if (e.type === type) { off(); resolve(e); }
    });
    setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 2000);
  });
}

// Emit each frame after a fixed delay (first frame at 40ms, then every 40ms),
// so the caller subscribes before the first frame is delivered. Emission stops
// cleanly once the reader is cancelled.
function sseBody(frames) {
  const enc = new TextEncoder();
  let i = 0;
  let aborted = false;
  const stream = new ReadableStream({
    start(c) {
      const emit = () => {
        if (aborted) return;
        if (i >= frames.length) return c.close();
        try { c.enqueue(enc.encode(frames[i++])); } catch { /* reader cancelled */ }
        if (!aborted) setTimeout(emit, 40);
      };
      setTimeout(emit, 40);
    },
  });
  return { stream, stop: () => { aborted = true; } };
}

test("streamSession parses SSE frames and delivers them in order", async () => {
  const originalFetch = globalThis.fetch;
  const payload = [
    "data: {\"type\":\"connected\",\"sessionId\":\"sid\",\"isStreaming\":false}\n\n",
    "data: {\"type\":\"message_start\",\"message\":\"hi\"}\n\n",
    "data: {\"type\":\"agent_end\"}\n\n",
  ];
  try {
    const { stream, stop } = sseBody(payload);
    globalThis.fetch = async () => new Response(stream);
    const events = [];
    const handle = await streamSession("sid");
    const connected = waitFor(handle, "connected").then((e) => { events.push(e); return e; });
    waitFor(handle, "message_start").then((e) => { events.push(e); }, () => {});
    waitFor(handle, "agent_end").then((e) => { events.push(e); }, () => {});
    await connected;
    await waitFor(handle, "agent_end");
    handle.close();
    stop();
    assert.deepEqual(
      events.map((e) => e.type),
      ["connected", "message_start", "agent_end"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamSession throws ApiV1Error with the wire code on a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: "session_not_found", message: "missing" } }), {
      status: 404,
    });
  try {
    await assert.rejects(
      () => streamSession("ghost"),
      (error) => error instanceof ApiV1Error && error.code === "session_not_found",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
