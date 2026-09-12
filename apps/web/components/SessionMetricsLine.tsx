"use client";

import { Fragment } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatCompactTokenCount, getSessionMetricValues } from "@/lib/session-details";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";

interface SessionMetricsLineProps {
  stats: SessionStatsInfo | null;
  contextUsage?: ContextUsage | null;
}

export function SessionMetricsLine({ stats, contextUsage }: SessionMetricsLineProps) {
  const { t } = useI18n();
  if (!stats) return null;
  const values = getSessionMetricValues(stats, contextUsage);
  if (!values) return null;

  const groups: string[] = [];
  if (values.turns > 0 || values.steps > 0) {
    groups.push(t("session.metrics.counts", { turns: values.turns, steps: values.steps }));
  }

  const activity: string[] = [];
  if (values.toolCalls !== null) {
    activity.push(t("session.metrics.tools", { count: values.toolCalls }));
  }
  if (values.active !== null) {
    activity.push(t("session.metrics.active", { duration: values.active }));
  }
  if (activity.length > 0) groups.push(activity.join(" · "));

  const utilization: string[] = [];
  if (values.cacheHitPercent !== null) {
    utilization.push(t("session.metrics.cacheHit", { percent: Math.round(values.cacheHitPercent) }));
  }
  if (values.contextPercent !== null) {
    utilization.push(t("session.metrics.context", { percent: values.contextPercent }));
  }
  if (utilization.length > 0) groups.push(utilization.join(" · "));

  const tokens: string[] = [];
  if (values.promptTokens !== null) {
    tokens.push(t("session.metrics.input", { tokens: formatCompactTokenCount(values.promptTokens) }));
  }
  if (values.outputTokens !== null) {
    tokens.push(t("session.metrics.output", { tokens: formatCompactTokenCount(values.outputTokens) }));
  }
  if (tokens.length > 0) groups.push(tokens.join(" · "));
  if (values.cost !== null) groups.push(values.cost);
  if (groups.length === 0) return null;

  const line = groups.join(" | ");
  return (
    <div className="session-metrics-shell">
      <div className="session-metrics-line" role="note" aria-label={line} title={line}>
        {groups.map((group, index) => (
          <Fragment key={group}>
            {index > 0 && <span className="session-metrics-separator" aria-hidden="true">|</span>}
            <span>{group}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
