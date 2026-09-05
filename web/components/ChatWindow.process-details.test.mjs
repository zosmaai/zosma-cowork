import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("renders completed process messages directly with final-ref ownership", () => {
  assert.doesNotMatch(source, /function ProcessDetailsGroup/);
  assert.doesNotMatch(source, /<ProcessDetailsGroup/);
  assert.match(source, /visibleProcessIndices\.forEach/);
  assert.match(source, /attachRef: attachFinalProcessRef/);
  assert.match(source, /shouldAttachFinalProcessRef\(Boolean\(finalAnswerMessage\)\)/);
});
