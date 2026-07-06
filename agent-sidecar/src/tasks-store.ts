/**
 * tasks-store — sidecar bridge for the pi-routines scheduled-task store.
 *
 * The Tasks UI must read/write scheduled tasks WITHOUT round-tripping the LLM.
 * pi-routines exposes `cron_create`/`cron_delete`/`cron_list` only as *agent
 * tools* (LLM-facing) and has no `set_enabled`/`run_now` tool at all, so this
 * module talks to pi-routines' on-disk source of truth directly.
 *
 * ── V3 (#300): Shared task file ─────────────────────────────────────────────
 * The pi CLI and Cowork GUI share the same task file
 * (.pi/scheduled_tasks.json) and lock (.pi/scheduled_tasks.lock).
 * One source of truth — tasks created via either interface appear in both.
 *
 *   .pi/scheduled_tasks.json           ← shared durable tasks
 *   .pi/scheduled_tasks_disabled.json   ← bridge-owned paused tasks
 *   .pi/task_runs/<taskId>.jsonl        ← run history (recorded by the fork)
 *
 * Run recording is done by the forked pi-routines inside the sidecar's process
 * when a task fires via `onFireCallback`. This bridge reads those run records.
 *
 * ── enabled / paused semantics ──────────────────────────────────────────────
 * pi-routines has NO `enabled`/`paused` concept: every task in `tasks[]` with a
 * `nextRunAt` fires, and its scheduler RE-DERIVES `nextRunAt` from the cron
 * `schedule` whenever it's missing. Worse, pi-routines' own `writeDurableFile`
 * only persists `{ version, tasks }` — any extra top-level key we add (e.g. a
 * `disabled` array) is silently wiped the next time *any* task fires.
 *
 * So "pause" can't live inside the task file. Instead the bridge keeps paused
 * tasks in a SEPARATE, bridge-owned file pi-routines never touches.
 *
 * `set_enabled(false)` MOVES a task out of the active file into the disabled
 * file (so pi-routines stops seeing it); `set_enabled(true)` moves it back
 * (stripping `nextRunAt` so pi-routines recomputes a fresh forward run).
 */

import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	type FSWatcher,
	watch,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export type TaskType = "durable" | "session";

/** Mirrors pi-routines' `ScheduledTask` (src/cronTasks.ts). */
export interface ScheduledTask {
	id: string;
	name: string;
	/** cron expression, e.g. "* * * * *" */
	schedule: string;
	/** message sent to the agent when the task fires */
	prompt: string;
	type: TaskType;
	/** ISO timestamp */
	createdAt: string;
	lastRunAt?: string;
	nextRunAt?: string;
	recurring: boolean;
	/** auto-expire recurring tasks after N days of inactivity (0 = permanent) */
	maxAgeDays: number;
	sessionId?: string;
}

/** A task plus the bridge-derived `enabled` flag the UI renders. */
export interface BridgeTask extends ScheduledTask {
	enabled: boolean;
}

/**
 * A run record for a scheduled task. Stored in
 * `.pi/task_runs/<taskId>.jsonl` by the forked pi-routines.
 */
export interface ConversationEntry {
	type: "thinking" | "text" | "tool_call" | "tool_result";
	content?: string;
	toolName?: string;
	toolArgs?: Record<string, unknown>;
	toolResult?: string;
	toolError?: boolean;
}

export interface TaskRun {
	runId: string;
	taskId: string;
	prompt: string;
	response?: string;
	status: "pending" | "running" | "completed" | "failed";
	startedAt: string;
	completedAt?: string;
	sessionId?: string;
	/** Full run conversation (live steps), written incrementally by the fork. */
	conversation?: ConversationEntry[];
}

interface DurableTaskFile {
	version: 1;
	tasks: ScheduledTask[];
}

