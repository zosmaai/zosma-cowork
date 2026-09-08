import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { getModels, invalidateModelsCache } = await jiti.import("./models.ts");

// getModels is SDK-bound; its failure path swallows into the safe envelope, so
// this is a tolerant-shape integration smoke test rather than a strict snapshot.
test("getModels returns a ModelsData-shaped catalog", async () => {
  invalidateModelsCache();
  const cwd = mkdtempSync(join(tmpdir(), "pi-backend-models-"));
  try {
    const data = await getModels(cwd);
    assert.equal(typeof data.models, "object");
    assert.ok(Array.isArray(data.modelList));
    assert.equal(typeof data.thinkingLevels, "object");
    assert.equal(typeof data.thinkingLevelMaps, "object");
    assert.equal(typeof data.thinkingLevelPins, "object");
    assert.ok(data.defaultModel === null || typeof data.defaultModel === "object");
    assert.ok(data.modelError === undefined || typeof data.modelError === "string");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
