import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const explorer = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const tabs = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("keeps explorer file and change rows keyboard-activatable", () => {
  assert.match(explorer, /"file-explorer-row"/);
  assert.match(explorer, /role="button"/);
  assert.match(explorer, /tabIndex=\{0\}/);
  assert.match(explorer, /onKeyDown=\{\(event\) =>/);
  assert.match(explorer, /"file-explorer-change-row"/);
  assert.match(explorer, /onOpenFile\(status\.filePath, name, \{ modeHint: "diff" \}\)/);
  assert.doesNotMatch(explorer, /\bstyle=/);
});

test("keeps explorer state and file tabs as existing entry points", () => {
  assert.match(sidebar, /loadExplorerOpen\(\)/);
  assert.match(sidebar, /saveExplorerOpen\(next\)/);
  assert.match(sidebar, /<FileExplorer/);
  assert.match(explorer, /className="file-explorer-section"/);
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /onAuxClick/);
});

test("explorer follows the canonical current cwd on fresh sessions", () => {
  assert.match(sidebar, /const explorerCwd = selectedCwd \?\? selectedCwdProp \?\? validatedProject\?\.cwd \?\? null/);
  assert.match(sidebar, /\{explorerCwd && \(/);
  assert.match(sidebar, /cwd=\{explorerCwd\}/);
});

test("workspace browser does not override explorer split sizing", () => {
  assert.doesNotMatch(styles, /\.workspace-browser\s*\{[^}]*flex:\s*1 1 auto !important/s);
});
