import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reconcile interrupted task runs on startup (#328).
 *
 * A run left as `pending`/`running` in `.pi/task_runs/<taskId>.jsonl` means the
 * app closed mid-fire (the isolated session never resolved). Left as-is, the
 * Tasks→Activity timeline shows a permanently "running" ghost. This flips any
 * such run older than `thresholdMs` to `failed` with an interrupted reason, so
 * the timeline is always truthful.
 *
 * Fresh in-flight runs (younger than the threshold) are left untouched — they
 * may belong to a fire that is genuinely still executing.
 */
export function reconcileInterruptedRuns(
	workspaceCwd: string,
	thresholdMs = 120_000,
): void {
	const dir = join(workspaceCwd, ".pi", "task_runs");
	if (!existsSync(dir)) return;

	const cutoff = Date.now() - thresholdMs;

	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".jsonl")) continue;
		const path = join(dir, file);

		let changed = false;
		const lines = readFileSync(path, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					const run = JSON.parse(line) as {
						status?: string;
						startedAt?: string;
						response?: string;
					};
					if (
						(run.status === "running" || run.status === "pending") &&
						run.startedAt !== undefined &&
						new Date(run.startedAt).getTime() < cutoff
					) {
						changed = true;
						return JSON.stringify({
							...run,
							status: "failed",
							completedAt: new Date().toISOString(),
							response:
								run.response ??
								"Interrupted: the app closed before this run finished.",
						});
					}
				} catch {
					// Preserve malformed lines untouched.
				}
				return line;
			});

		if (changed) writeFileSync(path, `${lines.join("\n")}\n`);
	}
}
