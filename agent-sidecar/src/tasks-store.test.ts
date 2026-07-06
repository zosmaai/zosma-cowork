import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type ScheduledTask,
	createTask,
	deleteTask,
	disabledTasksFilePath,
	listTasks,
	runTaskNow,
	setTaskEnabled,
	tasksFilePath,
	watchTaskFiles,
} from "./tasks-store.js";

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
	return {
		id: "task_1",
		name: "spike",
		schedule: "* * * * *",
		prompt: "say hi",
		type: "durable",
		createdAt: "2026-06-14T00:00:00.000Z",
		recurring: true,
		maxAgeDays: 7,
		nextRunAt: "2026-06-14T00:01:00.000Z",
		...overrides,
	};
}

/** Write the active (pi-routines) task file directly. */
function writeActive(cwd: string, tasks: ScheduledTask[]): void {
	mkdirSync(dirname(tasksFilePath(cwd)), { recursive: true });
	writeFileSync(
		tasksFilePath(cwd),
		JSON.stringify({ version: 1, tasks }, null, 2),
	);
}

function readActive(cwd: string): ScheduledTask[] {
	return JSON.parse(readFileSync(tasksFilePath(cwd), "utf-8")).tasks;
}

function readDisabled(cwd: string): ScheduledTask[] {
	return JSON.parse(readFileSync(disabledTasksFilePath(cwd), "utf-8")).tasks;
}

