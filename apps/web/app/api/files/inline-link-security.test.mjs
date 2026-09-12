import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const messageSource = await readFile(new URL("../../../components/MessageView.tsx", import.meta.url), "utf8");

test("inline file links retain both server authorization paths", () => {
  for (const expression of [
    "getAllowedFileRoots",
    "isFilePathAllowed",
    "isExistingFilePathAllowed",
    "allowedByRoot",
    "allowedBySessionReference",
    "isFilePathReferencedBySession",
    "type !== \"list\"",
    "status: 403",
  ]) {
    assert.match(routeSource, new RegExp(expression.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  }
});

test("message rendering does not read files or bypass the API route", () => {
  assert.match(messageSource, /resolveLocalFileHref/);
  assert.match(messageSource, /onOpenFile\?\.\(toolFilePath\)/);
  assert.doesNotMatch(messageSource, /readFileSync|readFile\(|fetch\([^)]*toolFilePath/);
});
