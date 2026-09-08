import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = fileURLToPath(new URL("./", import.meta.url));

async function packageTypeScriptSources() {
  const entries = await readdir(packageRoot, { recursive: true });
  return entries.filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"));
}

test("pi-backend source stays independent of Next and browser application modules", async () => {
  const forbiddenImport = /(?:from\s+|import\s*)["'](?:next(?:\/[^"']*)?|react(?:\/[^"']*)?|@\/(?:app|components|hooks)(?:\/[^"']*)?|(?:\.\.\/)+(?:app|components|hooks)(?:\/[^"']*)?)["']/;
  const browserOnlyLibImport = /(?:from\s+|import\s*)["'](?:@\/lib\/|(?:\.\.\/)+lib\/)(?:agent-client|agent-event-connection|browser-notifications|draft-store|file-explorer-state|panel-layout)["']/;

  for (const relativePath of await packageTypeScriptSources()) {
    const source = await readFile(join(packageRoot, relativePath), "utf8");
    assert.doesNotMatch(source, forbiddenImport, relativePath);
    assert.doesNotMatch(source, browserOnlyLibImport, relativePath);
  }
});
