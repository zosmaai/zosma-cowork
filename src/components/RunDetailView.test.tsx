/**
 * RunDetailView — failed runs surface their actionable reason (#328).
 *
 * A one-shot that couldn't run (e.g. no model connected) records a `failed`
 * run whose `response` explains why. This view must render that message so the
 * user sees an actionable reason instead of a silent blank.
 */

import type { TaskRun } from "@/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunDetailView } from "./RunDetailView";

// listen() is only used for live (running) runs; stub it to a no-op unlisten.
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async () => () => {}),
}));

function failedRun(overrides: Partial<TaskRun> = {}): TaskRun {
	return {
		runId: "run_1",
		taskId: "task_1",
		prompt: "remind me",
		status: "failed",
		startedAt: new Date().toISOString(),
		completedAt: new Date().toISOString(),
		response:
			"Task could not run: No model configured. Connect an AI model to run scheduled tasks.",
		...overrides,
	} as TaskRun;
}

describe("RunDetailView — failed run", () => {
	it("renders the actionable failure reason", () => {
		render(<RunDetailView run={failedRun()} taskName="Reminder" onBack={() => {}} />);
		expect(screen.getByText(/No model configured/)).toBeInTheDocument();
		expect(screen.getByText(/Connect an AI model/)).toBeInTheDocument();
	});
});
