import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  formatSessionDuration,
  formatCompactTokenCount,
  getCacheHitRate,
  formatSessionCost,
  getSessionMetricValues,
} = await jiti.import("./session-details.ts");

function tokens(overrides = {}) {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    ...overrides,
  };
}

test("formats session durations without inventing hours or minutes", () => {
  assert.equal(formatSessionDuration(0), "0s");
  assert.equal(formatSessionDuration(59_999), "59s");
  assert.equal(formatSessionDuration(60_000), "1m 0s");
  assert.equal(formatSessionDuration(3_661_000), "1h 1m");
});

test("formats token counts compactly", () => {
  assert.equal(formatCompactTokenCount(999), "999");
  assert.equal(formatCompactTokenCount(1_000), "1k");
  assert.equal(formatCompactTokenCount(1_000_000), "1.0M");
});

test("returns cache hit rate only with a positive input-class denominator", () => {
  assert.equal(getCacheHitRate(tokens({ output: 1, total: 1 })), null);
  assert.equal(getCacheHitRate(tokens({ input: 100, cacheRead: 50, cacheWrite: 50, total: 201 })), 25);
});

test("omits zero cost and rounds small positive costs safely", () => {
  assert.equal(formatSessionCost(0), null);
  assert.equal(formatSessionCost(0.001), "<$0.01");
  assert.equal(formatSessionCost(0.14), "$0.14");
});

test("returns omission-safe values for invalid inputs", () => {
  assert.equal(formatSessionDuration(Number.NaN), "0s");
  assert.equal(formatCompactTokenCount(Number.POSITIVE_INFINITY), "0");
  assert.equal(formatSessionCost(Number.NaN), null);
});

function stats(overrides = {}) {
  return {
    sessionId: "session-1",
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: tokens(),
    cost: 0,
    ...overrides,
  };
}

test("derives only authoritative display-safe session metrics", () => {
  assert.deepEqual(
    getSessionMetricValues(
      stats({
        userMessages: 4,
        assistantMessages: 8,
        toolCalls: 11,
        totalActiveMs: 102_000,
        tokens: tokens({ input: 100, output: 20, cacheRead: 50, cacheWrite: 50, total: 220 }),
        cost: 0.14,
        contextUsage: { percent: null, contextWindow: 128, tokens: 32 },
      }),
      { percent: 49.6, contextWindow: 128, tokens: 64 },
    ),
    {
      turns: 4,
      steps: 8,
      toolCalls: 11,
      active: "1m 42s",
      cacheHitPercent: 25,
      promptTokens: 200,
      outputTokens: 20,
      cost: "$0.14",
      contextPercent: 50,
    },
  );
});

test("keeps real zero cache hits and falls back to context token arithmetic", () => {
  const result = getSessionMetricValues(stats({
    userMessages: 1,
    assistantMessages: 1,
    tokens: tokens({ input: 100, total: 100 }),
    contextUsage: { percent: null, contextWindow: 128, tokens: 32 },
  }));
  assert.equal(result.cacheHitPercent, 0);
  assert.equal(result.contextPercent, 25);
  assert.equal(result.toolCalls, null);
  assert.equal(result.active, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.cost, null);
});

test("caps compact context and omits invalid or empty optional values", () => {
  assert.equal(
    getSessionMetricValues(stats({ userMessages: 1 }), { percent: null, contextWindow: 100, tokens: 120 }).contextPercent,
    100,
  );
  assert.equal(getSessionMetricValues(stats({
    userMessages: Number.NaN,
    assistantMessages: -1,
    toolCalls: Number.POSITIVE_INFINITY,
    totalActiveMs: -1,
    tokens: tokens({ input: Number.NaN, output: -1, cacheRead: -2, cacheWrite: Number.POSITIVE_INFINITY }),
    cost: Number.NaN,
    contextUsage: { percent: Number.NaN, contextWindow: 0, tokens: -1 },
  })), null);
});
