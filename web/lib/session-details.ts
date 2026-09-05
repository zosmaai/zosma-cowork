import type { ContextUsage, SessionStatsInfo } from "./pi-types";

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function formatSessionDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(finiteNonNegative(milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatCompactTokenCount(value: number): string {
  const count = finiteNonNegative(value);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`;
  return String(Math.floor(count));
}

export function getCacheHitRate(tokens: SessionStatsInfo["tokens"]): number | null {
  const input = finiteNonNegative(tokens.input);
  const cacheRead = finiteNonNegative(tokens.cacheRead);
  const cacheWrite = finiteNonNegative(tokens.cacheWrite);
  const denominator = input + cacheRead + cacheWrite;
  return denominator > 0 ? (cacheRead / denominator) * 100 : null;
}

export function formatSessionCost(cost: number): string | null {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
}

export interface SessionMetricValues {
  turns: number;
  steps: number;
  toolCalls: number | null;
  active: string | null;
  cacheHitPercent: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
  cost: string | null;
  contextPercent: number | null;
}

function getContextPercent(context: ContextUsage | null | undefined): number | null {
  if (!context) return null;
  if (typeof context.percent === "number" && Number.isFinite(context.percent) && context.percent >= 0) {
    return Math.min(100, Math.round(context.percent));
  }
  if (
    typeof context.tokens !== "number"
    || !Number.isFinite(context.tokens)
    || context.tokens < 0
    || !Number.isFinite(context.contextWindow)
    || context.contextWindow <= 0
  ) return null;
  return Math.min(100, Math.round((context.tokens / context.contextWindow) * 100));
}

export function getSessionMetricValues(
  stats: SessionStatsInfo,
  contextUsage?: ContextUsage | null,
): SessionMetricValues | null {
  const turns = Math.floor(finiteNonNegative(stats.userMessages));
  const steps = Math.floor(finiteNonNegative(stats.assistantMessages));
  const toolCallCount = Math.floor(finiteNonNegative(stats.toolCalls));
  const toolCalls = toolCallCount > 0 ? toolCallCount : null;
  const active = typeof stats.totalActiveMs === "number" && Number.isFinite(stats.totalActiveMs) && stats.totalActiveMs > 0
    ? formatSessionDuration(stats.totalActiveMs)
    : null;
  const promptTokenCount = finiteNonNegative(stats.tokens.input)
    + finiteNonNegative(stats.tokens.cacheRead)
    + finiteNonNegative(stats.tokens.cacheWrite);
  const promptTokens = promptTokenCount > 0 ? promptTokenCount : null;
  const outputTokenCount = finiteNonNegative(stats.tokens.output);
  const outputTokens = outputTokenCount > 0 ? outputTokenCount : null;
  const cacheHitPercent = getCacheHitRate(stats.tokens);
  const cost = formatSessionCost(stats.cost);
  const contextPercent = getContextPercent(contextUsage ?? stats.contextUsage);

  if (
    turns === 0
    && steps === 0
    && toolCalls === null
    && active === null
    && cacheHitPercent === null
    && promptTokens === null
    && outputTokens === null
    && cost === null
    && contextPercent === null
  ) return null;

  return {
    turns,
    steps,
    toolCalls,
    active,
    cacheHitPercent,
    promptTokens,
    outputTokens,
    cost,
    contextPercent,
  };
}
