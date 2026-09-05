import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../.pi/extensions/zosma-ui-audit.ts", import.meta.url);

test("visual fixture is explicit, gated, and covers every current browser UI surface", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  assert.match(source, /process\.env\.ZOSMA_UI_VISUAL_AUDIT !== "1"/);
  assert.match(source, /registerCommand\("zosma-ui-audit"/);
  for (const token of [
    "ui.select(",
    "ui.confirm(",
    "ui.input(",
    "ui.editor(",
    "ui.custom(",
    "ui.notify(",
    "ui.setStatus(",
    "ui.setWidget(",
    "ui.setTitle(",
  ]) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
  assert.match(source, /placement: "belowEditor"/);
  assert.match(source, /case "clear"/);
  assert.doesNotMatch(source, /api[_-]?key|token|password/i);
});
