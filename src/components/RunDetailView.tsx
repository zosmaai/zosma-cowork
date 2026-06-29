/**
 * RunDetailView — full-page read-only view of a task run's conversation (#300).
 *
 * Shows the complete conversation (thinking, tool calls, tool results, text)
 * in a layout similar to ChatView. Activated by clicking a run card in the
 * TaskDetailPage Run Log or the Activity feed.
 */

import { formatRelative } from "@/lib/cron";
import { isNearBottom } from "@/lib/scroll";
import type { ConversationEntry, TaskRun } from "@/types";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, CalendarClock, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface RunDetailViewProps {
	run: TaskRun;
	taskName: string;
	onBack: () => void;
	/** Re-fetch the latest runs for this task so the view can update live. */
	listRuns?: (taskId: string, limit?: number) => Promise<TaskRun[]>;
}

export function RunDetailView({ run: initialRun, taskName, onBack, listRuns }: RunDetailViewProps) {
	// Keep a live copy of the run so the view updates while it's still running.
	const [run, setRun] = useState<TaskRun>(initialRun);
	const runIdRef = useRef(initialRun.runId);

	// Stick-to-bottom (#300): auto-scroll to the newest step as it streams, but
	// only while the user is already at the bottom. If they scroll up to read,
	// sticking pauses; when they return to the bottom it resumes.
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(true);

	const isLive = run.status === "pending" || run.status === "running";

	// Re-sync if the caller swaps to a different run.
	useEffect(() => {
		runIdRef.current = initialRun.runId;
		setRun(initialRun);
	}, [initialRun]);

	// Update THIS run's data live — but ONLY via push events while it's still
	// running, and ONLY updating state (no remount, so scroll is preserved).
	// No polling interval: once the run finishes the events stop and the view
	// goes quiet. A completed run never re-fetches.
	useEffect(() => {
		if (!listRuns || !isLive) return;
		let cancelled = false;
		const refetch = async () => {
			try {
				const all = await listRuns(run.taskId, 50);
				const fresh = all.find((r) => r.runId === runIdRef.current);
				if (!cancelled && fresh) setRun(fresh);
			} catch {
				// ignore
			}
		};
		let unlistenProgress: (() => void) | undefined;
		let unlistenDone: (() => void) | undefined;
		(async () => {
			unlistenProgress = await listen<{ runId?: string }>("task_run_progress", (e) => {
				if (e.payload?.runId === runIdRef.current) refetch();
			});
			unlistenDone = await listen<{ runId?: string }>("task_run_completed", (e) => {
				if (e.payload?.runId === runIdRef.current) refetch();
			});
		})();
		// One-shot catch-up so we start from the freshest state.
		refetch();
		return () => {
			cancelled = true;
			unlistenProgress?.();
			unlistenDone?.();
		};
	}, [isLive, run.taskId, listRuns]);

	// When new content arrives the run object is replaced; derive a primitive
	// signature of the rendered content (entry count + streaming text length +
	// response length + status) so the scroll effect re-runs on every visible
	// change AND the dep is genuinely read inside the effect.
	const lastEntry = run.conversation?.[(run.conversation?.length ?? 0) - 1];
	const contentSignature = `${run.conversation?.length ?? 0}:${
		lastEntry?.content?.length ?? 0
	}:${run.response?.length ?? 0}:${run.status}`;
	useEffect(() => {
		// read contentSignature so the dep is used; sticking auto-scrolls to newest.
		if (!contentSignature || !stickToBottomRef.current) return;
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [contentSignature]);

	const handleScroll = () => {
		const el = scrollRef.current;
		if (el) stickToBottomRef.current = isNearBottom(el);
	};

	const duration = run.completedAt ? formatDuration(run.startedAt, run.completedAt) : null;

	const statusConfig = {
		pending: { label: "Queued", color: "text-amber-500" },
		running: { label: "Running", color: "text-sky-500" },
		completed: { label: "Success", color: "text-emerald-500" },
		failed: { label: "Failed", color: "text-red-500" },
	}[run.status];

	return (
		<div ref={scrollRef} onScroll={handleScroll} className="flex flex-1 flex-col overflow-y-auto">
			{/* Header */}
			<div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-sm">
				<button
					type="button"
					onClick={onBack}
					className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					aria-label="Back"
				>
					<ArrowLeft className="h-4 w-4" />
				</button>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h1 className="truncate text-sm font-semibold text-foreground">{taskName}</h1>
						<span
							className={`flex items-center gap-1 text-[10px] font-semibold ${statusConfig.color}`}
						>
							{isLive && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
							{statusConfig.label}
						</span>
					</div>
					<p className="mt-px text-[11px] text-muted-foreground/60">
						{formatRelative(run.startedAt)}
						{duration && (
							<>
								{" "}
								· <span className="font-mono">{duration}</span>
							</>
						)}
					</p>
				</div>
			</div>

			{/* Prompt */}
			<div className="px-4 py-4">
				<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
					Instruction
				</p>
				<div className="mt-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm leading-relaxed text-foreground/90">
					{run.prompt}
				</div>
			</div>

			{/* Conversation — shown like ChatView messages */}
			{run.conversation && run.conversation.length > 0 ? (
				<div className="flex-1 space-y-3 px-4 pb-6">
					<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
						Response Steps
					</p>
					{run.conversation.map((entry, i) => (
						<ConversationBlock key={`${entry.type}-${i}`} entry={entry} />
					))}

					{isLive && (
						<div className="flex items-center gap-2 px-1 py-2 text-xs text-sky-500/70">
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
							Working…
						</div>
					)}

					{/* Full response text */}
					{run.response && (
						<div className="rounded-lg border border-border bg-card px-4 py-3">
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">
								Full Response
							</p>
							<p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
								{run.response}
							</p>
						</div>
					)}
				</div>
			) : isLive ? (
				<div className="flex flex-1 items-center justify-center">
					<div className="text-center">
						<Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-sky-500/50" aria-hidden />
						<p className="text-sm font-medium text-muted-foreground">Working…</p>
						<p className="mt-1 text-xs text-muted-foreground/60">
							The agent is executing this task. Steps will appear here live.
						</p>
					</div>
				</div>
			) : (
				<div className="flex flex-1 items-center justify-center">
					<div className="text-center">
						<CalendarClock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
						<p className="text-sm font-medium text-muted-foreground">No conversation data</p>
						<p className="mt-1 text-xs text-muted-foreground/60">
							This run completed but no steps were recorded.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

function ConversationBlock({ entry }: { entry: ConversationEntry }) {
	switch (entry.type) {
		case "thinking":
			return (
				<div className="relative overflow-hidden rounded-lg border border-amber-500/15 bg-gradient-to-br from-amber-500/[0.04] to-amber-500/[0.02] px-4 py-3">
					<div className="absolute left-0 top-0 h-full w-0.5 bg-amber-500/30" />
					<p className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/60 mb-1">
						Thinking
					</p>
					<p className="whitespace-pre-wrap text-sm leading-relaxed italic text-muted-foreground/80">
						{entry.content}
					</p>
				</div>
			);
		case "tool_call":
			return (
				<div className="relative overflow-hidden rounded-lg border border-sky-500/15 bg-gradient-to-br from-sky-500/[0.04] to-sky-500/[0.02] px-4 py-3">
					<div className="absolute left-0 top-0 h-full w-0.5 bg-sky-500/30" />
					<p className="text-[10px] font-semibold uppercase tracking-wider text-sky-500/60 mb-1">
						Tool: {entry.toolName}
					</p>
					{entry.toolArgs && Object.keys(entry.toolArgs).length > 0 && (
						<div className="mt-1 rounded-md bg-background/60 px-3 py-2 font-mono text-xs text-muted-foreground/70">
							{JSON.stringify(entry.toolArgs, null, 2)}
						</div>
					)}
				</div>
			);
		case "tool_result":
			return (
				<div
					className={`relative overflow-hidden rounded-lg border px-4 py-3 ${
						entry.toolError
							? "border-red-500/15 bg-gradient-to-br from-red-500/[0.04] to-red-500/[0.02]"
							: "border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.04] to-emerald-500/[0.02]"
					}`}
				>
					<div
						className={`absolute left-0 top-0 h-full w-0.5 ${entry.toolError ? "bg-red-500/30" : "bg-emerald-500/30"}`}
					/>
					<p
						className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${entry.toolError ? "text-red-500/60" : "text-emerald-500/60"}`}
					>
						{entry.toolError ? "Error" : "Result"}
					</p>
					<p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground/80">
						{entry.toolResult}
					</p>
				</div>
			);
		case "text":
			return (
				<div className="px-1 py-1">
					<p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
						{entry.content}
					</p>
				</div>
			);
		default:
			return null;
	}
}

function formatDuration(start: string, end: string): string {
	const ms = new Date(end).getTime() - new Date(start).getTime();
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${Math.round(ms / 1000)}s`;
	const m = Math.floor(ms / 60000);
	const s = Math.round((ms % 60000) / 1000);
	return `${m}m ${s}s`;
}
