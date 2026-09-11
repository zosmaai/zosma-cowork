import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AUTH_RPC_OPS, handleAuthRpc } from "./rpc.ts";

// Isolate auth.json + models.json by pointing the agent dir at a temp root.
let agentDir;
test.before(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "daemon-auth-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
});

test.after(() => {
  try { rmSync(agentDir, { recursive: true, force: true }); } catch { /* gone */ }
});

test("auth ops are dispatched by the op registry", () => {
  assert.ok(AUTH_RPC_OPS.includes("auth:provider-listing"));
  assert.ok(AUTH_RPC_OPS.includes("auth:api-key-status"));
  assert.ok(AUTH_RPC_OPS.includes("auth:api-key-login"));
  assert.ok(AUTH_RPC_OPS.includes("auth:remove-api-key"));
  assert.ok(AUTH_RPC_OPS.includes("auth:logout"));
  assert.ok(AUTH_RPC_OPS.includes("auth:login-start"));
  assert.ok(AUTH_RPC_OPS.includes("auth:login-status"));
  assert.ok(AUTH_RPC_OPS.includes("auth:login-callback"));
  assert.ok(AUTH_RPC_OPS.includes("auth:login-cancel"));
  assert.ok(AUTH_RPC_OPS.includes("auth:provider-models"));
  assert.ok(AUTH_RPC_OPS.includes("auth:resolve-discovery"));
});

test("auth:provider-listing returns the catalog with per-provider capability flags", async () => {
  const r = await handleAuthRpc({ type: "auth:provider-listing" });
  assert.equal(r.status, 200);
  const list = r.body.data;
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
  const anthropic = list.find((p) => p.id === "anthropic");
  assert.ok(anthropic, "anthropic should be in the built-in catalog");
  assert.equal(typeof anthropic.hasApiKeyLogin, "boolean");
  assert.equal(typeof anthropic.hasOAuth, "boolean");
  assert.equal(typeof anthropic.modelCount, "number");
});

test("auth:api-key-status reports an unconfigured provider", async () => {
  const r = await handleAuthRpc({ type: "auth:api-key-status", provider: "anthropic" });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.provider, "anthropic");
  assert.ok("configured" in r.body.data);
  assert.ok("source" in r.body.data);
});

test("auth:api-key-status requires a provider", async () => {
  const r = await handleAuthRpc({ type: "auth:api-key-status" });
  assert.equal(r.status, 400);
});

test("auth:api-key-login rejects a missing or blank apiKey", async () => {
  const missing = await handleAuthRpc({ type: "auth:api-key-login", provider: "anthropic" });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "invalid_request");
  const blank = await handleAuthRpc({ type: "auth:api-key-login", provider: "anthropic", apiKey: "  " });
  assert.equal(blank.status, 400);
});

test("auth:remove-api-key on an absent provider is a no-op success", async () => {
  const r = await handleAuthRpc({ type: "auth:remove-api-key", provider: "anthropic" });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.success, true);
});

test("auth:logout rejects an unknown provider", async () => {
  const r = await handleAuthRpc({ type: "auth:logout", provider: "not-a-provider" });
  assert.equal(r.status, 400);
});

test("auth:logout requires a provider", async () => {
  const r = await handleAuthRpc({ type: "auth:logout" });
  assert.equal(r.status, 400);
});

test("auth:provider-models returns [] for an unknown provider", async () => {
  const r = await handleAuthRpc({ type: "auth:provider-models", providerId: "nope" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.models, []);
});

test("auth:provider-models requires providerId", async () => {
  const r = await handleAuthRpc({ type: "auth:provider-models" });
  assert.equal(r.status, 400);
});

test("auth:login-start requires a provider and cancels unknown providers", async () => {
  const missing = await handleAuthRpc({ type: "auth:login-start" });
  assert.equal(missing.status, 400);

  const started = await handleAuthRpc({ type: "auth:login-start", provider: "not-a-provider" });
  assert.equal(started.status, 200);
  assert.equal(typeof started.body.data.authId, "string");

  // The unknown provider errors asynchronously; poll status until done.
  let status;
  for (let i = 0; i < 20; i++) {
    status = await handleAuthRpc({ type: "auth:login-status", authId: started.body.data.authId });
    if (status.body.data.done) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(status.status, 200);
  assert.equal(status.body.data.done, true);
  const errorEvent = status.body.data.events.find((e) => e.type === "error");
  assert.ok(errorEvent, "expected an error event for an unknown provider");
});

test("auth:login-status reports not_found for a bogus authId", async () => {
  const r = await handleAuthRpc({ type: "auth:login-status", authId: "bogus" });
  assert.equal(r.status, 404);
});

test("auth:login-callback requires authId/token/code", async () => {
  const r = await handleAuthRpc({ type: "auth:login-callback" });
  assert.equal(r.status, 400);
});

test("auth:login-callback reports not_found for a bogus authId", async () => {
  const r = await handleAuthRpc({ type: "auth:login-callback", authId: "bogus", token: "x", code: "y" });
  assert.equal(r.status, 404);
});

test("auth:resolve-discovery requires providerName", async () => {
  const r = await handleAuthRpc({ type: "auth:resolve-discovery" });
  assert.equal(r.status, 400);
});

test("auth:resolve-discovery resolves headers for a known provider", async () => {
  const r = await handleAuthRpc({
    type: "auth:resolve-discovery",
    providerName: "anthropic",
    providerConfig: { apiKeyEnvVar: "ANTHROPIC_API_KEY", type: "anthropic" },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.headers && typeof r.body.data.headers === "object");
});
test("auth:resolve-discovery resolves env-backed headers without a credential", async () => {
  process.env.PI_WEB_DISCOVERY_TEST_TOKEN = "resolved-token";
  try {
    const r = await handleAuthRpc({
      type: "auth:resolve-discovery",
      providerName: "pi-web-header-only-test",
      providerConfig: {
        baseUrl: "https://example.invalid/v1",
        api: "openai-completions",
        headers: { "X-Discovery-Token": "$PI_WEB_DISCOVERY_TEST_TOKEN" },
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.apiKey, undefined);
    assert.deepEqual(r.body.data.headers, { "X-Discovery-Token": "resolved-token" });
  } finally {
    delete process.env.PI_WEB_DISCOVERY_TEST_TOKEN;
  }
});

test("auth:test-model validates required fields", async () => {
  const missing = await handleAuthRpc({ type: "auth:test-model" });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "invalid_request");
  const noModel = await handleAuthRpc({
    type: "auth:test-model",
    providerName: "anthropic",
    providerConfig: { type: "anthropic" },
  });
  assert.equal(noModel.status, 400);
  const noModelId = await handleAuthRpc({
    type: "auth:test-model",
    providerName: "anthropic",
    providerConfig: { type: "anthropic" },
    modelConfig: { id: "  " },
  });
  assert.equal(noModelId.status, 400);
});

test("auth:test-model returns ok:false without a stored credential", async () => {
  const r = await handleAuthRpc({
    type: "auth:test-model",
    providerName: "anthropic",
    providerConfig: { type: "anthropic" },
    modelConfig: { id: "claude-opus" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.ok, false);
  assert.match(r.body.data.error, /No API key found/);
});
