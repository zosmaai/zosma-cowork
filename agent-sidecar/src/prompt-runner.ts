/**
 * Zosma Content CoWork — Prompt Runner
 *
 * Runs one prompt to completion on the agent session, with support for
 * startup watchdog and auto-abort timeout.
 */

import { send, log, logError, logDebug } from "./protocol.js";

/** Tracks whether the current prompt has emitted ANY agent event. */
export let currentPromptStartedAt = 0;
export let promptHasEmitted = false;

/** Tracks the current prompt ID for abort correlation. */
export let activePromptId: string | null = null;

export function setActivePromptId(id: string | null): void {
	activePromptId = id;
}

export function clearPromptFlags(): void {
	currentPromptStartedAt = 0;
	promptHasEmitted = false;
}

/** Mark the current prompt as having emitted at least one agent event. */
export function markPromptEmitted(): void {
	promptHasEmitted = true;
}

/**
 * Forward every agent event to stdout AND feed the startup watchdog.
 *
 * MUST be the single subscription used by init and every session rebind
 * (new_session, load_session). If a rebind subscribes without marking the
 * prompt as emitted, promptHasEmitted stays false and the 20s startup
 * watchdog aborts every turn — regardless of model. See sessions.ts.
 */
/** Streaming deltas fire many times per second — excluded from sequence trace. */
const HIGH_FREQ_EVENTS = new Set([
	"text_delta",
	"thinking_delta",
	"message_update",
	"tool_execution_update",
]);

export function subscribeSession(session: { subscribe: (cb: (e: unknown) => void) => void }): void {
	session.subscribe((event: unknown) => {
		if (currentPromptStartedAt > 0) {
			markPromptEmitted();
		}
		// Sequence trace: log every lifecycle event type (skipping high-frequency
		// streaming deltas) so the exact order of turn/tool/retry events is
		// reconstructable from logs. Debug-gated — off in production by default.
		const et = (event as { type?: string })?.type;
		if (et && !HIGH_FREQ_EVENTS.has(et)) {
			logDebug("event: %s", et);
		}
		send({ type: "event", event });
	});
}

/**
 * Runs one prompt to completion on the agent session.
 * Extracted from the "prompt" command so it can be scheduled on the
 * promptChain instead of being awaited inline in the stdin read loop.
 */
export async function runPromptTask(
	cmd: {
		id: string;
		text: string;
		_origin?: string;
	},
	session: {
		model?: { provider?: string; id?: string; name?: string };
		prompt: (text: string) => Promise<unknown>;
		abort: () => void;
		agent?: { state?: { messages?: unknown[] } };
	} | undefined,
	zosmaDir: string,
	workspaceCwd: string,
): Promise<void> {
	if (!session) {
		send({ type: "error", id: cmd.id, message: "Not initialized" });
		send({ type: "done", id: cmd.id });
		return;
	}
	const promptModel = session.model;
	log("prompt: using model %s/%s", promptModel?.provider, promptModel?.id);
	activePromptId = cmd.id;
	logDebug("prompt: start id=%s", cmd.id);

	// Startup timeout (20s): if the model doesn't produce ANY agent events
	// within 20 seconds, abort the prompt.
	const STARTUP_TIMEOUT_MS = 20_000;
	const PROMPT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
	currentPromptStartedAt = Date.now();
	promptHasEmitted = false;
	const safeAbort = () => {
		try {
			session.abort();
		} catch {
			// ignore if session already completed
		}
	};

	const startupTimer = setTimeout(() => {
		if (promptHasEmitted) return;
		logError(
			"prompt: no events within %dms — aborting (model may have failed to load)",
			STARTUP_TIMEOUT_MS,
		);
		safeAbort();
	}, STARTUP_TIMEOUT_MS);

	const abortTimeout = setTimeout(() => {
		logError("prompt: timeout after %dms — aborting session", PROMPT_TIMEOUT_MS);
		safeAbort();
	}, PROMPT_TIMEOUT_MS);


	try {
		await session.prompt(cmd.text);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (promptHasEmitted || Date.now() - currentPromptStartedAt <= STARTUP_TIMEOUT_MS) {
			logError("prompt error: %s", msg);
			send({ type: "error", id: cmd.id, message: msg });
		} else {
			logError("prompt: aborted (startup timeout) — %s", msg);
			send({
				type: "error",
				id: cmd.id,
				message:
					"Model failed to load or is unresponsive. Check model availability and try again.",
			});
		}
	} finally {
		clearTimeout(abortTimeout);
		clearTimeout(startupTimer);
		currentPromptStartedAt = 0;
		promptHasEmitted = false;
		send({ type: "done", id: cmd.id });
		logDebug("prompt: done id=%s", cmd.id);
		activePromptId = null;
	}
}

/** Retained for protocol compat; remote sessions now auto-persist via pi. */
export function resetRemoteSession(): void {}
