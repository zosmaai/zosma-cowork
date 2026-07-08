/**
 * Helpers for detecting and recovering from mid-workflow narration stops.
 *
 * Some models (e.g. DeepSeek V4 Flash) emit a text-only response
 * ("Now let me write...", "Let me draft...") instead of calling the next
 * tool. Pi's agent loop exits on any non-tool response, so the task appears
 * done when it isn't. The continuation loop in runPromptTask uses these
 * helpers to detect the pattern and re-prompt up to MAX_CONTINUATIONS times.
 *
 * All functions are pure and dependency-free so they can be unit-tested
 * without spinning up the full sidecar.
 */

/** Maximum number of automatic re-prompts per original user turn. */
export const MAX_CONTINUATIONS = 3;

/**
 * The re-prompt text sent when a narration stop is detected.
 * Kept minimal and neutral so it doesn't add new constraints to the task.
 */
export const CONTINUATION_MSG = "Continue.";

/**
 * Returns the last assistant message in the session's message list,
 * or null if the session shape is unexpected or no assistant message exists.
 */
export function lastAssistantMessage(session: unknown): unknown | null {
	const msgs = (session as any)?.agent?.state?.messages;
	if (!Array.isArray(msgs)) return null;
	for (let i = msgs.length - 1; i >= 0; i--) {
		if ((msgs[i] as any)?.role === "assistant") return msgs[i];
	}
	return null;
}

/**
 * Returns true when `msg` is an assistant message that stopped with
 * text-only content — i.e. the model narrated instead of calling a tool.
 *
 * Conditions:
 *   - stopReason === "stop"  (not "toolUse", "aborted", or "error")
 *   - content is non-empty
 *   - every content block is "text" or "thinking" (no "toolCall")
 */
export function isTextOnlyStop(msg: unknown): boolean {
	const m = msg as any;
	if (!m || typeof m !== "object") return false;
	if (m.stopReason !== "stop") return false;
	if (!Array.isArray(m.content) || m.content.length === 0) return false;
	return m.content.every(
		(block: any) => block?.type === "text" || block?.type === "thinking",
	);
}

/**
 * Returns true when the session contains at least one assistant message
 * with a "toolCall" content block — indicating we are mid-workflow rather
 * than in a pure conversational turn.
 *
 * Without this guard, any text reply (even a finished, correct answer)
 * would trigger a spurious continuation.
 */
export function sessionHasToolCalls(session: unknown): boolean {
	const msgs = (session as any)?.agent?.state?.messages;
	if (!Array.isArray(msgs)) return false;
	return msgs.some(
		(m: any) =>
			m?.role === "assistant" &&
			Array.isArray(m.content) &&
			m.content.some((block: any) => block?.type === "toolCall"),
	);
}

/**
 * Returns true when a continuation should be attempted.
 * All three conditions must hold simultaneously.
 */
export function shouldContinue(session: unknown): boolean {
	const last = lastAssistantMessage(session);
	return isTextOnlyStop(last) && sessionHasToolCalls(session);
}
