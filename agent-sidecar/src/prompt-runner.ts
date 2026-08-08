/**
 * Zosma Content CoWork — Prompt Runner
 *
 * Runs one prompt to completion on the agent session, with support for
 * startup watchdog and auto-abort timeout. All prompt/watchdog state is
 * now runtime-local (no module globals) so multiple sessions can run
 * independently.
 */

import { send, log, logError, logDebug } from "./protocol.js";
import { makeSessionDone, makeSessionError, makeSessionEvent } from "./session-protocol.js";
import type { SessionRuntime } from "./session-runtime-manager.js";

/** Streaming deltas fire many times per second — excluded from sequence trace. */
const HIGH_FREQ_EVENTS = new Set([
	"text_delta",
	"thinking_delta",
	"message_update",
	"tool_execution_update",
]);

type PromptRuntime = Pick<
	SessionRuntime,
	"sessionFile" | "session" | "prompt" | "status" | "error"
>;

/**
 * Subscribe to a single runtime's agent events. Updates only that runtime's
 * watchdog and status fields, and tags every event with its sessionFile.
 * Returns the SDK unsubscribe function so the runtime can dispose it.
 */
export function subscribeSession(runtime: PromptRuntime): () => void {
	return runtime.session.subscribe((event: unknown) => {
		if (runtime.prompt.startedAt > 0) runtime.prompt.hasEmitted = true;
		const eventType = (event as { type?: string })?.type;
		if (eventType === "tool_execution_start" || eventType === "tool_execution_update") {
			runtime.status = "tool_call";
		} else if (eventType === "message_update") {
			runtime.status = "responding";
		} else if (eventType === "agent_start" || eventType === "turn_start") {
			runtime.status = "thinking";
		} else if (eventType === "agent_end") {
			runtime.status = "idle";
		} else if (eventType === "error") {
			runtime.status = "error";
		}
		if (eventType && !HIGH_FREQ_EVENTS.has(eventType)) {
			logDebug("event[%s]: %s", runtime.sessionFile, eventType);
		}
		send(makeSessionEvent(runtime.sessionFile, event));
	});
}

/**
 * Runs one prompt to completion on the agent session.
 * Extracted from the "prompt" command so it can be scheduled on the
 * runtime-local promptScheduler instead of being awaited inline in the
 * stdin read loop. All watchdog state lives on the runtime now.
 */
export async function runPromptTask(
	cmd: {
		id: string;
		text: string;
		_origin?: string;
	},
	runtime: PromptRuntime,
): Promise<void> {
	const promptModel = runtime.session.model;
	log("prompt[%s]: using model %s/%s", runtime.sessionFile, promptModel?.provider, promptModel?.id);
	runtime.prompt.activePromptId = cmd.id;
	runtime.prompt.startedAt = Date.now();
	runtime.prompt.hasEmitted = false;
	runtime.status = "thinking";
	runtime.error = undefined;
	logDebug("prompt[%s]: start id=%s", runtime.sessionFile, cmd.id);

	// Startup timeout (20s): if the model doesn't produce ANY agent events
	// within 20 seconds, abort the prompt.
	const STARTUP_TIMEOUT_MS = 20_000;
	const PROMPT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
	const safeAbort = () => {
		try {
			runtime.session.abort();
		} catch {
			// ignore if session already completed
		}
	};

	const startupTimer = setTimeout(() => {
		if (runtime.prompt.hasEmitted) return;
		logError(
			"prompt[%s]: no events within %dms — aborting (model may have failed to load)",
			runtime.sessionFile,
			STARTUP_TIMEOUT_MS,
		);
		safeAbort();
	}, STARTUP_TIMEOUT_MS);

	const abortTimeout = setTimeout(() => {
		logError("prompt[%s]: timeout after %dms — aborting session", runtime.sessionFile, PROMPT_TIMEOUT_MS);
		safeAbort();
	}, PROMPT_TIMEOUT_MS);

	try {
		await runtime.session.prompt(cmd.text);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		const wireError = {
			code: "provider_error" as const,
			message:
				runtime.prompt.hasEmitted || Date.now() - runtime.prompt.startedAt <= STARTUP_TIMEOUT_MS
					? msg
					: "Model failed to load or is unresponsive. Check model availability and try again.",
			retryable: true,
		};
		if (!runtime.prompt.hasEmitted) {
			logError("prompt[%s]: aborted (startup timeout) — %s", runtime.sessionFile, msg);
		} else {
			logError("prompt[%s] error: %s", runtime.sessionFile, msg);
		}
		runtime.error = wireError;
		runtime.status = "error";
		send(makeSessionError(cmd.id, runtime.sessionFile, wireError));
	} finally {
		clearTimeout(abortTimeout);
		clearTimeout(startupTimer);
		runtime.prompt.activePromptId = null;
		runtime.prompt.startedAt = 0;
		runtime.prompt.hasEmitted = false;
		send(makeSessionDone(cmd.id, runtime.sessionFile));
		logDebug("prompt[%s]: done id=%s", runtime.sessionFile, cmd.id);
		if (!runtime.error) runtime.status = "idle";
	}
}

/** Retained for protocol compat; remote sessions now auto-persist via pi. */
export function resetRemoteSession(): void {}
