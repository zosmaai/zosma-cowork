/**
 * Session-aware protocol envelopes and wire types.
 *
 * Every sidecar event/result/done/error now carries an explicit canonical
 * sessionFile so the Tauri relay and frontend can route by identity instead
 * of relying on a singleton. Phase 1 keeps the frontend single-active; Phase
 * 2 will use these tags for keyed concurrency.
 */

export type SessionStatus = "idle" | "thinking" | "tool_call" | "responding" | "error";

export type SessionMode = "chat" | "work";

export type SessionErrorCode =
	| "session_not_loaded"
	| "session_load_failed"
	| "session_busy"
	| "session_aborted"
	| "session_interrupted"
	| "provider_error";

export interface SessionWireError {
	code: SessionErrorCode;
	message: string;
	retryable: boolean;
	details?: string;
}

export interface SessionSnapshot {
	sessionFile: string;
	mode: SessionMode;
	cwd: string;
	messages: Array<Record<string, unknown>>;
	isRunning: boolean;
	status: SessionStatus;
	queue: { steering: string[]; followUp: string[] };
	model?: { provider?: string; id?: string; name?: string };
	error?: SessionWireError;
}

export interface SessionEventEnvelope {
	type: "event";
	sessionFile: string;
	event: unknown;
}

export interface SessionResultEnvelope {
	type: "result";
	id: string;
	sessionFile: string;
	data: unknown;
}

export interface SessionDoneEnvelope {
	type: "done";
	id: string;
	sessionFile: string;
}

export interface SessionErrorEnvelope extends SessionWireError {
	type: "error";
	id: string;
	sessionFile: string;
}

export function makeSessionEvent(sessionFile: string, event: unknown): SessionEventEnvelope {
	return { type: "event", sessionFile, event };
}

export function makeSessionResult(
	id: string,
	sessionFile: string,
	data: unknown,
): SessionResultEnvelope {
	return { type: "result", id, sessionFile, data };
}

export function makeSessionDone(id: string, sessionFile: string): SessionDoneEnvelope {
	return { type: "done", id, sessionFile };
}

export function makeSessionError(
	id: string,
	sessionFile: string,
	error: SessionWireError,
): SessionErrorEnvelope {
	return { type: "error", id, sessionFile, ...error };
}
