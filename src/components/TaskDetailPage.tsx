/**
 * TaskDetailPage — the main-pane detail view for a scheduled task (#289, #300).
 *
 * Shows the full task, expose manage actions, and (#300) includes a "Runs"
 * section (expanded by default) with a game-like timeline of past executions.
 */

import { formatRelative, humanizeCron } from "@/lib/cron";
import type { ConversationEntry, Task, TaskRun } from "@/types";
import {
	CalendarClock,
	ChevronDown,
	ChevronRight,
	Eye,
	Pause,
	Play,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { RunDetailView } from "./RunDetailView";

interface TaskDetailPageProps {
	task: Task | null;
	error?: string | null;
	onRunNow: (id: string) => Promise<void> | void;
	onSetEnabled: (id: string, enabled: boolean) => Promise<void> | void;
	onDelete: (id: string) => Promise<void> | void;
	onClose: () => void;
	listRuns?: (taskId: string, limit?: number) => Promise<TaskRun[]>;
}

export function TaskDetailPage({
	task,
	error,
	onRunNow,
	onSetEnabled,
	onDelete,
	onClose,
	listRuns,
}: TaskDetailPageProps) {
	const [busy, setBusy] = useState<null | "run" | "toggle" | "delete">(null);
	const [runs, setRuns] = useState<TaskRun[]>([]);
	const [runsLoading, setRunsLoading] = useState(false);
	const [selectedRun, setSelectedRun] = useState<TaskRun | null>(null);

	const taskId = task?.id;
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Fetch the runs list. `silent` updates data WITHOUT toggling the loading
	// state — critical so background refreshes don't unmount the list (which
	// would flash a spinner and reset the scroll position).
	const fetchRuns = useCallback(
		async (silent = false) => {
			if (!taskId || !listRuns) return [] as TaskRun[];
			if (!silent) setRunsLoading(true);
			try {
				const fresh = await listRuns(taskId, 20);
				setRuns(fresh);
				return fresh;
			} catch {
				if (!silent) setRuns([]);
				return [] as TaskRun[];
			} finally {
				if (!silent) setRunsLoading(false);
			}
		},
		[taskId, listRuns],
	);

	// Load runs once on mount / task change. NO background polling — the list
	// only refreshes on demand (after pressing "Run now"; see `run()` below).
	useEffect(() => {
		fetchRuns();
	}, [fetchRuns]);

	// Stop any in-progress poll when the task changes or we unmount.
	useEffect(() => {
		return () => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		};
	}, []);

	// When viewing a run detail, render the full-page view (#300).
	// NOTE: must come AFTER all hooks to satisfy Rules of Hooks.
	if (selectedRun && task) {
		return (
			<RunDetailView
				run={selectedRun}
				taskName={task.name || "Untitled task"}
				onBack={() => setSelectedRun(null)}
				listRuns={listRuns}
			/>
		);
	}

	if (!task) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
				<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
					<CalendarClock className="h-6 w-6" />
				</div>
				<p className="text-sm font-medium text-foreground">Select a task</p>
				<p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
					Pick a scheduled task from the list to see its details, runs, and actions.
				</p>
			</div>
		);
	}

	const run = async () => {
		setBusy("run");
		// Snapshot existing run IDs so we can detect the NEW run appearing.
		const knownRunIds = new Set(runs.map((r) => r.runId));
		try {
			await onRunNow(task.id);
		} finally {
			setBusy(null);
		}
		// Silently poll the list (data only — no spinner, no scroll reset) until
		// the new run shows up, then STOP. The scheduler writes a pending record
		// within ~1s of firing.
		if (pollRef.current) clearInterval(pollRef.current);
		const deadline = Date.now() + 15_000; // give up after 15s
		pollRef.current = setInterval(async () => {
			const fresh = await fetchRuns(true);
			const appeared = fresh.some((r) => !knownRunIds.has(r.runId));
			if (appeared || Date.now() > deadline) {
				if (pollRef.current) {
					clearInterval(pollRef.current);
					pollRef.current = null;
				}
			}
		}, 1500);
	};
	const toggle = async () => {
		setBusy("toggle");
		try {
			await onSetEnabled(task.id, !task.enabled);
		} finally {
			setBusy(null);
		}
	};
	const remove = async () => {
		setBusy("delete");
		try {
			await onDelete(task.id);
			onClose();
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{/* Header */}
			<div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h1 className="truncate text-lg font-semibold text-foreground">
							{task.name || "Untitled task"}
						</h1>
						<StatusBadge enabled={task.enabled} />
					</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{humanizeCron(task.schedule)} · {task.recurring ? "recurring" : "one-shot"}
					</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close task detail"
					className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			{error && (
				<div className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{error}
				</div>
			)}

			{/* Actions */}
			<div className="flex flex-wrap gap-2 px-6 py-4">
				<button
					type="button"
					onClick={run}
					disabled={!task.enabled || busy !== null}
					title={task.enabled ? "Run now" : "Enable the task to run it now"}
					className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
				>
					<Play className="h-3.5 w-3.5" />
					Run now
				</button>
				<button
					type="button"
					onClick={toggle}
					disabled={busy !== null}
					className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
				>
					{task.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
					{task.enabled ? "Pause" : "Enable"}
				</button>
				<button
					type="button"
					onClick={remove}
					disabled={busy !== null}
					className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
				>
					<Trash2 className="h-3.5 w-3.5" />
					Delete
				</button>
			</div>

			{/* Prompt */}
			<section className="px-6 py-2">
				<FieldLabel>Prompt</FieldLabel>
				<div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
					{task.prompt}
				</div>
			</section>

			{/* Metadata grid */}
			<section className="grid grid-cols-1 gap-x-8 gap-y-3 px-6 py-4 sm:grid-cols-2">
				<Field label="Schedule (cron)" value={task.schedule} mono />
				<Field label="Type" value={task.type} />
				<Field label="Next run" value={task.enabled ? formatRelative(task.nextRunAt) : "—"} />
				<Field label="Last run" value={formatRelative(task.lastRunAt)} />
				<Field label="Recurring" value={task.recurring ? "Yes" : "No (one-shot)"} />
				<Field label="Created" value={formatRelative(task.createdAt)} />
			</section>

			{/* Runs section (#300) — expanded by default */}
			{listRuns && (
				<section className="border-t border-border px-6 py-5">
					<div className="flex items-center gap-2 mb-4">
						<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
							Run Log
						</span>
						{runs.length > 0 && (
							<span className="inline-flex items-center justify-center rounded-full bg-primary/10 px-2 py-px text-[10px] font-medium text-primary">
								{runs.length}
							</span>
						)}
					</div>

					{runsLoading && (
						<div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
							<div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/50" />
							Loading runs…
						</div>
					)}

					{!runsLoading && runs.length === 0 && (
						<div className="rounded-lg border-2 border-dashed border-border bg-muted/20 px-5 py-6 text-center">
							<p className="text-xs font-medium text-muted-foreground">No runs yet</p>
							<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/60">
								When this task fires, each execution appears here with its prompt and response.
								Click <span className="font-medium text-foreground/80">&ldquo;Run now&rdquo;</span>{" "}
								above to trigger one.
							</p>
						</div>
					)}

					{!runsLoading && runs.length > 0 && (
						<div className="relative space-y-3">
							{/* Timeline line */}
							<div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/60" />

							{runs.map((run, idx) => (
								<RunCard
									key={run.runId}
									run={run}
									isLatest={idx === 0}
									onViewRun={() => setSelectedRun(run)}
								/>
							))}
						</div>
					)}
				</section>
			)}
		</div>
	);
}

function RunCard({
	run,
	isLatest,
	onViewRun,
}: { run: TaskRun; isLatest: boolean; onViewRun?: () => void }) {
	const [stepsExpanded, setStepsExpanded] = useState(false);
	const duration = run.completedAt ? formatDuration(run.startedAt, run.completedAt) : null;

	const statusConfig = {
		pending: {
			icon: "⏳",
			label: "Queued",
			color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
		},
		running: {
			icon: "🔄",
			label: "Running",
			color: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
		},
		completed: {
			icon: "✓",
			label: "Success",
			color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
		},
		failed: {
			icon: "✕",
			label: "Failed",
			color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
		},
	}[run.status];

	return (
		<div className="relative pl-8">
			{/* Timeline dot */}
			<div
				className={`absolute left-0 top-1.5 h-6 w-6 rounded-full border-2 flex items-center justify-center text-[11px] font-bold ${
					isLatest && run.status === "completed"
						? "border-emerald-500/60 bg-emerald-500/15 text-emerald-500 shadow-[0_0_8px_-2px_hsl(160_60%_45%/0.4)]"
						: run.status === "failed"
							? "border-red-500/40 bg-red-500/10 text-red-500"
							: "border-muted-foreground/30 bg-background text-muted-foreground"
				}`}
			>
				{statusConfig.icon}
			</div>

			{/* Card */}
			<div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
				{/* Top row: status badge + timestamp + duration */}
				<div className="flex items-center gap-2 flex-wrap">
					<span
						className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10px] font-semibold ${statusConfig.color}`}
					>
						{statusConfig.label}
					</span>
					<span className="text-[11px] text-muted-foreground/70">
						{formatRelative(run.startedAt)}
					</span>
					{duration && (
						<>
							<span className="text-[10px] text-muted-foreground/40" aria-hidden>
								·
							</span>
							<span className="text-[10px] font-mono text-muted-foreground/50">{duration}</span>
						</>
					)}
					{isLatest && (
						<span className="ml-auto text-[9px] font-semibold uppercase tracking-wider text-emerald-500/70">
							Latest
						</span>
					)}
					{onViewRun && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onViewRun();
							}}
							className="ml-2 shrink-0 rounded-md border border-border px-2 py-0.5 text-[9px] font-medium text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
						>
							<Eye className="mr-1 inline-block h-3 w-3" />
							View run
						</button>
					)}
				</div>

				{/* Prompt */}
				<div className="mt-2.5">
					<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
						Instruction
					</p>
					<p className="mt-0.5 line-clamp-2 text-xs text-foreground/85">{run.prompt}</p>
				</div>

				{/* Conversation tree — collapsible (#300) */}
				{run.conversation && run.conversation.length > 0 && (
					<div className="mt-2">
						<button
							type="button"
							onClick={() => setStepsExpanded(!stepsExpanded)}
							className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 hover:bg-muted/30"
						>
							{stepsExpanded ? (
								<ChevronDown className="h-3 w-3" />
							) : (
								<ChevronRight className="h-3 w-3" />
							)}
							Steps
							<span className="ml-auto rounded bg-muted/50 px-1.5 py-px text-[9px] font-normal normal-case tracking-normal text-muted-foreground/50">
								{run.conversation.length}
							</span>
						</button>
						{stepsExpanded && (
							<div className="mt-1.5 space-y-1">
								{run.conversation.map((entry, i) => (
									<ConversationStep key={`${entry.type}-${i}`} entry={entry} />
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function ConversationStep({ entry }: { entry: ConversationEntry }) {
	switch (entry.type) {
		case "thinking":
			return (
				<div className="group relative overflow-hidden rounded-lg border border-amber-500/15 bg-gradient-to-br from-amber-500/[0.04] to-amber-500/[0.02] px-3 py-2">
					{/* Accent bar */}
					<div className="absolute left-0 top-0 h-full w-0.5 bg-amber-500/30" />
					<div className="flex items-start gap-2">
						<span className="mt-0.5 shrink-0 text-[11px] opacity-60">
							<svg
								aria-hidden="true"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="text-amber-500/70"
							>
								<path d="M12 2a10 10 0 1 0 10 10h-10V2Z" />
								<path d="M22 12A10 10 0 0 0 12 2v10h10Z" />
							</svg>
						</span>
						<div className="min-w-0 flex-1">
							<p className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/60">
								Thinking
							</p>
							<p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed italic text-muted-foreground/70">
								{entry.content?.slice(0, 200)}
							</p>
						</div>
					</div>
				</div>
			);
		case "tool_call":
			return (
				<div className="group relative overflow-hidden rounded-lg border border-sky-500/15 bg-gradient-to-br from-sky-500/[0.04] to-sky-500/[0.02] px-3 py-2">
					{/* Accent bar */}
					<div className="absolute left-0 top-0 h-full w-0.5 bg-sky-500/30" />
					<div className="flex items-start gap-2">
						<span className="mt-0.5 shrink-0 text-[11px] opacity-60">
							<svg
								aria-hidden="true"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="text-sky-500/70"
							>
								<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
							</svg>
						</span>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-1.5 flex-wrap">
								<span className="text-[10px] font-semibold uppercase tracking-wider text-sky-500/60">
									Tool
								</span>
								<span className="truncate rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
									{entry.toolName}
								</span>
							</div>
							{entry.toolArgs && Object.keys(entry.toolArgs).length > 0 && (
								<div className="mt-1.5 rounded-md bg-background/50 px-2 py-1 font-mono text-[10px] text-muted-foreground/70">
									{formatToolArgs(entry.toolArgs)}
								</div>
							)}
						</div>
					</div>
				</div>
			);
		case "tool_result":
			return (
				<div
					className={`group relative overflow-hidden rounded-lg border px-3 py-2 ${
						entry.toolError
							? "border-red-500/15 bg-gradient-to-br from-red-500/[0.04] to-red-500/[0.02]"
							: "border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.04] to-emerald-500/[0.02]"
					}`}
				>
					<div
						className={`absolute left-0 top-0 h-full w-0.5 ${entry.toolError ? "bg-red-500/30" : "bg-emerald-500/30"}`}
					/>
					<div className="flex items-start gap-2">
						<span className="mt-0.5 shrink-0 text-[11px] opacity-60">
							{entry.toolError ? (
								<svg
									aria-hidden="true"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="text-red-500/70"
								>
									<circle cx="12" cy="12" r="10" />
									<line x1="15" y1="9" x2="9" y2="15" />
									<line x1="9" y1="9" x2="15" y2="15" />
								</svg>
							) : (
								<svg
									aria-hidden="true"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="text-emerald-500/70"
								>
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
									<polyline points="14 2 14 8 20 8" />
									<line x1="12" y1="18" x2="12" y2="12" />
									<line x1="9" y1="15" x2="15" y2="15" />
								</svg>
							)}
						</span>
						<div className="min-w-0 flex-1">
							<p
								className={`text-[10px] font-semibold uppercase tracking-wider ${entry.toolError ? "text-red-500/60" : "text-emerald-500/60"}`}
							>
								{entry.toolError ? "Error" : "Result"}
							</p>
							<p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70">
								{entry.toolResult?.slice(0, 200)}
							</p>
						</div>
					</div>
				</div>
			);
		case "text":
			return (
				<div className="flex items-start gap-2 px-1 py-0.5">
					<span className="mt-0.5 shrink-0 text-foreground/40">
						<svg
							aria-hidden="true"
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
					</span>
					<p className="line-clamp-3 text-[11px] leading-relaxed text-foreground/70">
						{entry.content}
					</p>
				</div>
			);
		default:
			return null;
	}
}

/** Format tool arguments as a compact single-line string. */
function formatToolArgs(args: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		const strValue = typeof value === "string" ? value : JSON.stringify(value);
		if (strValue.length > 60) {
			parts.push(`${key}: ${strValue.slice(0, 57)}...`);
		} else {
			parts.push(`${key}: ${strValue}`);
		}
	}
	return parts.join("  ");
}

function formatDuration(start: string, end: string): string {
	const ms = new Date(end).getTime() - new Date(start).getTime();
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${Math.round(ms / 1000)}s`;
	const m = Math.floor(ms / 60000);
	const s = Math.round((ms % 60000) / 1000);
	return `${m}m ${s}s`;
}

function StatusBadge({ enabled }: { enabled: boolean }) {
	return (
		<span
			className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
				enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
			}`}
		>
			{enabled ? "Active" : "Paused"}
		</span>
	);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
	return (
		<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
			{children}
		</span>
	);
}

function Field({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="min-w-0">
			<FieldLabel>{label}</FieldLabel>
			<p className={`mt-0.5 truncate text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}>
				{value}
			</p>
		</div>
	);
}
