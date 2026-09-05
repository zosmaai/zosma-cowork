import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { formatToolTitle, getToolCallState, firstUsefulLine, shouldAttachFinalProcessRef, forwardDroppedImages } = await jiti.import("./conversation-flow.ts");

test("formats tool titles and states", () => {
  assert.equal(formatToolTitle("bash"), "Run");
  assert.equal(formatToolTitle("web_search"), "Search web");
  assert.equal(formatToolTitle("session_ask"), "Session ask");
  assert.equal(formatToolTitle("custom-tool"), "Custom tool");
  assert.equal(getToolCallState(undefined, true), "running");
  assert.equal(getToolCallState({ role: "toolResult", toolCallId: "1", content: [] }, false), "success");
  assert.equal(getToolCallState({ role: "toolResult", toolCallId: "1", content: [], isError: true }, false), "error");
  assert.equal(getToolCallState(undefined, false), "interrupted");
});

test("finds first useful output line", () => {
  assert.equal(firstUsefulLine("\n  \nENOENT: missing file\nstack"), "ENOENT: missing file");
  assert.equal(firstUsefulLine("  \n\t"), "");
});

test("forwards dropped image files to the chat input", () => {
  const files = [{ name: "image.png" }];
  let received;
  forwardDroppedImages({ addImages(value) { received = value; } }, files);
  assert.equal(received, files);
});

test("attaches final process refs only without a final answer", () => {
  assert.equal(shouldAttachFinalProcessRef(true), false);
  assert.equal(shouldAttachFinalProcessRef(false), true);
});
