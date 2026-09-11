import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  ZOSMA_PROVIDER_ID,
  snapshotProvider,
  upsertProvider,
  restoreProvider,
  deleteProvider,
  readProviderEntry,
} = await jiti.import("./models-json.ts");

function withModelsFile(initial, run) {
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-models-"));
    const modelsPath = join(dir, "models.json");
    if (initial !== undefined) {
      await writeFile(modelsPath, JSON.stringify(initial, null, 2));
    }
    try {
      await run(modelsPath, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

const entry = {
  id: "zosma-router",
  name: "Zosma AI",
  baseUrl: "https://router.zosma.ai/v1",
  apiKey: "sk-test",
  api: "openai-completions",
  models: [{ id: "m1", name: "M1", reasoning: true }],
};

test("ZOSMA_PROVIDER_ID is zosma-router (matches live pi state)", () => {
  assert.equal(ZOSMA_PROVIDER_ID, "zosma-router");
});

test("snapshotProvider returns null when provider absent", withModelsFile(
  { providers: { other: { id: "other" } } },
  async (p) => assert.equal(snapshotProvider(p, ZOSMA_PROVIDER_ID), null),
));

test("snapshotProvider returns a deep copy (mutation-safe)", withModelsFile(
  { providers: { "zosma-router": entry } },
  async (p) => {
    const snap = snapshotProvider(p, ZOSMA_PROVIDER_ID);
    snap.models.push({ id: "evil" });
    assert.equal(snapshotProvider(p, ZOSMA_PROVIDER_ID).models.length, 1);
  },
));

test("upsertProvider creates a new provider entry", withModelsFile(
  { providers: { "llama-swap": { id: "llama-swap" } } },
  async (p) => {
    upsertProvider(p, ZOSMA_PROVIDER_ID, entry);
    const data = JSON.parse(await readFile(p, "utf-8"));
    assert.deepEqual(data.providers["zosma-router"], entry);
    assert.deepEqual(data.providers["llama-swap"], { id: "llama-swap" });
  },
));

test("upsertProvider replaces an existing entry in place", withModelsFile(
  { providers: { "zosma-router": { ...entry, apiKey: "sk-old" } } },
  async (p) => {
    upsertProvider(p, ZOSMA_PROVIDER_ID, entry);
    assert.equal(readProviderEntry(p, ZOSMA_PROVIDER_ID).apiKey, "sk-test");
  },
));

test("restoreProvider with null snapshot removes the provider", withModelsFile(
  { providers: { "zosma-router": entry, other: { id: "other" } } },
  async (p) => {
    restoreProvider(p, ZOSMA_PROVIDER_ID, null);
    const data = JSON.parse(await readFile(p, "utf-8"));
    assert.equal(data.providers["zosma-router"], undefined);
    assert.deepEqual(data.providers.other, { id: "other" });
  },
));

test("restoreProvider puts back the exact snapshot", withModelsFile(
  { providers: { "zosma-router": { ...entry, apiKey: "sk-old" } } },
  async (p) => {
    const snap = snapshotProvider(p, ZOSMA_PROVIDER_ID);
    upsertProvider(p, ZOSMA_PROVIDER_ID, entry);
    restoreProvider(p, ZOSMA_PROVIDER_ID, snap);
    assert.equal(readProviderEntry(p, ZOSMA_PROVIDER_ID).apiKey, "sk-old");
  },
));

test("deleteProvider is a no-op-safe remove", withModelsFile(
  { providers: {} },
  async (p) => {
    deleteProvider(p, ZOSMA_PROVIDER_ID);
    assert.equal(readProviderEntry(p, ZOSMA_PROVIDER_ID), null);
  },
));
