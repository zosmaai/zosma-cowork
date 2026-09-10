import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../app/api/v1/test-helper.mjs";

// jiti loads the sibling .ts service (bare extensionless import won't resolve
// under --experimental-strip-types, same as the streaming service test).
const jiti = createV1Jiti();
const svc = await jiti.import(new URL("./session-model.ts", import.meta.url).href);
const { getSessionModel, configureModel } = svc;

// The service only calls runtime.getSession, so a minimal fake runtime is
// enough — no need to wire the full getRuntimeManager/globalThis machinery.
function makeRuntime(registry) {
  return { getSession: (id) => registry.get(id) };
}

// A fake wrapper that behaves like AgentSessionWrapper.send for get_state /
// set_model / set_thinking_level, tracking the session's model + thinking.
function installFakeWrapper(sessionId) {
  const registry = new Map();
  const state = { model: { id: "claude", provider: "anthropic" }, thinkingLevel: "high" };
  registry.set(sessionId, {
    isAlive: () => true,
    send: async (cmd) => {
      if (cmd.type === "get_state") return { model: state.model, thinkingLevel: state.thinkingLevel };
      if (cmd.type === "set_model") {
        if (cmd.modelId === "nope") throw new Error(`Model not found: ${cmd.provider}/${cmd.modelId}`);
        state.model = { id: cmd.modelId, provider: cmd.provider };
      }
      if (cmd.type === "set_thinking_level") state.thinkingLevel = cmd.level;
      return null;
    },
  });
  return { runtime: makeRuntime(registry), state };
}

test("getSessionModel returns the session's model + thinking level", async () => {
  const { runtime, state } = installFakeWrapper("sid");
  const model = await getSessionModel("sid", runtime);
  assert.deepEqual(model, { model: state.model, thinkingLevel: state.thinkingLevel });
});

test("getSessionModel throws session_not_found when the wrapper is dead", async () => {
  const runtime = makeRuntime(new Map());
  await assert.rejects(
    () => getSessionModel("ghost", runtime),
    (e) => e.code === "session_not_found",
  );
});

test("configureModel persists model + thinking and reflects back", async () => {
  const { runtime, state } = installFakeWrapper("sid");
  const result = await configureModel("sid", {
    model: { provider: "anthropic", modelId: "opus" },
    thinkingLevel: "xhigh",
  }, runtime);
  assert.deepEqual(result.model, { id: "opus", provider: "anthropic" });
  assert.equal(result.thinkingLevel, "xhigh");
  assert.equal(state.thinkingLevel, "xhigh");
});

test("configureModel throws model_not_found on an unknown model", async () => {
  const { runtime } = installFakeWrapper("sid");
  await assert.rejects(
    () => configureModel("sid", { model: { provider: "p", modelId: "nope" } }, runtime),
    (e) => e.code === "model_not_found",
  );
});
