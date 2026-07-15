import { describe, expect, it, vi } from "vitest";
import {
	type RunTaskFireOptions,
	type TaskFireSession,
	runTaskFire,
} from "./task-fire.js";

/**
 * A fake isolated session. Records the subscribed listener so a test can drive
 * events through it, mimicking the real AgentSession event stream. `prompt()`
 * replays a scripted list of events to the listener, then resolves (or rejects).
 */
function fakeSession(opts: {
	events?: Array<Record<string, unknown>>;
	promptError?: Error;
} = {}): TaskFireSession & {
	disposed: boolean;
	subscribeCount: number;
} {
	let listener: ((event: Record<string, unknown>) => void) | null = null;
	const self = {
		disposed: false,
		subscribeCount: 0,
		subscribe(l: (event: Record<string, unknown>) => void) {
			self.subscribeCount += 1;
			listener = l;
			return () => {
				listener = null;
			};
		},
		async prompt() {
			for (const ev of opts.events ?? []) {
				listener?.(ev);
			}
			if (opts.promptError) throw opts.promptError;
		},
		dispose() {
			self.disposed = true;
		},
	};
	return self;
}

function baseOptions(
	session: TaskFireSession,
	overrides: Partial<RunTaskFireOptions> = {},
): RunTaskFireOptions & { updateRun: ReturnType<typeof vi.fn>; sent: unknown[] } {
	const updateRun = vi.fn();
	const sent: unknown[] = [];
	return {
		task: { id: "task_water", name: "Drink Water", prompt: "drink water" },
		runId: "run_1",
		store: { updateRun },
		createSession: async () => session,
		send: (msg) => {
			sent.push(msg);
		},
		flushIntervalMs: 0,
		updateRun,
		sent,
		...overrides,
	};
}

describe("runTaskFire — isolated session per run", () => {
	it("creates a fresh isolated session and captures ONLY that session's events", async () => {
		const session = fakeSession({
			events: [
				{
					type: "message_update",
					assistantMessageEvent: { type: "thinking_delta", delta: "let me think" },
				},
				{
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "Reminder sent." },
				},
			],
		});
		const createSession = vi.fn(async () => session);
		const opts = baseOptions(session, { createSession });

		await runTaskFire(opts);

		// A dedicated session was created for this run.
		expect(createSession).toHaveBeenCalledTimes(1);
		expect(session.subscribeCount).toBe(1);

		// The completed run captured the isolated session's conversation.
		const completed = opts.updateRun.mock.calls.find(
			(c) => c[2]?.status === "completed",
		);
		expect(completed).toBeDefined();
		const updates = (completed?.[2] ?? {}) as Record<string, unknown>;
		const conversation = updates.conversation as Array<{
			type: string;
			content?: string;
		}>;
		expect(conversation).toEqual([
			{ type: "thinking", content: "let me think" },
			{ type: "text", content: "Reminder sent." },
		]);
		expect(updates.response).toBe("Reminder sent.");
	});

	it("disposes the isolated session after a successful run", async () => {
		const session = fakeSession({ events: [] });
		const opts = baseOptions(session);

		await runTaskFire(opts);

		expect(session.disposed).toBe(true);
	});

	it("disposes the isolated session even when the prompt fails", async () => {
		const session = fakeSession({ promptError: new Error("boom") });
		const opts = baseOptions(session);

		await runTaskFire(opts);

		expect(session.disposed).toBe(true);
		const failed = opts.updateRun.mock.calls.find(
			(c) => c[2]?.status === "failed",
		);
		expect(failed).toBeDefined();
	});

	it("captures tool calls and tool results from the isolated session", async () => {
		const session = fakeSession({
			events: [
				{
					type: "message_update",
					assistantMessageEvent: {
						type: "toolcall_end",
						toolCall: { name: "bash", arguments: { command: "echo hi" } },
					},
				},
				{
					type: "tool_execution_end",
					toolName: "bash",
					isError: false,
					result: { content: [{ text: "hi" }] },
				},
			],
		});
		const opts = baseOptions(session);

		await runTaskFire(opts);

		const completed = opts.updateRun.mock.calls.find(
			(c) => c[2]?.status === "completed",
		);
		const conversation = (completed?.[2]?.conversation ?? []) as Array<
			Record<string, unknown>
		>;
		expect(conversation).toEqual([
			{ type: "tool_call", toolName: "bash", toolArgs: { command: "echo hi" } },
			{ type: "tool_result", toolName: "bash", toolResult: "hi", toolError: false },
		]);
	});

	it("emits task_run_completed and marks running before prompting", async () => {
		const session = fakeSession({ events: [] });
		const opts = baseOptions(session);

		await runTaskFire(opts);

		// First update marks the run running.
		expect(opts.updateRun.mock.calls[0][2]).toMatchObject({ status: "running" });
		// A completion event was emitted.
		expect(opts.sent).toContainEqual({
			type: "event",
			event: { type: "task_run_completed", taskId: "task_water", runId: "run_1" },
		});
	});

	it("marks the run failed when the session cannot be created", async () => {
		const opts = baseOptions(fakeSession(), {
			createSession: async () => {
				throw new Error("no session");
			},
		});

		await expect(runTaskFire(opts)).resolves.toBeUndefined();

		const failed = opts.updateRun.mock.calls.find(
			(c) => c[2]?.status === "failed",
		);
		expect(failed).toBeDefined();
	});

	it("records an actionable reason when the session cannot be created", async () => {
		const opts = baseOptions(fakeSession(), {
			createSession: async () => {
				throw new Error("No model configured");
			},
		});

		await runTaskFire(opts);

		const failed = opts.updateRun.mock.calls.find((c) => c[2]?.status === "failed");
		const updates = (failed?.[2] ?? {}) as Record<string, unknown>;
		// Not an empty string — a human-readable, actionable message the Activity
		// timeline can show instead of a silent blank.
		expect(String(updates.response)).toMatch(/model/i);
		expect(String(updates.response)).toMatch(/No model configured/);
	});
});
