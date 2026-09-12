import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../app/api/v1/test-helper.mjs";

const jiti = createV1Jiti();
const client = await jiti.import(new URL("./api-v1-client.ts", import.meta.url).href);
const { listModels, getSessionModel, configureModel, ApiV1Error } = client;

test("listModels lists the catalog without a cwd probe", async () => {
  const originalFetch = globalThis.fetch;
  let path = "";
  globalThis.fetch = async (p) => {
    path = p;
    return new Response(JSON.stringify({ data: { models: {}, modelList: [] } }), { status: 200 });
  };
  try {
    const res = await listModels();
    assert.equal(path, "/api/v1/models");
    assert.deepEqual(res.models, {});
    assert.deepEqual(res.modelList, []);
  } finally { globalThis.fetch = originalFetch; }
});

test("getSessionModel reads the session model + thinking level", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: { model: { id: "x", provider: "p" }, thinkingLevel: "high" } }), {
      status: 200,
    });
  try {
    const res = await getSessionModel("sid");
    assert.deepEqual(res.model, { id: "x", provider: "p" });
    assert.equal(res.thinkingLevel, "high");
  } finally { globalThis.fetch = originalFetch; }
});

test("configureModel PATCHes the session model + thinking level", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (p, init) => {
    captured = { p, init };
    return new Response(JSON.stringify({ data: { model: { id: "opus", provider: "anthropic" }, thinkingLevel: "xhigh" } }), {
      status: 200,
    });
  };
  try {
    const res = await configureModel("sid", { model: { provider: "anthropic", modelId: "opus" }, thinkingLevel: "xhigh" });
    assert.equal(captured.p, "/api/v1/sessions/sid/model");
    assert.equal(captured.init.method, "PATCH");
    assert.equal(captured.init.headers["Content-Type"], "application/json");
    assert.deepEqual(res.model, { id: "opus", provider: "anthropic" });
    assert.equal(res.thinkingLevel, "xhigh");
  } finally { globalThis.fetch = originalFetch; }
});

test("configureModel throws ApiV1Error with the wire code on a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: "model_not_found", message: "missing" } }), { status: 404 });
  try {
    await assert.rejects(
      () => configureModel("sid", { model: { provider: "p", modelId: "nope" } }),
      (error) => error instanceof ApiV1Error && error.code === "model_not_found",
    );
  } finally { globalThis.fetch = originalFetch; }
});
