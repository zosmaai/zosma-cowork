import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../../test-helper.mjs";

// NOTE: the [id] segment is a Next.js dynamic route param, not a glob char
// class. Run via node --test "app/**/*.test.mjs" (the [id] bracket trips the
// node glob, which reads it as a character class).
const jiti = createV1Jiti();
const { GET, PATCH } = await jiti.import(new URL("./route.ts", import.meta.url).href);

// Inject a fake live session wrapper into the runtime registry the facade
// reads (globalThis.__piSessions), like the streaming route test.
function installFakeWrapper(sessionId) {
  const registry = globalThis.__piSessions ??= new Map();
  const state = { model: { id: "claude", provider: "anthropic" }, thinkingLevel: "high" };
  registry.set(sessionId, {
    isAlive: () => true,
    send: async (cmd) => {
      if (cmd.type === "get_state") return { model: state.model, thinkingLevel: state.thinkingLevel };
      if (cmd.type === "set_model") state.model = { id: cmd.modelId, provider: cmd.provider };
      if (cmd.type === "set_thinking_level") state.thinkingLevel = cmd.level;
      return null;
    },
  });
  return { registry, state };
}

test("GET /api/v1/sessions/{id}/model returns session_not_found 404 for a missing session", async () => {
  const res = await GET(
    new Request("http://localhost/api/v1/sessions/ghost/model"),
    { params: Promise.resolve({ id: "ghost" }) },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
});

test("GET /api/v1/sessions/{id}/model returns the current model + thinking level", async () => {
  const { registry } = installFakeWrapper("sid");
  try {
    const res = await GET(
      new Request("http://localhost/api/v1/sessions/sid/model"),
      { params: Promise.resolve({ id: "sid" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.data.model, { id: "claude", provider: "anthropic" });
    assert.equal(body.data.thinkingLevel, "high");
  } finally { registry.delete("sid"); }
});

test("PATCH /api/v1/sessions/{id}/model updates model + thinking and reflects back", async () => {
  const { registry } = installFakeWrapper("sid");
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
  } finally { registry.delete("sid"); }
});

test("PATCH with an empty body is a no-op that returns current state", async () => {
  const { registry } = installFakeWrapper("sid");
  try {
    const res = await PATCH(
      new Request("http://localhost/api/v1/sessions/sid/model", { method: "PATCH" }),
      { params: Promise.resolve({ id: "sid" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.thinkingLevel, "high");
  } finally { registry.delete("sid"); }
});
