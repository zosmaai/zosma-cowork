import { describe, expect, it } from "vitest";
import {
	type FireOutcomeRun,
	MAX_FIRE_ATTEMPTS,
	evaluateFireOutcome,
} from "./task-fire-outcome.js";

/** Build a runs array (newest-first, as store.getRuns returns). */
function runs(...items: Array<Partial<FireOutcomeRun>>): FireOutcomeRun[] {
	return items.map((it, i) => ({
		runId: it.runId ?? `run_${i}`,
		status: it.status ?? "completed",
		response: it.response,
	}));
}

describe("evaluateFireOutcome", () => {
	it("returns null for a successful current run (scheduler removes as normal)", () => {
		const rs = runs({ runId: "r1", status: "completed" });
		expect(evaluateFireOutcome("r1", rs)).toBeNull();
	});

	it("returns an Error for a failed current run on the first attempt (keep + retry)", () => {
		const rs = runs({ runId: "r1", status: "failed" });
		const out = evaluateFireOutcome("r1", rs);
		expect(out).toBeInstanceOf(Error);
	});

	it("uses the run's recorded reason as the error message when present", () => {
		const rs = runs({
			runId: "r1",
			status: "failed",
			response: "Task could not run: No API key found. Connect an AI model.",
		});
		const out = evaluateFireOutcome("r1", rs);
		expect(out?.message).toContain("No API key found");
	});

	it("falls back to a generic message when the failed run has no reason", () => {
		const rs = runs({ runId: "r1", status: "failed", response: "" });
		const out = evaluateFireOutcome("r1", rs);
		expect(out?.message.length).toBeGreaterThan(0);
	});

	it("stops signalling failure once the failed-attempt cap is reached (give up)", () => {
		// 5 failed fires (newest-first). The current run is the newest failure.
		const rs = runs(
			{ runId: "r5", status: "failed" },
			{ runId: "r4", status: "failed" },
			{ runId: "r3", status: "failed" },
			{ runId: "r2", status: "failed" },
			{ runId: "r1", status: "failed" },
		);
		expect(evaluateFireOutcome("r5", rs)).toBeNull();
	});

	it("still signals failure on the attempt just below the cap", () => {
		const rs = runs(
			{ runId: "r4", status: "failed" },
			{ runId: "r3", status: "failed" },
			{ runId: "r2", status: "failed" },
			{ runId: "r1", status: "failed" },
		);
		expect(evaluateFireOutcome("r4", rs)).toBeInstanceOf(Error);
	});

	it("only counts failed runs toward the cap (mixed statuses)", () => {
		// 2 failures + some completed; well under the cap → still retry.
		const rs = runs(
			{ runId: "r5", status: "failed" },
			{ runId: "r4", status: "completed" },
			{ runId: "r3", status: "completed" },
			{ runId: "r2", status: "completed" },
			{ runId: "r1", status: "failed" },
		);
		expect(evaluateFireOutcome("r5", rs)).toBeInstanceOf(Error);
	});

	it("returns null when the current run id is not found (defensive)", () => {
		const rs = runs({ runId: "r1", status: "failed" });
		expect(evaluateFireOutcome("missing", rs)).toBeNull();
	});

	it("honours a custom maxAttempts", () => {
		const rs = runs({ runId: "r2", status: "failed" }, { runId: "r1", status: "failed" });
		// cap of 2 reached → give up (null); default (5) would still retry.
		expect(evaluateFireOutcome("r2", rs, 2)).toBeNull();
		expect(evaluateFireOutcome("r2", rs)).toBeInstanceOf(Error);
	});

	it("exposes a sane default attempt cap", () => {
		expect(MAX_FIRE_ATTEMPTS).toBe(5);
	});
});