describe("tasks-store", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "zosma-tasks-"));
		// pre-create .pi so writes land where the test reads
		writeActive(cwd, []);
	});
	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	describe("listTasks", () => {
		it("returns [] when the file is absent", () => {
			const empty = mkdtempSync(join(tmpdir(), "zosma-tasks-empty-"));
			expect(listTasks(empty)).toEqual([]);
			rmSync(empty, { recursive: true, force: true });
		});

		it("returns [] when the file is corrupt", () => {
			writeFileSync(tasksFilePath(cwd), "{ not json");
			expect(listTasks(cwd)).toEqual([]);
		});

		it("annotates active tasks enabled:true", () => {
			writeActive(cwd, [task({ id: "a" })]);
			const list = listTasks(cwd);
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ id: "a", enabled: true });
		});

		it("includes disabled-file tasks annotated enabled:false", () => {
			writeActive(cwd, [task({ id: "a" })]);
			setTaskEnabled(cwd, "a", false);
			const list = listTasks(cwd);
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({ id: "a", enabled: false });
		});
	});

	describe("deleteTask", () => {
		it("removes an active task and returns true", () => {
			writeActive(cwd, [task({ id: "a" }), task({ id: "b" })]);
			expect(deleteTask(cwd, "a")).toBe(true);
			expect(readActive(cwd).map((t) => t.id)).toEqual(["b"]);
		});

		it("removes a disabled task too", () => {
			writeActive(cwd, [task({ id: "a" })]);
			setTaskEnabled(cwd, "a", false);
			expect(deleteTask(cwd, "a")).toBe(true);
			expect(listTasks(cwd)).toEqual([]);
		});

		it("returns false for an unknown id", () => {
			writeActive(cwd, [task({ id: "a" })]);
			expect(deleteTask(cwd, "nope")).toBe(false);
		});
	});

	describe("setTaskEnabled", () => {
		it("moves a task from active to disabled when disabling", () => {
			writeActive(cwd, [task({ id: "a" })]);
			expect(setTaskEnabled(cwd, "a", false)).toBe(true);
			expect(readActive(cwd)).toEqual([]);
			expect(readDisabled(cwd).map((t) => t.id)).toEqual(["a"]);
		});

		it("clears nextRunAt when re-enabling so pi-routines recomputes it", () => {
			writeActive(cwd, [task({ id: "a", nextRunAt: "2026-06-14T00:01:00.000Z" })]);
			setTaskEnabled(cwd, "a", false);
			expect(setTaskEnabled(cwd, "a", true)).toBe(true);
			const active = readActive(cwd);
			expect(active.map((t) => t.id)).toEqual(["a"]);
			expect(active[0].nextRunAt).toBeUndefined();
			expect(readDisabled(cwd)).toEqual([]);
		});

		it("is an idempotent no-op when already in the target state", () => {
			writeActive(cwd, [task({ id: "a" })]);
			expect(setTaskEnabled(cwd, "a", true)).toBe(true); // already enabled
			expect(readActive(cwd).map((t) => t.id)).toEqual(["a"]);
		});

		it("returns false for an unknown id", () => {
			writeActive(cwd, [task({ id: "a" })]);
			expect(setTaskEnabled(cwd, "nope", false)).toBe(false);
		});

		it("does not leave the task in both files", () => {
			writeActive(cwd, [task({ id: "a" })]);
			setTaskEnabled(cwd, "a", false);
			setTaskEnabled(cwd, "a", true);
			expect(readActive(cwd).map((t) => t.id)).toEqual(["a"]);
			expect(readDisabled(cwd)).toEqual([]);
		});
	});

	describe("runTaskNow", () => {
		it("sets nextRunAt into the past for an enabled task", () => {
			writeActive(cwd, [task({ id: "a", nextRunAt: "2099-01-01T00:00:00.000Z" })]);
			expect(runTaskNow(cwd, "a")).toBe(true);
			const next = new Date(readActive(cwd)[0].nextRunAt as string).getTime();
			expect(next).toBeLessThan(Date.now());
		});

		it("returns false for an unknown id", () => {
			writeActive(cwd, [task({ id: "a" })]);
			expect(runTaskNow(cwd, "nope")).toBe(false);
		});

		it("throws for a disabled task (must enable first)", () => {
			writeActive(cwd, [task({ id: "a" })]);
			setTaskEnabled(cwd, "a", false);
			expect(() => runTaskNow(cwd, "a")).toThrow(/disabled/i);
		});
	});

	describe("createTask", () => {
		it("appends a task to the active file with defaults", () => {
			writeActive(cwd, []);
			const created = createTask(cwd, {
				name: "every 5 minutes",
				schedule: "*/5 * * * *",
				prompt: "check the build",
			});
			expect(created.enabled).toBe(true);
			expect(created.id).toBeTruthy();
			expect(created.type).toBe("session");
			expect(created.recurring).toBe(true);
			const stored = readActive(cwd);
			expect(stored).toHaveLength(1);
			expect(stored[0].prompt).toBe("check the build");
			expect(stored[0].schedule).toBe("*/5 * * * *");
		});

		it("stamps nextRunAt in the past when runImmediately is set", () => {
			writeActive(cwd, []);
			createTask(cwd, {
				name: "loop",
				schedule: "*/5 * * * *",
				prompt: "go",
				runImmediately: true,
			});
			const next = new Date(readActive(cwd)[0].nextRunAt as string).getTime();
			expect(next).toBeLessThan(Date.now());
		});

		it("generates unique ids for successive tasks", () => {
			writeActive(cwd, []);
			const a = createTask(cwd, { name: "a", schedule: "*/5 * * * *", prompt: "a" });
			const b = createTask(cwd, { name: "b", schedule: "*/5 * * * *", prompt: "b" });
			expect(a.id).not.toBe(b.id);
			expect(readActive(cwd)).toHaveLength(2);
		});
	});

	describe("watchTaskFiles", () => {
		it("fires (debounced) when the active task file changes", async () => {
			let calls = 0;
			const close = watchTaskFiles(cwd, () => calls++, 20);
			try {
				writeActive(cwd, [task({ id: "a" })]);
				await new Promise((r) => setTimeout(r, 120));
				expect(calls).toBeGreaterThanOrEqual(1);
			} finally {
				close();
			}
		});

		it("returns a closer that stops further callbacks", async () => {
			let calls = 0;
			const close = watchTaskFiles(cwd, () => calls++, 20);
			close();
			writeActive(cwd, [task({ id: "b" })]);
			await new Promise((r) => setTimeout(r, 80));
			expect(calls).toBe(0);
		});
	});
});
