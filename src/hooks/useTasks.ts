/**
 * useTasks — React hook for the pi-routines Tasks bridge (#288, #300).
 *
 * Bridges the sidecar's `tasks_*` commands (which read/write the active cwd's
 * `.pi/cowork_scheduled_tasks.json` directly, no LLM round-trip) to React
 * state, and refetches live on the `tasks_changed` push event the sidecar
 * emits when the file changes (a task fires, or the bridge edits it).
 *
 * #300 additions:
 * - `listRuns(taskId)` — fetches run history for a specific task
 * - `getCompletedTasks()` — fetches completed (non-recurring) tasks
 * - Listens to `task_run_completed` events for live updates
 */

import type { CompletedTask, Task, TaskRun } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import { retryOnClosed } from "@/lib/utils";

interface UseTasksReturn {
	/** All durable tasks (enabled first, then paused). */
	tasks: Task[];
	/** Initial-load / refresh in flight. */
	loading: boolean;
	/** Last error message, if any. */
	error: string | null;

	/** Refetch the task list from the sidecar. */
	refresh: () => Promise<void>;
	/** Delete a task by id. */
	del: (taskId: string) => Promise<void>;
	/** Pause (false) or resume (true) a task by id. */
	setEnabled: (taskId: string, enabled: boolean) => Promise<void>;
	/** Fire a task on pi-routines' next poll (sets nextRunAt into the past). */
	runNow: (taskId: string) => Promise<void>;
	/** Clear the current error. */
	clearError: () => void;

	// #300: Run history
	/** Fetch all runs for a specific task, newest first. */
	listRuns: (taskId: string, limit?: number) => Promise<TaskRun[]>;
	/** Fetch completed (non-recurring) tasks. */
	getCompletedTasks: () => Promise<CompletedTask[]>;
	/** Completed tasks state (auto-refreshed on events). */
	completedTasks: CompletedTask[];
	/** Loading state for completed tasks. */
	completedLoading: boolean;
	/** Monotonic counter incremented on each task_run_completed event. */
	runCompletedAt: number;
}

export function useTasks(): UseTasksReturn {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
	const [completedLoading, setCompletedLoading] = useState(false);

	const refresh = useCallback(async (failed = false) => {
		if (!failed) setLoading(true);
		if (!failed) setError(null);
		try {
			const result = await retryOnClosed(() => invoke<{ tasks?: Task[] } | Task[]>("tasks_list"));
			const list = Array.isArray(result) ? result : (result as { tasks?: Task[] }).tasks || [];
			setTasks(list);
			setError(null);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg);
			// Auto-retry once after a short delay (sidecar might still be initing)
			if (!failed) {
				setTimeout(() => refresh(true), 2000);
			}
		} finally {
			if (!failed) setLoading(false);
		}
	}, []);

	const refreshCompleted = useCallback(async () => {
		setCompletedLoading(true);
		try {
			const result = await retryOnClosed(() =>
				invoke<{ completed?: CompletedTask[] } | CompletedTask[]>("tasks_get_completed"),
			);
			const list = Array.isArray(result)
				? result
				: (result as { completed?: CompletedTask[] }).completed || [];
			setCompletedTasks(list);
		} catch {
			// Silently ignore — completed tasks are non-critical
		} finally {
			setCompletedLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
		refreshCompleted();
	}, [refresh, refreshCompleted]);

	// Live updates: the sidecar emits `tasks_changed` whenever the task file
	// changes (pi-routines fires a task, or the bridge mutates it). Refetch.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let mounted = true;
		listen("tasks_changed", () => {
			refresh();
		}).then((fn) => {
			if (mounted) unlisten = fn;
			else fn();
		});
		return () => {
			mounted = false;
			unlisten?.();
		};
	}, [refresh]);

	// Live updates for run completion (#300): when a task finishes executing,
	// refresh both the task list, the completed tasks list, and trigger
	// run-list refresh via a counter that drives TaskDetailPage's re-fetch.
	const [runCompletedAt, setRunCompletedAt] = useState(0);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let mounted = true;
		listen("task_run_completed", (_event) => {
			refresh();
			refreshCompleted();
			setRunCompletedAt(Date.now());
		}).then((fn) => {
			if (mounted) unlisten = fn;
			else fn();
		});
		return () => {
			mounted = false;
			unlisten?.();
		};
	}, [refreshCompleted, refresh]);

	const del = useCallback(
		async (taskId: string) => {
			setError(null);
			try {
				await invoke("tasks_delete", { taskId });
				await refresh();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[refresh],
	);

	const setEnabled = useCallback(async (taskId: string, enabled: boolean) => {
		setError(null);
		try {
			await invoke("tasks_set_enabled", { taskId, enabled });
			// Optimistic; the `tasks_changed` event reconciles authoritatively.
			setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, enabled } : t)));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const runNow = useCallback(async (taskId: string) => {
		setError(null);
		try {
			await invoke("tasks_run_now", { taskId });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const listRuns = useCallback(async (taskId: string, limit = 50): Promise<TaskRun[]> => {
		try {
			const result = await retryOnClosed(() =>
				invoke<{ runs?: TaskRun[] } | TaskRun[]>("tasks_list_runs", { taskId, limit }),
			);
			return Array.isArray(result) ? result : (result as { runs?: TaskRun[] }).runs || [];
		} catch {
			return [];
		}
	}, []);

	const getCompletedTasks = useCallback(async (): Promise<CompletedTask[]> => {
		try {
			const result = await retryOnClosed(() =>
				invoke<{ completed?: CompletedTask[] } | CompletedTask[]>("tasks_get_completed"),
			);
			return Array.isArray(result)
				? result
				: (result as { completed?: CompletedTask[] }).completed || [];
		} catch {
			return [];
		}
	}, []);

	const clearError = useCallback(() => setError(null), []);

	return {
		tasks,
		loading,
		error,
		refresh,
		del,
		setEnabled,
		runNow,
		clearError,
		listRuns,
		getCompletedTasks,
		completedTasks,
		completedLoading,
		runCompletedAt,
	};
}
