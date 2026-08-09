import type { ChatMessage } from "@/types";
import type { PiEvent } from "@/types/pi-events";

/** Mirror of agent-sidecar SessionStatus — the single active stream status. */
export type SessionStatus = "idle" | "thinking" | "tool_call" | "responding" | "error";

/** Model metadata carried on snapshots and session state. */
export interface SessionModel {
	provider?: string;
	id?: string;
	name?: string;
}

export type SessionLoadStatus = "loaded" | "loading" | "error";

/** Structured wire error carried on every session-bound error envelope. */
export interface SessionWireError {
	code: string;
	message: string;
	retryable: boolean;
	details?: string;
}

/** Full snapshot of a sidecar runtime — hydrates the single active reducer. */
export interface SessionSnapshot {
	sessionFile: string;
	mode: "chat";
	cwd: string;
	messages: ChatMessage[];
	isRunning: boolean;
	status: SessionStatus;
	queue: { steering: string[]; followUp: string[] };
	model?: SessionModel;
	error?: SessionWireError;
}

/** Session-tagged event envelope delivered on prompt channels + session_event. */
export interface SessionEventEnvelope {
	type: "event";
	sessionFile: string;
	event: PiEvent;
}

/** The sidecar's ready payload (session present only on first init). */
export interface SidecarReadyPayload {
	session?: SessionSnapshot;
	defaultWorkspace?: string;
	sidecarRestarted?: boolean;
}