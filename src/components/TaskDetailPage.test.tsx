import type { ConversationEntry, Task, TaskRun } from "@/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskDetailPage } from "./TaskDetailPage";

function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "task_1",
		name: "Morning email",
		schedule: "0 9 * * *",
		prompt: "summarize my unread email",
		type: "durable",
		createdAt: "2026-06-14T00:00:00.000Z",
		recurring: true,
		maxAgeDays: 7,
		enabled: true,
		...overrides,
	};
}

const handlers = () => ({
	onRunNow: vi.fn(),
	onSetEnabled: vi.fn(),
	onDelete: vi.fn(),
	onClose: vi.fn(),
});

describe("TaskDetailPage", () => {
	it("shows a hint when no task is selected", () => {
		render(<TaskDetailPage task={null} {...handlers()} />);
		expect(screen.getByText("Select a task")).toBeInTheDocument();
	});

	it("renders the task name, humanized schedule and prompt", () => {
		render(<TaskDetailPage task={task()} {...handlers()} />);
		expect(screen.getByText("Morning email")).toBeInTheDocument();
		expect(screen.getByText(/Every day at 9:00 AM/)).toBeInTheDocument();
		expect(screen.getByText("summarize my unread email")).toBeInTheDocument();
		expect(screen.getByText("Active")).toBeInTheDocument();
	});

	it("run-now calls onRunNow with the task id", () => {
		const h = handlers();
		render(<TaskDetailPage task={task()} {...h} />);
		fireEvent.click(screen.getByText("Run now"));
		expect(h.onRunNow).toHaveBeenCalledWith("task_1");
	});

	it("pause calls onSetEnabled(false) for an enabled task", () => {
		const h = handlers();
		render(<TaskDetailPage task={task({ enabled: true })} {...h} />);
		fireEvent.click(screen.getByText("Pause"));
		expect(h.onSetEnabled).toHaveBeenCalledWith("task_1", false);
	});

	it("a paused task shows Enable and disables Run now", () => {
		const h = handlers();
		render(<TaskDetailPage task={task({ enabled: false })} {...h} />);
		expect(screen.getByText("Paused")).toBeInTheDocument();
		const runBtn = screen.getByText("Run now").closest("button");
		expect(runBtn).toBeDisabled();
		fireEvent.click(screen.getByText("Enable"));
		expect(h.onSetEnabled).toHaveBeenCalledWith("task_1", true);
	});

	it("delete calls onDelete", () => {
		const h = handlers();
		render(<TaskDetailPage task={task()} {...h} />);
		fireEvent.click(screen.getByText("Delete"));
		expect(h.onDelete).toHaveBeenCalledWith("task_1");
	});

	it("surfaces an error message", () => {
		render(<TaskDetailPage task={task()} error="enable it first" {...handlers()} />);
		expect(screen.getByText("enable it first")).toBeInTheDocument();
	});

	describe("Run Log (#300)", () => {
		it("shows no runs yet when listRuns returns empty", async () => {
			const listRuns = vi.fn().mockResolvedValue([]);
			render(<TaskDetailPage task={task()} {...handlers()} listRuns={listRuns} />);
			expect(await screen.findByText("No runs yet")).toBeInTheDocument();
		});

		it("renders conversation steps for a completed run", async () => {
			const conversation: ConversationEntry[] = [
				{ type: "thinking", content: "Let me analyze the request..." },
				{ type: "tool_call", toolName: "read_file", toolArgs: { path: "/tmp/test.txt" } },
				{ type: "tool_result", toolResult: "File contents here", toolError: false },
				{ type: "text", content: "Here is the summary of the file." },
			];

			const run: TaskRun = {
				runId: "run_1",
				taskId: "task_1",
				prompt: "summarize my unread email",
				status: "completed",
				startedAt: "2026-06-14T12:00:00.000Z",
				completedAt: "2026-06-14T12:00:30.000Z",
				conversation,
			};

			const listRuns = vi.fn().mockResolvedValue([run]);
			render(<TaskDetailPage task={task()} {...handlers()} listRuns={listRuns} />);

			// Wait for the runs to load, then click Steps toggle to expand
			expect(await screen.findByText("Steps")).toBeInTheDocument();
			fireEvent.click(screen.getByText("Steps"));

			// Verify each conversation step type is rendered
			expect(screen.getByText("Thinking")).toBeInTheDocument();
			expect(screen.getByText("Let me analyze the request...")).toBeInTheDocument();
			expect(screen.getByText("read_file")).toBeInTheDocument();
			expect(screen.getByText("Result")).toBeInTheDocument();
		});

		it("shows error styling for failed tool results", async () => {
			const conversation: ConversationEntry[] = [
				{ type: "tool_call", toolName: "bash", toolArgs: { command: "rm -rf /" } },
				{ type: "tool_result", toolResult: "Permission denied", toolError: true },
			];

			const run: TaskRun = {
				runId: "run_2",
				taskId: "task_1",
				prompt: "clean up",
				status: "failed",
				startedAt: "2026-06-14T12:01:00.000Z",
				completedAt: "2026-06-14T12:01:05.000Z",
				conversation,
			};

			const listRuns = vi.fn().mockResolvedValue([run]);
			render(<TaskDetailPage task={task()} {...handlers()} listRuns={listRuns} />);

			// Expand steps first
			expect(await screen.findByText("Steps")).toBeInTheDocument();
			fireEvent.click(screen.getByText("Steps"));

			expect(screen.getByText("Error")).toBeInTheDocument();
			expect(screen.getByText("Permission denied")).toBeInTheDocument();
		});
	});
});
