import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  findFinalAssistantIndex,
  getUserInputText,
  hasDisplayableProcessMessage,
  isGroupAnchor,
  phaseLabel,
  withAssistantBlocks,
} = await jiti.import("./chat-message-grouping.ts");

const t = (key) => key;
const assistant = (blocks, extra = {}) => ({ role: "assistant", content: blocks, ...extra });

test("phaseLabel returns null for idle/unknown phases", () => {
  assert.equal(phaseLabel(null, t), null);
  assert.equal(phaseLabel({ kind: "idle" }, t), null);
});

test("phaseLabel labels running tools with progress and counts", () => {
  assert.equal(phaseLabel({ kind: "running_tools", tools: [{ name: "bash", progress: "42%" }] }, t), "chat.runningNamedTool 42%");
  assert.equal(phaseLabel({ kind: "running_tools", tools: [{ name: "bash" }, { name: "grep" }] }, t), "chat.runningTools");
  assert.equal(phaseLabel({ kind: "waiting_model" }, t), "chat.waitingModel");
});

test("getUserInputText extracts plain and block content", () => {
  assert.equal(getUserInputText({ role: "user", content: "  hi  " }), "hi");
  assert.equal(getUserInputText({ role: "user", content: [] }), null);
  assert.equal(
    getUserInputText({ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
    "a\nb",
  );
  assert.equal(getUserInputText(assistant([])), null);
});

test("findFinalAssistantIndex prefers a message that actually answers", () => {
  const messages = [
    { role: "user", content: "q" },
    assistant([{ type: "toolCall", callId: "1", name: "grep" }], { timestamp: 1 }),
    assistant([{ type: "text", text: "answer" }], { timestamp: 2 }),
  ];
  // End index excludes the trailing un-answered assistant entry.
  assert.equal(findFinalAssistantIndex(messages, 0, 3), 2);
  // No answer content → falls back to last assistant role.
  const noAnswer = [
    { role: "user", content: "q" },
    assistant([{ type: "toolCall", callId: "1", name: "grep" }]),
  ];
  assert.equal(findFinalAssistantIndex(noAnswer, 0, 2), 1);
  assert.equal(findFinalAssistantIndex(noAnswer, 0, 1), -1);
});

test("isGroupAnchor marks user and compaction summaries", () => {
  assert.equal(isGroupAnchor({ role: "user", content: "x" }), true);
  assert.equal(isGroupAnchor({ role: "custom", customType: "compaction" }), true);
  assert.equal(isGroupAnchor({ role: "custom", customType: "extension" }), false);
  assert.equal(isGroupAnchor(assistant([])), false);
});

test("hasDisplayableProcessMessage hides empty assistant entries", () => {
  assert.equal(hasDisplayableProcessMessage(assistant([])), false);
  assert.equal(hasDisplayableProcessMessage(assistant([{ type: "text", text: "process" }])), true);
  assert.equal(hasDisplayableProcessMessage({ role: "custom", customType: "x" }), true);
  assert.equal(hasDisplayableProcessMessage({ role: "toolResult", toolCallId: "1" }), false);
});

test("withAssistantBlocks swaps content and can omit usage", () => {
  const original = assistant([], { usage: { in: 1 } });
  const next = withAssistantBlocks(original, [{ type: "text", text: "final" }], { omitUsage: true });
  assert.equal(next.content.length, 1);
  assert.equal(next.usage, undefined);
  assert.ok(next !== original, "returns a copy");
});