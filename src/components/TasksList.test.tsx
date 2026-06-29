import type { Task } from "@/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TasksList } from "./TasksList";

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

describe("TasksList", () => {
	it("shows the empty state when there are no tasks", () => {
		render(<TasksList tasks={[]} loading={false} error={null} onSelect={() => {}} />);
		expect(screen.getByText("No tasks yet")).toBeInTheDocument();
	});

	it("renders a row per task with its humanized schedule", () => {
		render(
			<TasksList
				tasks={[task(), task({ id: "task_2", name: "Weekly report", schedule: "0 9 * * 1" })]}
				loading={false}
				error={null}
				onSelect={() => {}}
			/>,
		);
		expect(screen.getByText("Morning email")).toBeInTheDocument();
		expect(screen.getByText("Weekly report")).toBeInTheDocument();
		expect(screen.getByText("Every day at 9:00 AM")).toBeInTheDocument();
		expect(screen.getByText("Every Monday at 9:00 AM")).toBeInTheDocument();
	});

	it("calls onSelect with the task id when a row is clicked", () => {
		const onSelect = vi.fn();
		render(<TasksList tasks={[task()]} loading={false} error={null} onSelect={onSelect} />);
		fireEvent.click(screen.getByText("Morning email"));
		expect(onSelect).toHaveBeenCalledWith("task_1");
	});

	it("marks a paused task", () => {
		render(
			<TasksList
				tasks={[task({ enabled: false })]}
				loading={false}
				error={null}
				onSelect={() => {}}
			/>,
		);
		expect(screen.getByLabelText("Paused")).toBeInTheDocument();
	});
});
