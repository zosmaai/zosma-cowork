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
const { SessionMetricsLine } = await jiti.import("./SessionMetricsLine.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function stats(overrides = {}) {
  return {
    sessionId: "session-1",
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(SessionMetricsLine, props)),
  );
}

test("renders grouped authoritative metrics in stable order", () => {
  const html = render({
    stats: stats({
      userMessages: 4,
      assistantMessages: 8,
      toolCalls: 11,
      totalActiveMs: 102_000,
      tokens: { input: 49_000, output: 2_100, cacheRead: 800, cacheWrite: 200, total: 52_100 },
      cost: 0.14,
    }),
    contextUsage: { percent: 51, contextWindow: 128_000, tokens: 65_280 },
  });

  for (const text of [
    "4 turns · 8 steps",
    "11 tool calls · Active 1m 42s",
    "Cache hit 2% · Context 51%",
    "Input 50k tok · Output 2k tok",
    "$0.14",
  ]) assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(html, /class="session-metrics-shell"/);
  assert.match(html, /class="session-metrics-line" role="note"/);
  assert.match(html, /aria-label="4 turns/);
  assert.match(html, /title="4 turns/);
  assert.equal((html.match(/session-metrics-separator/g) ?? []).length, 4);
});

test("omits unavailable optional segments and empty rows", () => {
  const html = render({
    stats: stats({
      userMessages: 1,
      assistantMessages: 1,
      tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, total: 100 },
    }),
  });
  assert.match(html, /1 turns · 1 steps/);
  assert.match(html, /Cache hit 0%/);
  assert.match(html, /Input 100 tok/);
  assert.doesNotMatch(html, /tool calls|Active|Output|Context|\$/);
  assert.equal(render({ stats: stats() }), "");
  assert.equal(render({ stats: null }), "");
});

test("keeps extension placements around the composer and metrics", async () => {
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const activeComposer = chatWindow.slice(chatWindow.lastIndexOf('<div className="relative">'));
  const aboveIndex = activeComposer.indexOf('placement="aboveEditor"');
  const inputIndex = activeComposer.indexOf("{chatInputElement}");
  const metricsIndex = activeComposer.indexOf("<SessionMetricsLine");
  const belowIndex = activeComposer.indexOf('placement="belowEditor"');

  assert.ok(aboveIndex >= 0);
  assert.ok(inputIndex > aboveIndex);
  assert.ok(metricsIndex > inputIndex);
  assert.ok(belowIndex > metricsIndex);
  assert.match(activeComposer, /widgets=\{extensionWidgetGroups\.aboveEditor\}/);
  assert.match(activeComposer, /widgets=\{extensionWidgetGroups\.belowEditor\}/);
  assert.match(chatWindow, /<SessionMetricsLine stats=\{sessionStats\} contextUsage=\{contextUsage\} \/>/);
  assert.doesNotMatch(chatInput, /SessionMetricsLine|sessionStats|contextUsage/);
});
