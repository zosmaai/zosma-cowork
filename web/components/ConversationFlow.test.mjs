import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const messageSource = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
const chatSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const flowSource = await readFile(new URL("../lib/conversation-flow.ts", import.meta.url), "utf8");
const branchSource = await readFile(new URL("./BranchNavigator.tsx", import.meta.url), "utf8");
const appSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const writtenFileSource = await readFile(new URL("./TurnWrittenFiles.tsx", import.meta.url), "utf8");

test("conversation source exposes flow anchors", async () => {
  for (const token of [
    "user-message",
    "user-message-bubble",
    "assistant-message",
    "assistant-message-blocks",
    "markdown-assistant-message",
    "compaction-marker",
    "conversation-column",
    "conversation-status",
    "branch-flow",
    "branch-flow-trigger",
    "branch-flow-trigger-mobile",
    "branch-flow-panel",
    "branch-flow-tree",
    "branch-flow-row",
    "branch-flow-node",
    "branch-flow-role",
    "branch-flow-label",
    "written-file-references",
    "written-file-reference",
  ]) {
    assert.match(`${messageSource}\n${chatSource}\n${branchSource}\n${appSource}\n${writtenFileSource}`, new RegExp(token));
  }
  assert.doesNotMatch(chatSource, /function ProcessDetailsGroup/);
  assert.doesNotMatch(chatSource, /<ProcessDetailsGroup/);
  assert.match(chatSource, /visibleProcessIndices\.forEach/);
  assert.match(chatSource, /from "@\/lib\/conversation-flow"/);
  assert.match(chatSource, /attachRef: attachFinalProcessRef/);
  assert.match(chatSource, /forwardDroppedImages\(chatInputRef\?\.current, files\)/);
  for (const handler of ["onDragEnter={handleDragEnter}", "onDragOver={handleDragOver}", "onDragLeave={handleDragLeave}", "onDrop={handleDrop}"]) assert.match(chatSource, new RegExp(handler));
  assert.match(flowSource, /shouldAttachFinalProcessRef/);
  assert.match(branchSource, /className="branch-flow-trigger"/);
  assert.match(appSource, /toggleTopPanel\("branches", true\)[\s\S]*?aria-pressed[\s\S]*?data-mobile-toolbar-action="branches"/);
  assert.match(branchSource, /hideInlineButton/);
});
