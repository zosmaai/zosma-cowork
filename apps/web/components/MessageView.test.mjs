import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  MessageView,
  getTokenEstimateText,
  getToolCallInputText,
  replaceUserMessageText,
  resolveToolFilePath,
} = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

test("keeps streamed tool input out of collapsed markup while counting it", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-write-1",
    toolName: "write",
    input: {},
    rawInput: '{"path":"/tmp/file","content":"secret-stream-fragment',
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { isStreaming: true });

  assert.match(html, /Write/);
  assert.match(html, /Generating parameters/);
  assert.doesNotMatch(html, /secret-stream-fragment/);
  assert.equal(getToolCallInputText(block), block.rawInput);
  assert.equal(getTokenEstimateText(block), block.rawInput);
});

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("renders a complete SDK skill expansion as a compact command", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Review the supplied files/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("renders custom-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});


test("renders live and completed thinking disclosures with accessible state", () => {
  const live = renderMessage({
    role: "assistant",
    content: [{ type: "thinking", thinking: "working" }],
  }, { isStreaming: true });
  assert.match(live, /class="conversation-disclosure thinking-row" data-state="running"/);
  assert.match(live, /aria-expanded="true"/);
  assert.match(live, /Thinking in progress/);

  const complete = renderMessage({
    role: "assistant",
    content: [{ type: "thinking", thinking: "done" }],
  });
  assert.match(complete, /data-state="complete"/);
  assert.match(complete, /aria-expanded="false"/);
  assert.match(complete, /Thinking complete/);
});

test("renders every stored tool state with disclosure ARIA", () => {
  const renderTool = (props = {}) => renderMessage({
    role: "assistant",
    content: [{ type: "toolCall", toolCallId: "1", toolName: "bash", input: {} }],
  }, props);
  assert.match(renderTool({ isStreaming: true }), /data-state="running"/);
  assert.match(renderTool({ isStreaming: true }), /Running Run/);
  assert.match(renderTool({ toolResults: new Map([["1", { role: "toolResult", toolCallId: "1", content: [] }]]) }), /data-state="success"/);
  assert.match(renderTool({ toolResults: new Map([["1", { role: "toolResult", toolCallId: "1", content: [], isError: true }]]) }), /data-state="error"/);
  assert.match(renderTool({ toolResults: new Map([["1", { role: "toolResult", toolCallId: "1", content: [{ type: "text", text: "ENOENT: missing" }], isError: true }]]) }), /ENOENT: missing/);
  assert.match(renderTool(), /data-state="interrupted"/);
  assert.match(renderTool(), /aria-expanded="false"/);
});


test("renders open-canvas user and assistant message classes", () => {
  const user = renderMessage({ role: "user", content: "hello" });
  assert.match(user, /class="user-message-bubble"/);
  const assistant = renderMessage({ role: "assistant", content: [{ type: "text", text: "answer" }] });
  assert.match(assistant, /class="assistant-message"/);
  assert.match(assistant, /class="markdown-body markdown-assistant-message"/);
  assert.doesNotMatch(assistant, /assistant-card/);
});

test("renders collapsed accessible compaction disclosure", () => {
  const html = renderMessage({
    role: "custom",
    customType: "compaction",
    content: "Summary body",
    timestamp: Date.now(),
  });
  assert.match(html, /<details class="compaction-marker">/);
  assert.match(html, /<summary[^>]*>/);
  assert.match(html, /Summary body/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test("resolves only safe tool input paths through the existing local-file helper", () => {
  assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "1", toolName: "read", input: { path: "src/a.ts" } }, "/repo"), "/repo/src/a.ts");
  assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "2", toolName: "read", input: { file_path: "query%3F.json" } }, "/repo"), "/repo/query?.json");
  assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "3", toolName: "read", input: { path: "../outside.txt" } }, "/repo"), null);
  assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "4", toolName: "read", input: { path: "/etc/passwd" } }, "/repo"), "/etc/passwd");
  assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "5", toolName: "read", input: { path: "/api/files/repo/a.ts" } }, "/repo"), null);
});

test("keeps tool-file action callback wiring in expanded details", () => {
  assert.match(source, /resolveLocalFileHref/);
  assert.match(source, /resolveToolFilePath/);
  assert.match(source, /className=\"tool-file-link\"/);
  assert.match(source, /onOpenFile\?\.\(toolFilePath\)/);
  assert.match(source, /cwd=\{cwd\} onOpenFile=\{onOpenFile\}/);
});
