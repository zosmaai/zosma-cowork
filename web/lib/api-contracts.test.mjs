import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const contractRoot = fileURLToPath(new URL("./", import.meta.url));
const CONTRACT_FILES = ["api-contracts.ts", "backend-errors.ts"];

test("api contract files stay independent of Next and browser application modules", async () => {
  const forbiddenImport = /(?:from\s+|import\s*)["'](?:next(?:\/[^"']*)?|react(?:\/[^"']*)?|@\/(?:app|components|hooks)(?:\/[^"']*)?|(?:\.\.\/)+(?:app|components|hooks)(?:\/[^"']*)?)["']/;
  const browserOnlyLibImport = /(?:from\s+|import\s*)["'](?:@\/lib\/|(?:\.\.\/)+lib\/)(?:agent-client|agent-event-connection|browser-notifications|draft-store|file-explorer-state|panel-layout)["']/;

  for (const relativePath of CONTRACT_FILES) {
    const source = await readFile(join(contractRoot, relativePath), "utf8");
    assert.doesNotMatch(source, forbiddenImport, relativePath);
    assert.doesNotMatch(source, browserOnlyLibImport, relativePath);
  }
});
