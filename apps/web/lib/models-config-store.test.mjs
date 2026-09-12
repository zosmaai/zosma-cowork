import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  normalizeModelsConfigCosts,
  readModelsConfig,
  writeModelsConfig,
} = await jiti.import("./models-config-store.ts");
const { invalidateModelsCache } = await jiti.import("./models-cache.ts");

function createTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-models-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function modelsData(id) {
  return {
    models: { [`provider:${id}`]: id },
    modelList: [{ id, name: id, provider: "provider" }],
    defaultModel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
    thinkingLevelPins: {},
  };
}

test("saving models.json atomically and busts the daemon model cache", async (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "agent", "models.json");
  const config = {
    providers: {
      acme: {
        baseUrl: "https://models.example.test/v1",
        api: "openai-completions",
        models: [{ id: "acme-2" }],
      },
    },
  };
  // Roadmap item 6: the 60s model cache is daemon-owned; saving writes the
  // file atomically and fires the read:invalidate-models relay.
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, data: { ok: true } }), { status: 200 });
  };
  const oldUrl = process.env.ZOSMA_DAEMON_URL;
  const oldToken = process.env.ZOSMA_DAEMON_TOKEN;
  process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
  process.env.ZOSMA_DAEMON_TOKEN = "tok";
  try {
    writeModelsConfig(config, modelsPath);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(seen, [{ type: "read:invalidate-models" }]);
    assert.deepEqual(readModelsConfig(modelsPath), config);
    assert.deepEqual(readdirSync(join(root, "agent")), ["models.json"]);
    if (process.platform !== "win32") {
      assert.equal(statSync(modelsPath).mode & 0o777, 0o600);
    }
  } finally {
    if (oldUrl === undefined) delete process.env.ZOSMA_DAEMON_URL;
    else process.env.ZOSMA_DAEMON_URL = oldUrl;
    if (oldToken === undefined) delete process.env.ZOSMA_DAEMON_TOKEN;
    else process.env.ZOSMA_DAEMON_TOKEN = oldToken;
    globalThis.fetch = originalFetch;
  }
});

test("models.json writes fill partial cost groups with zero and remove empty groups", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "agent", "models.json");
  const config = {
    providers: {
      acme: {
        models: [
          { id: "empty-cost", cost: {} },
          { id: "partial-cost", cost: { input: 1, output: 2, cacheRead: 0.1 } },
          { id: "complete-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.1 } },
        ],
        modelOverrides: {
          inherited: { cost: { input: 3 } },
        },
      },
    },
  };

  const normalized = normalizeModelsConfigCosts(config);
  assert.deepEqual(normalized.providers.acme.models, [
    { id: "empty-cost" },
    { id: "partial-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } },
    { id: "complete-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.1 } },
  ]);
  assert.deepEqual(normalized.providers.acme.modelOverrides, {
    inherited: { cost: { input: 3 } },
  });
  assert.deepEqual(config.providers.acme.models[0], { id: "empty-cost", cost: {} });

  writeModelsConfig(config, modelsPath);
  assert.deepEqual(readModelsConfig(modelsPath), normalized);
});

test("saving models.json drops blank model rows without hiding other schema errors", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "agent", "models.json");

  writeModelsConfig({
    providers: {
      acme: {
        baseUrl: "https://models.example.test/v1",
        api: "openai-completions",
        models: [
          { id: "working-model", cost: { input: 1 } },
          { id: "" },
          { id: "  " },
          { id: 42 },
          { name: "Missing identifier" },
          null,
        ],
      },
    },
  }, modelsPath);

  assert.deepEqual(readModelsConfig(modelsPath), {
    providers: {
      acme: {
        baseUrl: "https://models.example.test/v1",
        api: "openai-completions",
        models: [
          { id: "working-model", cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
          { id: 42 },
          { name: "Missing identifier" },
          null,
        ],
      },
    },
  });
});

test("an existing session opens after its historical model is removed from config", (t) => {
  const root = createTempRoot(t);
  const sessionPath = join(root, "session.jsonl");
  const modelsPath = join(root, "models.json");
  const records = [
    {
      type: "session",
      version: 3,
      id: "existing-session",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: root,
    },
    {
      type: "model_change",
      id: "model-old",
      parentId: null,
      provider: "retired-provider",
      modelId: "retired-model",
      timestamp: "2026-01-01T00:00:01.000Z",
    },
    {
      type: "message",
      id: "user-1",
      parentId: "model-old",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: { role: "user", content: "keep this conversation" },
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-01-01T00:00:03.000Z",
      message: {
        role: "assistant",
        provider: "retired-provider",
        model: "retired-model",
        content: [{ type: "text", text: "still readable" }],
      },
    },
  ];
  writeFileSync(sessionPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  writeModelsConfig({
    providers: {
      "retired-provider": {
        baseUrl: "https://retired.example.test/v1",
        api: "openai-completions",
        models: [{ id: "retired-model" }],
      },
    },
  }, modelsPath);
  const beforeChange = readFileSync(sessionPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(beforeChange.find((e) => e.id === "assistant-1").message.content[0].text, "still readable");

  writeModelsConfig({
    providers: {
      replacement: {
        baseUrl: "https://replacement.example.test/v1",
        api: "openai-completions",
        models: [{ id: "replacement-model" }],
      },
    },
  }, modelsPath);

  const afterChange = readFileSync(sessionPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(afterChange.map((e) => e.id), ["existing-session", "model-old", "user-1", "assistant-1"]);
  assert.equal(afterChange.find((e) => e.id === "user-1").message.content, "keep this conversation");
  assert.equal(afterChange.find((e) => e.id === "assistant-1").message.content[0].text, "still readable");
});