/** Default pi-routines task file: `<cwd>/.pi/scheduled_tasks.json`. Shared with pi CLI. */
export function tasksFilePath(cwd: string): string {
	return join(cwd, ".pi", "scheduled_tasks.json");
}

/** Bridge-owned paused-task file: `<cwd>/.pi/scheduled_tasks_disabled.json`. */
export function disabledTasksFilePath(cwd: string): string {
	return join(cwd, ".pi", "scheduled_tasks_disabled.json");
}

/** Run-records directory: `<cwd>/.pi/task_runs/`. */
export function taskRunsDir(cwd: string): string {
	return join(cwd, ".pi", "task_runs");
}

/**
 * Read a `{ version: 1, tasks: [...] }` file, tolerant of an absent/corrupt
 * file (returns an empty store). Mirrors pi-routines' own `readDurableFile`.
 */
function readTaskFile(path: string): DurableTaskFile {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (parsed && parsed.version === 1 && Array.isArray(parsed.tasks)) {
			return parsed as DurableTaskFile;
		}
	} catch {
		// absent or malformed — treat as empty
	}
	return { version: 1, tasks: [] };
}

/** Write a task file (pretty-printed), creating `.pi/` if needed. */
function writeTaskFile(path: string, data: DurableTaskFile): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * List all durable tasks for `cwd`: enabled tasks (from the Cowork-private
 * task file) annotated `enabled: true`, followed by paused tasks (from the
 * bridge's disabled file) annotated `enabled: false`.
 */
export function listTasks(cwd: string): BridgeTask[] {
	const active = readTaskFile(tasksFilePath(cwd)).tasks.map((t) => ({
		...t,
		enabled: true,
	}));
	const disabled = readTaskFile(disabledTasksFilePath(cwd)).tasks.map((t) => ({
		...t,
		enabled: false,
	}));
	return [...active, ...disabled];
}

/**
 * Delete a task by id from whichever file holds it. Returns `true` if a task
 * was removed.
 */
export function deleteTask(cwd: string, taskId: string): boolean {
	for (const filePath of [tasksFilePath(cwd), disabledTasksFilePath(cwd)]) {
		const file = readTaskFile(filePath);
		const before = file.tasks.length;
		file.tasks = file.tasks.filter((t) => t.id !== taskId);
		if (file.tasks.length < before) {
			writeTaskFile(filePath, file);
			return true;
		}
	}
	return false;
}

/**
 * Pause/resume a task by MOVING it between the active file and the bridge's
 * disabled file (see module header for why a flag in-file can't work).
 *
 * - `enabled: false` → move active → disabled (pi-routines stops seeing it).
 * - `enabled: true`  → move disabled → active, clearing `nextRunAt` so
 *   pi-routines recomputes the next run from the cron `schedule`.
 *
 * No-op (returns `true`) if the task is already in the requested state.
 * Returns `false` if the task id exists in neither file.
 */
export function setTaskEnabled(
	cwd: string,
	taskId: string,
	enabled: boolean,
): boolean {
	const activePath = tasksFilePath(cwd);
	const disabledPath = disabledTasksFilePath(cwd);
	const from = enabled ? disabledPath : activePath;
	const to = enabled ? activePath : disabledPath;

	const fromFile = readTaskFile(from);
	const task = fromFile.tasks.find((t) => t.id === taskId);

	if (!task) {
		// Already in the destination state? Treat as a successful no-op.
		const toFile = readTaskFile(to);
		return toFile.tasks.some((t) => t.id === taskId);
	}

	// Remove from source.
	fromFile.tasks = fromFile.tasks.filter((t) => t.id !== taskId);

	// Add to destination. When re-enabling, drop nextRunAt so pi-routines
	// derives a fresh forward run rather than firing a stale backlog.
	const moved: ScheduledTask = { ...task };
	if (enabled) delete moved.nextRunAt;

	const toFile = readTaskFile(to);
	toFile.tasks = toFile.tasks.filter((t) => t.id !== taskId);
	toFile.tasks.push(moved);

	// Write destination first, then source: if we crash between writes the task
	// is briefly visible in both files (harmless dup) rather than lost.
	writeTaskFile(to, toFile);
	writeTaskFile(from, fromFile);
	return true;
}

/**
 * Fire a task on pi-routines' next poll by setting its `nextRunAt` ~5s in the
 * past (the exact trick the #286 spike used). Only operates on ENABLED tasks —
 * a paused task must be re-enabled first.
 *
 * Returns `false` if the id isn't an enabled task. Throws if the id refers to a
 * disabled task (so the UI can surface "enable it first").
 */
export function runTaskNow(cwd: string, taskId: string): boolean {
	const activePath = tasksFilePath(cwd);
	const file = readTaskFile(activePath);
	const task = file.tasks.find((t) => t.id === taskId);

	if (!task) {
		const disabled = readTaskFile(disabledTasksFilePath(cwd));
		if (disabled.tasks.some((t) => t.id === taskId)) {
			throw new Error(
				`Task ${taskId} is disabled — enable it before running it now.`,
			);
		}
		return false;
	}

	// Set nextRunAt far enough in the past to overcome the jitter delay.
	// Recurring tasks get up to 15min of forward jitter, so we punch
	// through that by going 16 minutes back. This guarantees the task
	// fires on the scheduler's very next 1s tick.
	task.nextRunAt = new Date(Date.now() - 60_000 * 16).toISOString();
	writeTaskFile(activePath, file);
	return true;
}

/** Fields the bridge accepts when creating a task (see {@link createTask}). */
export interface CreateTaskInput {
	/** Human-readable label shown in the Tasks UI. */
	name: string;
	/** cron expression, e.g. every 5 min = star-slash-5 star star star star. */
	schedule: string;
	/** Message sent to the agent each time the task fires. */
	prompt: string;
	type?: TaskType;
	recurring?: boolean;
	/** Auto-expire after N days of inactivity (0 = permanent). */
	maxAgeDays?: number;
	sessionId?: string;
	/**
	 * Fire on the scheduler's very next poll instead of waiting for the first
	 * cron boundary. Backs the `/loop … (runs immediately)` composer command.
	 */
	runImmediately?: boolean;
}

/**
 * Create a new durable task in `cwd`'s active (pi-routines) task file and
 * return it with the bridge-derived `enabled: true` flag.
 *
 * When `runImmediately` is set, `nextRunAt` is stamped ~16min in the past (the
 * same trick {@link runTaskNow} uses) so pi-routines fires it on its next 1s
 * tick; otherwise pi-routines derives the first run from the cron `schedule`.
 */
export function createTask(cwd: string, input: CreateTaskInput): BridgeTask {
	const activePath = tasksFilePath(cwd);
	const file = readTaskFile(activePath);
	const now = new Date();

	const task: ScheduledTask = {
		id: randomUUID(),
		name: input.name,
		schedule: input.schedule,
		prompt: input.prompt,
		type: input.type ?? "session",
		createdAt: now.toISOString(),
		recurring: input.recurring ?? true,
		maxAgeDays: input.maxAgeDays ?? 0,
		...(input.sessionId ? { sessionId: input.sessionId } : {}),
	};

	if (input.runImmediately) {
		// Match runTaskNow: punch through pi-routines' forward jitter so the
		// first run happens on the scheduler's next tick.
		task.nextRunAt = new Date(now.getTime() - 60_000 * 16).toISOString();
	}

	file.tasks.push(task);
	writeTaskFile(activePath, file);
	return { ...task, enabled: true };
}

// ── Run recording (reads the jsonl files written by the forked pi-routines) ──

/**
 * List all runs for a specific task, newest first.
 * Reads from `.pi/task_runs/<taskId>.jsonl`.
 */
export function listRuns(cwd: string, taskId: string, limit = 50): TaskRun[] {
	const runFile = join(taskRunsDir(cwd), `${taskId}.jsonl`);
	if (!existsSync(runFile)) return [];

	const lines = readFileSync(runFile, "utf-8").split("\n").filter(Boolean);
	const runs: TaskRun[] = [];
	for (const line of lines) {
		try {
			runs.push(JSON.parse(line) as TaskRun);
		} catch {
			// Skip malformed lines
		}
	}
	// Newest first
	runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
	return runs.slice(0, limit);
}

/**
 * Get completed (non-recurring) tasks — ones that have fired and are no longer
 * in the active tasks list. Reconstructed from run records.
 *
 * Returns data suitable for the "Completed" section in the Tasks UI.
 */
export function getCompletedTasks(
	cwd: string,
): { taskId: string; name: string; lastRun: TaskRun }[] {
	const dir = taskRunsDir(cwd);
	if (!existsSync(dir)) return [];

	const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
	const completed: Map<string, { taskId: string; name: string; lastRun: TaskRun }> = new Map();

	for (const file of files) {
		const taskId = file.replace(".jsonl", "");
		// Skip active tasks (still in the tasks or disabled file)
		if (
			readTaskFile(tasksFilePath(cwd)).tasks.some((t) => t.id === taskId) ||
			readTaskFile(disabledTasksFilePath(cwd)).tasks.some((t) => t.id === taskId)
		) {
			continue;
		}

		const runFile = join(dir, file);
		const lines = readFileSync(runFile, "utf-8").split("\n").filter(Boolean);
		if (lines.length === 0) continue;

		// Last line (most recent) is the last run
		let lastRun: TaskRun | null = null;
		for (const line of lines) {
			try {
				const run = JSON.parse(line) as TaskRun;
				if (run.status === "completed" || run.status === "failed") {
					lastRun = run;
				}
			} catch {
				// skip
			}
		}

		if (!lastRun) continue;

		// Try to find the name from the last active task record or use prompt
		const name = lastRun.prompt.slice(0, 60);
		completed.set(taskId, { taskId, name, lastRun });
	}

	return Array.from(completed.values()).sort(
		(a, b) => new Date(b.lastRun.startedAt).getTime() - new Date(a.lastRun.startedAt).getTime(),
	);
}

/** Filenames (under `.pi/`) whose changes should push a `tasks_changed`. */
const WATCHED_FILES = new Set([
	basename(tasksFilePath(".")),
	basename(disabledTasksFilePath(".")),
]);

/**
 * Watch `<cwd>/.pi/` for task-file changes and invoke `onChange` (debounced).
 *
 * Uses Node's built-in `fs.watch` rather than chokidar (which pi-routines pulls
 * in but isn't resolvable from the Cowork sidecar's own package). We watch the
 * `.pi` DIRECTORY, not the file, so a not-yet-created `cowork_scheduled_tasks.json`
 * still triggers once pi-routines (or the bridge) writes it. Returns a closer.
 */
export function watchTaskFiles(
	cwd: string,
	onChange: () => void,
	debounceMs = 150,
): () => void {
	const dir = join(cwd, ".pi");
	if (!existsSync(dir)) {
		try {
			mkdirSync(dir, { recursive: true });
		} catch {
			// best-effort: if we can't create it, watch will simply no-op below
		}
	}

	let timer: ReturnType<typeof setTimeout> | null = null;
	const fire = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			try {
				onChange();
			} catch {
				// listener errors must not kill the watcher
			}
		}, debounceMs);
	};

	let watcher: FSWatcher | null = null;
	try {
		watcher = watch(dir, (_event, filename) => {
			// `filename` can be null on some platforms — fire conservatively then.
			if (filename == null || WATCHED_FILES.has(String(filename))) fire();
		});
	} catch {
		// Directory unwatchable (e.g. removed); caller gets a no-op closer.
	}

	return () => {
		if (timer) clearTimeout(timer);
		watcher?.close();
	};
}
