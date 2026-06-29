/**
 * TasksList — the sidebar list of scheduled tasks (#289, #300).
 *
 * Replaces the #287 `TasksPanel` placeholder. Renders one row per task with its
 * name, human-readable schedule, next-run, a recurring/one-shot badge and a
 * paused indicator. Clicking a row selects it (the detail page renders in the
 * main pane). Data + live updates come from the parent via the shared
 * `useTasks()` instance — this component is purely presentational.
 *
 * #300: Adds a "Completed" collapsible group at the bottom for non-recurring
 * tasks that have been executed and are no longer active.
 */

import { formatRelative, humanizeCron } from "@/lib/cron";
import type { CompletedTask, Task } from "@/types";
import { ChevronDown, ChevronRight, ListChecks, Pause, Repeat } from "lucide-react";
import { useState } from "react";

interface TasksListProps {
	tasks: Task[];
	loading: boolean;
	error: string | null;
	selectedTaskId?: string | null;
	onSelect: (id: string) => void;
	/** #300: Completed (non-recurring) tasks. */
	completedTasks?: CompletedTask[];
	completedLoading?: boolean;
}

export function TasksList({
	tasks,
	loading,
	error,
	selectedTaskId,
	onSelect,
	completedTasks = [],
	completedLoading = false,
}: TasksListProps) {
	const [completedExpanded, setCompletedExpanded] = useState(false);

	if (loading && tasks.length === 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/50" />
			</div>
		);
	}

	if (error && tasks.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center px-6 text-center">
				<p className="text-sm font-medium text-destructive">Couldn't load tasks</p>
				<p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/50">{error}</p>
			</div>
		);
	}

	if (tasks.length === 0 && completedTasks.length === 0) {
		return <TasksEmptyState />;
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto px-2 py-2">
			{/* Active tasks */}
			{tasks.length > 0 && (
				<ul className="flex flex-col gap-1">
					{tasks.map((task) => (
						<li key={task.id}>
							<TaskRow
								task={task}
								selected={task.id === selectedTaskId}
								onSelect={() => onSelect(task.id)}
							/>
						</li>
					))}
				</ul>
			)}

			{/* Completed tasks (#300) */}
			{completedTasks.length > 0 && (
				<div className="mt-3 border-t border-sidebar-border/40 pt-2">
					<button
						type="button"
						onClick={() => setCompletedExpanded(!completedExpanded)}
						className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 hover:text-sidebar-foreground/70"
					>
						{completedExpanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)}
						Completed
						<span className="ml-auto rounded bg-sidebar-accent/50 px-1 py-px text-[9px] font-normal normal-case tracking-normal text-sidebar-foreground/50">
							{completedTasks.length}
						</span>
					</button>

					{completedExpanded && (
						<ul className="mt-1 flex flex-col gap-1">
							{completedTasks.map((ct) => (
								<li key={ct.taskId}>
									<CompletedTaskRow completed={ct} />
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			{/* Completed loading state */}
			{completedLoading && tasks.length > 0 && (
				<div className="mt-3 flex items-center justify-center gap-2 py-2 text-[10px] text-sidebar-foreground/40">
					<div className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-sidebar-foreground/20 border-t-sidebar-foreground/50" />
					Loading completed…
				</div>
			)}
		</div>
	);
}

function TaskRow({
	task,
	selected,
	onSelect,
}: {
	task: Task;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-current={selected}
			className={`group w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
				selected
					? "bg-sidebar-accent text-sidebar-foreground"
					: "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
			}`}
		>
			<div className="flex items-center gap-1.5">
				<span className={`truncate text-xs font-medium ${task.enabled ? "" : "opacity-60"}`}>
					{task.name || "Untitled task"}
				</span>
				{!task.enabled && (
					<Pause className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Paused" />
				)}
			</div>
			<div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-sidebar-foreground/45">
				{task.recurring ? (
					<Repeat className="h-2.5 w-2.5 shrink-0" aria-label="Recurring" />
				) : (
					<span className="shrink-0 rounded bg-muted/60 px-1 py-px text-[9px] uppercase tracking-wide">
						once
					</span>
				)}
				<span className="truncate">{humanizeCron(task.schedule)}</span>
				<span aria-hidden>·</span>
				<span className="shrink-0">
					{task.enabled ? `next ${formatRelative(task.nextRunAt)}` : "paused"}
				</span>
			</div>
		</button>
	);
}

function CompletedTaskRow({ completed }: { completed: CompletedTask }) {
	return (
		<div className="w-full rounded-lg px-2.5 py-2 text-left opacity-60">
			<div className="flex items-center gap-1.5">
				<span className="truncate text-xs font-medium text-sidebar-foreground">
					{completed.name || "Completed task"}
				</span>
				<span className="shrink-0 text-[9px] uppercase tracking-wide text-sidebar-foreground/40">
					done
				</span>
			</div>
			<div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-sidebar-foreground/35">
				<span>completed {formatRelative(completed.lastRun.startedAt)}</span>
			</div>
		</div>
	);
}

function TasksEmptyState() {
	return (
		<div className="flex h-full flex-col items-center justify-center px-6 text-center">
			<div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
				<ListChecks className="h-5 w-5" />
			</div>
			<p className="text-sm font-medium text-sidebar-foreground">No tasks yet</p>
			<p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/50">
				Ask in a Cowork chat to schedule a task — for example, "every weekday at 9am summarize my
				unread email." Scheduled tasks will show up here.
			</p>
		</div>
	);
}
