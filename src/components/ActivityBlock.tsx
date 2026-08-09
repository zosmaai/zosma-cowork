/**
 * ActivityBlock — Perplexity-style "what's happening now" card (issue #173).
 *
 * Replaces the per-tool-call timeline in the default (non-technical) view with
 * a single styled loading block:
 *   - Headline = the current/most-recent friendly activity ("Creating a document…")
 *   - Sub-line = the last few distinct clubbed activities, generically phrased
 *
 * No raw tool names, paths, diffs, or shell commands ever appear here.
 */

import { type Activity, clubActivities, headlineActivity } from "@/lib/statusLabels";
import type { ToolCallInfo } from "@/types";
import { AlertCircle, Check, Loader2 } from "lucide-react";

interface ActivityBlockProps {
	toolCalls: ToolCallInfo[];
	/** Whether the agent is still working — drives shimmer + trailing ellipsis. */
	active?: boolean;
	/** How many recent distinct activities to show under the headline. */
	maxTrail?: number;
}

export function ActivityBlock({ toolCalls, active = true, maxTrail = 3 }: ActivityBlockProps) {
	if (toolCalls.length === 0) return null;

	const activities = clubActivities(toolCalls);
	const headline = headlineActivity(toolCalls);
	if (!headline) return null;

	const anyError = activities.some((a) => a.status === "error");
	const accent = anyError
		? "hsl(var(--tool-error-fg))"
		: active
			? "hsl(var(--tool-running-fg))"
			: "hsl(var(--tool-complete-fg))";
	const bg = anyError
		? "hsl(var(--tool-error-bg))"
		: active
			? "hsl(var(--tool-running-bg))"
			: "hsl(var(--tool-complete-bg))";

	// Trailing activities = the most recent ones excluding the headline itself.
	const trail = activities.filter((a) => a.key !== headline.key).slice(-maxTrail);

	return (
		<div
			className="my-1.5 rounded-md px-3 py-2 animate-fade-in"
			style={{ background: bg, borderLeft: `2px solid ${accent}` }}
		>
			{/* Headline row */}
			<div className="flex items-center gap-2">
				<ActivityIcon status={active ? "running" : headline.status} color={accent} />
				<span
					className={`text-sm font-medium ${
						active && headline.status === "running" ? "animate-shimmer-text" : ""
					}`}
					style={
						active && headline.status === "running"
							? undefined
							: { color: "hsl(var(--foreground))" }
					}
				>
					{headline.phrase}
					{headline.count > 1 ? ` (${headline.count})` : ""}
					{active && headline.status === "running" ? "…" : ""}
				</span>
			</div>

			{/* Trail of recent generic activities */}
			{trail.length > 0 && (
				<div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-6 text-[13px] opacity-60">
					{trail.map((a, i) => (
						<span key={a.key} className="flex items-center gap-1.5">
							{i > 0 && <span className="opacity-40">·</span>}
							<span>
								{a.phrase}
								{a.count > 1 ? ` (${a.count})` : ""}
							</span>
						</span>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * ActivityRecap — one-line summary shown after a turn completes in simple view.
 * e.g. "✓ Done · 6 steps". The raw tool detail stays reachable via Ctrl+O.
 */
export function ActivityRecap({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
	if (toolCalls.length === 0) return null;
	const steps = toolCalls.length;
	const anyError = toolCalls.some((tc) => tc.status === "error");
	const color = anyError ? "hsl(var(--tool-error-fg))" : "hsl(var(--tool-complete-fg))";

	return (
		<div className="my-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
			{anyError ? (
				<AlertCircle className="h-3 w-3 flex-shrink-0" style={{ color }} />
			) : (
				<Check className="h-3 w-3 flex-shrink-0" style={{ color }} />
			)}
			<span>{anyError ? "Finished with issues" : "Done"}</span>
			<span className="opacity-40">·</span>
			<span className="tabular-nums">
				{steps} step{steps !== 1 ? "s" : ""}
			</span>
			<span className="opacity-40">·</span>
			<span className="opacity-50">Ctrl+O for details</span>
		</div>
	);
}

function ActivityIcon({ status, color }: { status: Activity["status"]; color: string }) {
	if (status === "running") {
		return <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" style={{ color }} />;
	}
	if (status === "error") {
		return <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />;
	}
	return <Check className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />;
}
