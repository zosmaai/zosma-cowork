import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reconcileInterruptedRuns } from "./task-reconcile.js";

describe("reconcileInterruptedRuns", () => {
	it("flips stale running runs to failed and leaves fresh ones", () => {
		const ws = mkdtempSync(join(tmpdir(), "recon-"));
		const dir = join(ws, ".pi", "task_runs");
		mkdirSync(dir, { recursive: true });
		const stale = {
			runId: "a",
			taskId: "t",
			prompt: "p",
			status: "running",
			startedAt: new Date(Date.now() - 600_000).toISOString(),
		};
		const fresh = {
			runId: "b",
			taskId: "t",
			prompt: "p",
			status: "running",
			startedAt: new Date(Date.now() - 10_000).toISOString(),
		};
		writeFileSync(
			join(dir, "t.jsonl"),
			`${JSON.stringify(stale)}\n${JSON.stringify(fresh)}\n`,
		);

		reconcileInterruptedRuns(ws, 120_000);

		const lines = readFileSync(join(dir, "t.jsonl"), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
		expect(lines.find((r) => r.runId === "a").status).toBe("failed");
		expect(lines.find((r) => r.runId === "b").status).toBe("running");
	});

	it("no-ops when the task_runs dir does not exist", () => {
		const ws = mkdtempSync(join(tmpdir(), "recon-empty-"));
		expect(() => reconcileInterruptedRuns(ws)).not.toThrow();
	});
});
