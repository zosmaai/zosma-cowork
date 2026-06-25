import { describe, expect, it } from "vitest";
import { createPromptScheduler } from "./prompt-scheduler.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createPromptScheduler", () => {
	it("schedule() returns synchronously without running the task inline", () => {
		const s = createPromptScheduler();
		let started = false;
		s.schedule(async () => {
			started = true;
			await tick();
		});
		// The loop must not be blocked: the task is queued on the microtask
		// queue, so it has NOT started by the time schedule() returns.
		expect(started).toBe(false);
	});

	it("runs tasks one at a time, in submission order (no overlap)", async () => {
		const s = createPromptScheduler();
		const events: string[] = [];
		let active = 0;
		const make = (id: string) => async () => {
			active += 1;
			// Two session.prompt() calls overlapping would throw
			// "Agent is already processing" — assert that never happens.
			expect(active).toBe(1);
			events.push(`start:${id}`);
			await tick();
			events.push(`end:${id}`);
			active -= 1;
		};

		s.schedule(make("a"));
		s.schedule(make("b"));
		s.schedule(make("c"));
		await s.idle();

		expect(events).toEqual([
			"start:a",
			"end:a",
			"start:b",
			"end:b",
			"start:c",
			"end:c",
		]);
	});

	it("a thrown task does not break the chain for later tasks", async () => {
		const s = createPromptScheduler();
		const errors: unknown[] = [];
		const ran: string[] = [];

		s.schedule(
			async () => {
				throw new Error("boom");
			},
			(e) => errors.push(e),
		);
		s.schedule(async () => {
			ran.push("after");
		});
		await s.idle();

		expect((errors[0] as Error).message).toBe("boom");
		expect(ran).toEqual(["after"]);
	});

	it("REGRESSION: an out-of-band abort runs while a prompt task is still in-flight", async () => {
		// Models the sidecar's stdin loop. The loop schedules a long-running
		// prompt task, then must stay free to process a later `abort` command.
		//
		// The prompt task here only completes once "aborted" — exactly like
		// session.prompt() resolving after session.abort(). With the original
		// bug (awaiting the prompt inline in the loop), the abort step below
		// could never run, so the prompt would never resolve: this test would
		// deadlock and time out. With the non-blocking scheduler it passes.
		const s = createPromptScheduler();
		let resolvePrompt!: () => void;
		const promptBlocked = new Promise<void>((r) => {
			resolvePrompt = r;
		});

		let promptStarted = false;
		s.schedule(async () => {
			promptStarted = true;
			await promptBlocked; // session.prompt() blocks until aborted
		});

		// The loop keeps reading stdin and processes `abort` out-of-band.
		await tick(); // let the prompt task start streaming
		expect(promptStarted).toBe(true);

		let aborted = false;
		aborted = true; // models session.abort()
		resolvePrompt(); // abort causes the in-flight prompt to settle

		await s.idle();
		expect(aborted).toBe(true);
	});

	it("REGRESSION: a follow-up prompt runs after the aborted one settles", async () => {
		// abort mid-generation, then send a new message: the new prompt must
		// run once the aborted prompt unwinds (the user's exact scenario).
		const s = createPromptScheduler();
		const order: string[] = [];

		let resolveFirst!: () => void;
		const firstBlocked = new Promise<void>((r) => {
			resolveFirst = r;
		});

		s.schedule(async () => {
			order.push("first:start");
			await firstBlocked;
			order.push("first:end");
		});
		// User presses Stop, then sends a second message while the first is
		// still in-flight. It is scheduled, not dropped.
		s.schedule(async () => {
			order.push("second:start");
			order.push("second:end");
		});

		await tick();
		expect(order).toEqual(["first:start"]); // second hasn't started yet
		resolveFirst(); // abort settles the first prompt

		await s.idle();
		expect(order).toEqual([
			"first:start",
			"first:end",
			"second:start",
			"second:end",
		]);
	});

	it("REGRESSION: a hung task (no events) is aborted by startup timeout and subsequent tasks still run", async () => {
		// Models: local model fails to load (llama-swap hang), so
		// session.prompt() never settles. The startup watchdog (60s in
		// runPromptTask) calls session.abort() which causes the hung
		// prompt to reject. The scheduler must then run the next task.
		const s = createPromptScheduler();
		const order: string[] = [];

		let rejectFirst!: () => void;
		let firstRejected = false;
		s.schedule(async () => {
			order.push("first:start");
			try {
				await new Promise<void>((_, reject) => {
					rejectFirst = () => {
						firstRejected = true;
						reject(new Error("startup timeout"));
					};
				});
			} finally {
				order.push("first:end");
			}
		});

		// Second task: queued after the first — must run even if first hangs
		s.schedule(async () => {
			order.push("second:start");
			order.push("second:end");
		});

		await tick();
		expect(order).toEqual(["first:start"]);

		// Simulate startup watchdog firing (model didn't respond in 60s)
		rejectFirst();

		await s.idle();
		expect(firstRejected).toBe(true);
		expect(order).toEqual([
			"first:start",
			"first:end",
			"second:start",
			"second:end",
		]);
	});
});
