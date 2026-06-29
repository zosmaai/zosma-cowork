/**
 * Tests for useTasks (#288) — the data layer behind the future Tasks UI (#289).
 *
 * Verifies the hook talks to the right sidecar commands, normalises the
 * `{ tasks: [...] }` vs bare-array response, and refetches on `tasks_changed`.
 */

import type { Task } from "@/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...a: unknown[]) => invokeMock(...a),
}));
vi.mock("@tauri-apps/api/event", () => ({
	listen: (...a: unknown[]) => listenMock(...a),
}));

import { useTasks } from "./useTasks";

function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "task_1",
		name: "spike",
		schedule: "* * * * *",
		prompt: "say hi",
		type: "durable",
		createdAt: "2026-06-14T00:00:00.000Z",
		recurring: true,
		maxAgeDays: 7,
		enabled: true,
		...overrides,
	};
}

describe("useTasks", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		listenMock.mockReset();
		listenMock.mockResolvedValue(() => {});
		invokeMock.mockResolvedValue({ tasks: [] });
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("loads tasks via tasks_list on mount", async () => {
		invokeMock.mockResolvedValueOnce({ tasks: [task({ id: "a" })] });
		const { result } = renderHook(() => useTasks());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(invokeMock).toHaveBeenCalledWith("tasks_list");
		expect(result.current.tasks.map((t) => t.id)).toEqual(["a"]);
	});

	it("normalises a bare-array response", async () => {
		invokeMock.mockResolvedValueOnce([task({ id: "b" })]);
		const { result } = renderHook(() => useTasks());
		await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(["b"]));
	});

	it("surfaces an error on a failed load", async () => {
		invokeMock.mockRejectedValueOnce(new Error("boom"));
		const { result } = renderHook(() => useTasks());
		await waitFor(() => expect(result.current.error).toBe("boom"));
	});

	it("del calls tasks_delete then refreshes", async () => {
		const { result } = renderHook(() => useTasks());
		await waitFor(() => expect(result.current.loading).toBe(false));
		invokeMock.mockClear();
		invokeMock.mockResolvedValue({ tasks: [] });
		await act(async () => {
			await result.current.del("a");
		});
		expect(invokeMock).toHaveBeenCalledWith("tasks_delete", { taskId: "a" });
		expect(invokeMock).toHaveBeenCalledWith("tasks_list");
	});

	it("setEnabled calls tasks_set_enabled with the flag", async () => {
		invokeMock.mockResolvedValueOnce({ tasks: [task({ id: "a", enabled: true })] });
		const { result } = renderHook(() => useTasks());
		await waitFor(() => expect(result.current.tasks).toHaveLength(1));
		invokeMock.mockClear();
		await act(async () => {
			await result.current.setEnabled("a", false);
		});
		expect(invokeMock).toHaveBeenCalledWith("tasks_set_enabled", {
			taskId: "a",
			enabled: false,
		});
		// optimistic update applied
		expect(result.current.tasks[0].enabled).toBe(false);
	});

	it("runNow calls tasks_run_now", async () => {
		const { result } = renderHook(() => useTasks());
		await waitFor(() => expect(result.current.loading).toBe(false));
		invokeMock.mockClear();
		await act(async () => {
			await result.current.runNow("a");
		});
		expect(invokeMock).toHaveBeenCalledWith("tasks_run_now", { taskId: "a" });
	});

	it("subscribes to tasks_changed and refetches on it", async () => {
		let handler: (() => void) | undefined;
		listenMock.mockImplementation((evt: string, cb: () => void) => {
			if (evt === "tasks_changed") handler = cb;
			return Promise.resolve(() => {});
		});
		const { result } = renderHook(() => useTasks());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(listenMock).toHaveBeenCalledWith("tasks_changed", expect.any(Function));

		invokeMock.mockClear();
		invokeMock.mockResolvedValue({ tasks: [task({ id: "c" })] });
		await act(async () => {
			handler?.();
		});
		await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(["c"]));
	});
});
