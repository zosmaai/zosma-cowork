import { describe, expect, it, vi } from "vitest";
import { createPromptScheduler } from "./prompt-scheduler.js";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("concurrent session schedulers", () => {
	it("runs different sessions concurrently while serializing each session", async () => {
		const a = createPromptScheduler();
		const b = createPromptScheduler();
		const releaseA = deferred();
		const releaseB = deferred();
		const started: string[] = [];

		a.schedule(async () => {
			started.push("a-1");
			await releaseA.promise;
		});
		a.schedule(async () => {
			started.push("a-2");
		});
		b.schedule(async () => {
			started.push("b-1");
			await releaseB.promise;
		});

		await vi.waitFor(() => expect(started).toEqual(["a-1", "b-1"]));
		releaseB.resolve();
		await b.idle();
		expect(started).toEqual(["a-1", "b-1"]);
		releaseA.resolve();
		await a.idle();
		expect(started).toEqual(["a-1", "b-1", "a-2"]);
	});
});