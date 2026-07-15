/**
 * Post-fire outcome decision (#328 failure-branch fix).
 *
 * WHY THIS EXISTS
 * ---------------
 * `runTaskFire` (task-fire.ts) NEVER throws — by contract it records failures on
 * the run record and RESOLVES. The vendored pi-routines scheduler, however,
 * decides a one-shot task's fate purely from whether the `onFireCallback`
 * promise resolves or rejects:
 *
 *   - reject   → keep the one-shot + retry after ~60s   (cronScheduler reject branch)
 *   - resolve  → remove the one-shot                     (success OR give-up)
 *
 * Because `runTaskFire` always resolves, a FAILED fire looked like a success to
 * the scheduler → the one-shot was removed even though the prompt was never
 * delivered. That is issue #328: the task vanishes when due and the failure
 * leaves no visible trace.
 *
 * The Cowork seam therefore inspects the run's final status after `runTaskFire`
 * resolves and, when it FAILED, throws so the scheduler's keep-and-retry branch
 * fires. To avoid retrying a permanently broken task forever (e.g. no model ever
 * connected), retries are bounded: once a task accumulates {@link MAX_FIRE_ATTEMPTS}
 * failed fires we STOP signalling failure, letting the scheduler finally remove
 * it instead of churning every 60s.
 */

export interface FireOutcomeRun {
	runId: string;
	status: "pending" | "running" | "completed" | "failed";
	response?: string;
}

/** Give up on a one-shot after this many failed fires (bounded retry). */
export const MAX_FIRE_ATTEMPTS = 5;

/**
 * Decide whether the `onFireCallback` should signal failure (by throwing the
 * returned Error) after `runTaskFire` has resolved.
 *
 * @param runId       the run that was just executed
 * @param runs        all runs for the task, newest-first (as `store.getRuns`)
 * @param maxAttempts failed-fire cap before giving up (default {@link MAX_FIRE_ATTEMPTS})
 * @returns an Error to throw (→ scheduler keeps the one-shot + retries), or
 *          `null` to proceed normally (→ scheduler removes it: success or give-up)
 */
export function evaluateFireOutcome(
	runId: string,
	runs: FireOutcomeRun[],
	maxAttempts: number = MAX_FIRE_ATTEMPTS,
): Error | null {
	const current = runs.find((r) => r.runId === runId);
	// Only a FAILED current run should signal failure. A success (or any other
	// terminal state) means the scheduler's normal removal is correct.
	if (!current || current.status !== "failed") return null;

	// Bounded retry: count every failed fire this task has accumulated (the
	// current one included). Once the cap is reached, stop rejecting so the
	// scheduler removes the permanently-broken task instead of retrying forever.
	const failedAttempts = runs.filter((r) => r.status === "failed").length;
	if (failedAttempts >= maxAttempts) return null;

	const reason =
		current.response && current.response.trim().length > 0
			? current.response
			: "Scheduled task fire failed";
	return new Error(reason);
}
