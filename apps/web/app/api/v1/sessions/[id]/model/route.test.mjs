import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../../test-helper.mjs";

// NOTE: the [id] segment is a Next.js dynamic route param, not a glob char
// class. Run via node --test "app/**/*.test.mjs" (the [id] bracket trips the
// node glob, which reads it as a character class).
const jiti = createV1Jiti();
const { GET, PATCH } = await jiti.import(new URL("./route.ts", import.meta.url).href);

// The route speaks to the daemon via process.env + global fetch, so stub the
// daemon IPC with a fake fetch that answers pi:list / pi:command requests.
function installDaemon(state) {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.ZOSMA_DAEMON_URL = "http://daemon.test";
  process.env.ZOSMA_DAEMON_TOKEN = "token";
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(url, "http://daemon.test/ipc");
    const body = JSON.parse(init.body ?? "{}");
    if (body.type === "pi:list") {
      return new Response(JSON.stringify({ ok: true, sessions: state.live ? [{ sessionId: "sid", state: "running", nativeSessionId: "sid" }] : [] }));
    }
    if (body.type === "pi:command") {
      const cmd = body.command;
      if (cmd.type === "get_state") {
        return new Response(JSON.stringify({ ok: true, result: { model: state.model, thinkingLevel: state.thinkingLevel } }));
      }
      if (cmd.type === "set_model") state.model = { id: cmd.modelId, provider: cmd.provider };
      if (cmd.type === "set_thinking_level") state.thinkingLevel = cmd.level;
      return new Response(JSON.stringify({ ok: true, result: null }));
    }
    return new Response(JSON.stringify({ ok: false, error: "unknown op" }), { status: 404 });
  };
  return () => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  };
}

test("GET /api/v1/sessions/{id}/model returns session_not_found 404 for a missing session", async () => {
  const restore = installDaemon({ live: false });
  try {
    const res = await GET(
      new Request("http://localhost/api/v1/sessions/ghost/model"),
      { params: Promise.resolve({ id: "ghost" }) },
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, "session_not_found");
  } finally { restore(); }
});

test("GET /api/v1/sessions/{id}/model returns the current model + thinking level", async () => {
  const restore = installDaemon({ live: true, model: { id: "claude", provider: "anthropic" }, thinkingLevel: "high" });
  try {
    const res = await GET(
      new Request("http://localhost/api/v1/sessions/sid/model"),
      { params: Promise.resolve({ id: "sid" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.data.model, { id: "claude", provider: "anthropic" });
    assert.equal(body.data.thinkingLevel, "high");
  } finally { restore(); }
});

test("PATCH /api/v1/sessions/{id}/model updates model + thinking and reflects back", async () => {
  const state = { live: true, model: { id: "claude", provider: "anthropic" }, thinkingLevel: "high" };
  const restore = installDaemon(state);
  try {
    const res = await PATCH(
      new Request("http://localhost/api/v1/sessions/sid/model", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: { provider: "anthropic", modelId: "opus" }, thinkingLevel: "xhigh" }),
      }),
      { params: Promise.resolve({ id: "sid" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.data.model, { id: "opus", provider: "anthropic" });
    assert.equal(body.data.thinkingLevel, "xhigh");
  } finally { restore(); }
});

test("PATCH with an empty body is a no-op that returns current state", async () => {
  const state = { live: true, model: { id: "claude", provider: "anthropic" }, thinkingLevel: "high" };
  const restore = installDaemon(state);
  try {
    const res = await PATCH(
      new Request("http://localhost/api/v1/sessions/sid/model", { method: "PATCH" }),
      { params: Promise.resolve({ id: "sid" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.thinkingLevel, "high");
  } finally { restore(); }
});