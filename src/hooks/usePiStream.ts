import type { ChatMessage, ToolCallInfo } from "@/types";
import { log } from "../lib/log";
import type {
	PiErrorEvent,
	PiMessageUpdateEvent,
	PiToolExecutionEndEvent,
	PiToolExecutionUpdateEvent,
} from "@/types/pi-events";
import type {
	SessionEventEnvelope,
	SessionModel,
	SessionSnapshot,
	SessionLoadStatus,
	SessionWireError,
} from "@/types/session-runtime";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";

/**
 * Snapshot of the agent session's pending message queue (#201 PR 3).
 *
 * Two independent FIFO queues live inside the pi SDK's `AgentSession`:
 *  - `steering`: mid-turn course corrections; delivered after the current
 *    assistant turn's tool calls finish but before the next LLM call.
 *  - `followUp`: appended-to-the-task messages; delivered only when the
 *    agent has nothing else to do.
 *
 * The reducer keeps this slice eventually-consistent via `queue_update`
 * events from the sidecar. Optimistic dispatches (the moment the user
 * presses Enter / Alt+Enter while streaming) make the UI feel
 * instantaneous; the next `queue_update` reconciles.
 */
export interface QueueSnapshot {
	steering: string[];
	followUp: string[];
}

export interface StreamState {
	messages: ChatMessage[];
	streamingMessage: ChatMessage | null;
	isRunning: boolean;
	status: "idle" | "thinking" | "tool_call" | "responding" | "error";
	error: string | null;
	/** Structured form of the terminal error (hydration + ErrorBanner). */
	sessionError: SessionWireError | null;
	/** Session identity this state belongs to (canonical absolute file). */
	sessionFile: string | null;
	/** The addressed runtime's workspace. */
	cwd: string | null;
	/** Model metadata for this session (set on load and MODEL_INFO). */
	model?: SessionModel;
	/** True after hydration/load; false after sidecar_loss or load failure. */
	runtimeLoaded: boolean;
	loadStatus: SessionLoadStatus;
	/** True after START_STREAM until the correlated terminal done is reduced. */
	awaitingDone: boolean;
	/** Monotonic done count; survives React batching and duplicate render states. */
	settledVersion: number;
	/** Pending steer + follow-up messages — see {@link QueueSnapshot}. */
	queue: QueueSnapshot;
	/**
	 * Text of the current assistant bubble, split into one entry per pi
	 * sub-turn (#307). The LAST entry is the in-progress sub-turn; earlier
	 * entries are finalized. `streamingMessage.content` is always the
	 * non-empty segments joined by `\n\n`.
	 *
	 * Why an array instead of a flat string: a sub-turn's own text can
	 * contain `\n\n`, so we cannot reliably find sub-turn boundaries by
	 * splitting the joined string. Keeping segments separate lets us (a)
	 * snap a sub-turn to its authoritative `text_end` content without
	 * touching siblings, and (b) drop a whole sub-turn that a provider
	 * re-emitted verbatim (the opencode-go double-emit) — both impossible
	 * to do safely on a flat string.
	 */
	streamSegments: string[];
	/**
	 * Kind of every text ever queued, keyed by its text. Accumulated from
	 * queue snapshots so a message delivered mid-turn (removed from the
	 * queue just before its `message_start`) can still be labelled
	 * steer vs follow-up. Never cleared within a session — small.
	 */
	queuedKinds: Record<string, "steer" | "follow_up">;
	/**
	 * The stream's first user `message_start` is the SDK echoing the prompt
	 * we already rendered optimistically in START_STREAM — skip it once.
	 * Later user `message_start`s are delivered steer/follow-up messages.
	 */
	promptEchoConsumed: boolean;
}

/** Granular tool execution phase for richer status display */
export type ToolPhase =
	| { type: "calling"; toolName: string; args: Record<string, unknown> }
	| { type: "executing"; toolName: string; partialOutput: string }
	| { type: "done"; toolName: string }
	| { type: "error"; toolName: string; message: string };

export type StreamAction =
	| { type: "START_STREAM"; prompt: string }
	| { type: "TEXT_DELTA"; delta: string }
	| { type: "THINKING_DELTA"; delta: string }
	| { type: "MODEL_INFO"; model: string; provider: string }
	| { type: "TOOL_CALL_START"; toolCall: ToolCallInfo }
	| {
			type: "TOOL_CALL_UPDATE";
			id: string;
			result: string;
			status: "running" | "completed" | "error";
			isError?: boolean;
			details?: Record<string, unknown>;
	  }
	| {
			type: "TOOL_PARTIAL_OUTPUT";
			id: string;
			partialOutput: string;
	  }
	| { type: "TURN_RESET" }
	| { type: "MESSAGE_END" }
	| { type: "STREAM_COMPLETE" }
	| { type: "STREAM_ERROR"; error: string; sessionError?: SessionWireError }
	| { type: "ABORT_STREAM" }
	| { type: "RESET" }
	| { type: "CLEAR_MESSAGES" }
	/**
	 * Adopt a full sidecar snapshot (ready/new/load). Replaces the reducer's
	 * transcript, queue, status, running state, and structured error.
	 */
	| { type: "HYDRATE_SESSION"; snapshot: SessionSnapshot }
	| { type: "BEGIN_LOAD" }
	| { type: "LOAD_FAILED"; error: SessionWireError }
	| { type: "SET_SESSION_MODEL"; model: SessionModel }
	/**
	 * Reconciling action — dispatched on every `queue_update` event from
	 * the sidecar. Replaces the entire queue snapshot (no merge: the
	 * SDK is the source of truth).
	 */
	| { type: "QUEUE_UPDATE"; steering: string[]; followUp: string[] }
	/**
	 * Optimistic action — dispatched at the call site the moment the
	 * user presses Enter / Alt+Enter while the agent is streaming. Adds
	 * the message to BOTH the queue slice AND `messages` so a bubble
	 * shows up before the sidecar round-trip. Any divergence is healed
	 * by the next `QUEUE_UPDATE`.
	 */
	| { type: "QUEUE_OPTIMISTIC"; kind: "steer" | "follow_up"; text: string }
	/**
	 * Authoritative final text for the current sub-turn's text content.
	 * Dispatched on pi's `text_end` event. The `content` field carries
	 * the full text for this content block — not an incremental delta —
	 * so the reducer can snap the accumulated bubble content to the
	 * correct value. This fixes the word-duplication bug (#307) where
	 * replayed text_delta events cause every word to appear doubled.
	 */
	| { type: "TEXT_END"; content: string }
	/**
	 * A user message the SDK injected mid-run (delivered steer/follow-up).
	 * Arrives as a `message_start` with role "user" AFTER the prompt echo.
	 * Finalizes the current assistant bubble, inserts the user message with
	 * its steer/follow-up kind, then opens a fresh assistant bubble so the
	 * transcript reads: assistant-part-1 → [Steering …] → assistant-part-2.
	 */
	| { type: "USER_MESSAGE_STARTED"; content: string };

/** Error carried by Pi's terminal assistant message instead of an `error` event. */
export function errorFromFinalMessage(message: {
	role?: string;
	stopReason?: string;
	errorMessage?: string;
}): string | null {
	return message.role === "assistant" && message.stopReason === "error"
		? message.errorMessage || "Model response failed"
		: null;
}

export const INITIAL_STATE: StreamState = {
	messages: [],
	streamingMessage: null,
	isRunning: false,
	status: "idle",
	error: null,
	sessionError: null,
	sessionFile: null,
	cwd: null,
	model: undefined,
	runtimeLoaded: false,
	loadStatus: "loaded",
	awaitingDone: false,
	settledVersion: 0,
	queue: { steering: [], followUp: [] },
	streamSegments: [],
	queuedKinds: {},
	promptEchoConsumed: false,
};

/**
 * Fresh per-key state. Uses a factory so nested arrays/objects (queue,
 * streamSegments, queuedKinds) are never shared between map entries.
 */
export function createStreamState(sessionFile: string): StreamState {
	return {
		...INITIAL_STATE,
		sessionFile,
		queue: { steering: [], followUp: [] },
		streamSegments: [],
		queuedKinds: {},
	};
}

/** Join non-empty sub-turn segments into the bubble's rendered content. */
function joinSegments(segments: string[]): string {
	return segments.filter((s) => s.length > 0).join("\n\n");
}

/**
 * Drop the last segment when it is byte-identical to the one before it —
 * i.e. the provider re-emitted the same sub-turn (observed with the
 * opencode-go / deepseek bridge, which streams some completed text blocks
 * twice as separate `message_start → text → text_end` sequences). Exact
 * equality only: we never collapse two sub-turns the model genuinely wrote
 * the same, unless they are adjacent duplicates, which is the signature of
 * a replay, not authored repetition.
 */
function dedupeLastSegment(segments: string[]): string[] {
	const n = segments.length;
	if (n >= 2 && segments[n - 1] !== "" && segments[n - 1] === segments[n - 2]) {
		return segments.slice(0, n - 1);
	}
	return segments;
}

/** Initial tool phase state */
export const INITIAL_TOOL_PHASE: ToolPhase | null = null;

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
	switch (action.type) {
		case "START_STREAM":
			// Preserve the persisted transcript (hydrated history) and append the
			// new user prompt; reset only turn-local fields so history survives.
			return {
				...state,
				isRunning: true,
				status: "thinking",
				error: null,
				sessionError: null,
				awaitingDone: true,
				streamingMessage: {
					id: crypto.randomUUID(),
					role: "assistant",
					content: "",
					thinking: "",
					isStreaming: true,
					toolCalls: [],
					timestamp: Date.now(),
				},
				streamSegments: [],
				promptEchoConsumed: false,
				messages: [
					...state.messages,
					{
						id: crypto.randomUUID(),
						role: "user",
						content: action.prompt,
						timestamp: Date.now(),
					},
				],
			};

		case "HYDRATE_SESSION":
			// Adopt a full sidecar snapshot into the keyed reducer entry.
			return {
				...INITIAL_STATE,
				sessionFile: action.snapshot.sessionFile,
				cwd: action.snapshot.cwd,
				model: action.snapshot.model,
				messages: action.snapshot.messages,
				isRunning: action.snapshot.isRunning,
				status: action.snapshot.status,
				error: action.snapshot.error?.message ?? null,
				sessionError: action.snapshot.error ?? null,
				queue: action.snapshot.queue,
				runtimeLoaded: true,
				loadStatus: "loaded",
				awaitingDone: action.snapshot.isRunning,
			};

		case "BEGIN_LOAD":
			return { ...state, loadStatus: "loading" };

		case "LOAD_FAILED":
			return {
				...state,
				isRunning: false,
				status: "error",
				error: action.error.message,
				sessionError: action.error,
				runtimeLoaded: false,
				loadStatus: "error",
			};

		case "SET_SESSION_MODEL":
			return { ...state, model: action.model };

		/**
		 * TURN_RESET — Soft boundary at the start of each assistant sub-message
		 * within ONE agent run. We deliberately do NOT clear content/thinking/
		 * tools: a single user turn maps to a SINGLE assistant bubble that
		 * accumulates all sub-turns (think → tool → think → … → answer). We only
		 * insert separators so the latest thinking/text stays readable.
		 */
		case "TURN_RESET": {
			const msg = state.streamingMessage;
			if (!msg) return state;
			const prevThinking = msg.thinking || "";
			// Finalize the current sub-turn (deduping it against the previous one
			// in case the provider re-emitted it without a `text_end`), then open
			// a fresh empty segment for the sub-turn that's about to start.
			const segments = [...dedupeLastSegment(state.streamSegments), ""];
			return {
				...state,
				streamSegments: segments,
				streamingMessage: {
					...msg,
					// New sub-turn's thinking starts on a fresh line so the simple
					// view's "latest thought" picks up the newest reasoning.
					thinking:
						prevThinking && !prevThinking.endsWith("\n") ? `${prevThinking}\n` : prevThinking,
					content: joinSegments(segments),
					isStreaming: true,
				},
				status: "thinking",
			};
		}

		/**
		 * MESSAGE_END — No-op in the single-bubble model. A pi `message_end`
		 * marks the end of one sub-message, but we keep accumulating into the
		 * same streaming bubble and only finalize on STREAM_COMPLETE. Kept as a
		 * named case so the event handler stays explicit.
		 */
		case "MESSAGE_END":
			return state;

		case "TEXT_DELTA": {
			const msg = state.streamingMessage;
			if (!msg) return state;
			// Append to the current sub-turn segment (lazily create one if no
			// message_start has opened it yet).
			const segs = state.streamSegments.length > 0 ? [...state.streamSegments] : [""];
			segs[segs.length - 1] += action.delta;
			return {
				...state,
				streamSegments: segs,
				streamingMessage: { ...msg, content: joinSegments(segs) },
				status: "responding",
			};
		}

		case "THINKING_DELTA": {
			const msg = state.streamingMessage;
			if (!msg) return state;
			return {
				...state,
				streamingMessage: {
					...msg,
					thinking: (msg.thinking || "") + action.delta,
				},
				status: "thinking",
			};
		}

		/**
		 * TEXT_END — Snap accumulated text deltas to authoritative final
		 * content from pi's `text_end` event (#307). Fixes word-duplication
		 * when the same text_delta events are replayed (e.g. after
		 * noheadroom compaction). Only replaces the current sub-turn's
		 * text (after the last `\n\n` separator from TURN_RESET), preserving
		 * previous sub-turns' content in the single-bubble model.
		 */
		case "TEXT_END": {
			const msg = state.streamingMessage;
			if (!msg) return state;
			// Snap the current sub-turn to pi's authoritative final text (kills
			// word-doubling from replayed deltas), then drop it entirely if it
			// duplicates the previous sub-turn (kills provider double-emit).
			const base = state.streamSegments.length > 0 ? [...state.streamSegments] : [""];
			base[base.length - 1] = action.content;
			const segs = dedupeLastSegment(base);
			return {
				...state,
				streamSegments: segs,
				streamingMessage: { ...msg, content: joinSegments(segs) },
				status: "responding",
			};
		}

		case "MODEL_INFO": {
			const msg = state.streamingMessage;
			if (!msg) return { ...state, model: { provider: action.provider, id: action.model } };
			return {
				...state,
				model: { provider: action.provider, id: action.model },
				streamingMessage: {
					...msg,
					model: action.model,
					provider: action.provider,
				},
			};
		}

		case "TOOL_CALL_START": {
			const msg = state.streamingMessage;
			if (!msg) return state;
			const existing = msg.toolCalls || [];
			if (existing.some((tc) => tc.id === action.toolCall.id)) return state;
			return {
				...state,
				streamingMessage: {
					...msg,
					toolCalls: [...existing, action.toolCall],
				},
				status: "tool_call",
			};
		}

		case "TOOL_CALL_UPDATE": {
			// Update tool calls in streamingMessage
			let sm = state.streamingMessage;
			if (sm?.toolCalls) {
				sm = {
					...sm,
					toolCalls: sm.toolCalls.map((tc) =>
						tc.id === action.id
							? {
									...tc,
									status: action.status,
									result: action.result,
									isError: action.isError,
									details: action.details,
								}
							: tc,
					),
				};
			}
			// Also update tool calls in messages[] (for tool calls that were
			// defined in a previous assistant message that got flushed via MESSAGE_END)
			const newMessages = state.messages.map((m) => {
				if (!m.toolCalls?.some((tc) => tc.id === action.id)) return m;
				return {
					...m,
					toolCalls: m.toolCalls.map((tc) =>
						tc.id === action.id
							? {
									...tc,
									status: action.status,
									result: action.result,
									isError: action.isError,
									details: action.details,
								}
							: tc,
					),
				};
			});
			return { ...state, messages: newMessages, streamingMessage: sm ?? state.streamingMessage };
		}

		case "TOOL_PARTIAL_OUTPUT": {
			let sm = state.streamingMessage;
			if (sm?.toolCalls) {
				sm = {
					...sm,
					toolCalls: sm.toolCalls.map((tc) =>
						tc.id === action.id ? { ...tc, partialOutput: action.partialOutput } : tc,
					),
				};
			}
			// Also update partial output in messages[]
			const newMessages = state.messages.map((m) => {
				if (!m.toolCalls?.some((tc) => tc.id === action.id)) return m;
				return {
					...m,
					toolCalls: m.toolCalls.map((tc) =>
						tc.id === action.id ? { ...tc, partialOutput: action.partialOutput } : tc,
					),
				};
			});
			return { ...state, messages: newMessages, streamingMessage: sm ?? state.streamingMessage };
		}

		case "STREAM_COMPLETE": {
			const msg = state.streamingMessage;
			const settledVersion = state.settledVersion + (state.awaitingDone ? 1 : 0);
			if (!msg) {
				return state.error
					? {
							...state,
							isRunning: false,
							status: "error",
							streamingMessage: null,
							awaitingDone: false,
							settledVersion,
						}
					: {
							...state,
							isRunning: false,
							status: "idle",
							streamingMessage: null,
							awaitingDone: false,
							settledVersion,
						};
			}
			// Skip empty streaming messages — MESSAGE_END creates a fresh
			// blank streaming message after finalizing the real content,
			// and STREAM_COMPLETE can fire after that, adding a ghost.
			const isEmpty =
				!msg.content && !msg.thinking && (!msg.toolCalls || msg.toolCalls.length === 0);
			if (isEmpty) {
				return {
					...state,
					isRunning: false,
					status: "idle",
					streamingMessage: null,
					awaitingDone: false,
					settledVersion,
				};
			}
			return {
				...state,
				isRunning: false,
				status: "idle",
				messages: [...state.messages, { ...msg, isStreaming: false }],
				streamingMessage: null,
				awaitingDone: false,
				settledVersion,
			};
		}

		case "STREAM_ERROR": {
			// Preserve whatever the assistant streamed before failing (pi keeps
			// partial output on error) and finalize it into the transcript, so a
			// mid-stream provider/tool error doesn't leave a frozen half-streamed
			// bubble stuck in the "streaming" state — the "stops mid" symptom.
			const msg = state.streamingMessage;
			const hasContent =
				msg && (msg.content || msg.thinking || (msg.toolCalls && msg.toolCalls.length > 0));
			return {
				...state,
				isRunning: false,
				status: "error",
				error: action.error,
				// Structured error (if provided) surfaces in session introspection;
				// the unchanged awaitingDone keeps the guaranteed `done` terminal.
				sessionError: action.sessionError ?? state.sessionError,
				messages: hasContent
					? [...state.messages, { ...(msg as ChatMessage), isStreaming: false }]
					: state.messages,
				streamingMessage: null,
			};
		}

		case "ABORT_STREAM": {
			const current = state.streamingMessage;
			const hasContent =
				current &&
				(current.content ||
					current.thinking ||
					(current.toolCalls && current.toolCalls.length > 0));
			if (hasContent) {
				return {
					...state,
					isRunning: false,
					status: "idle",
					messages: [...state.messages, { ...current, isStreaming: false }],
					streamingMessage: null,
				};
			}
			return { ...state, isRunning: false, status: "idle" };
		}

		case "USER_MESSAGE_STARTED": {
			// First user message_start = the prompt echo we already rendered.
			if (!state.promptEchoConsumed) {
				return { ...state, promptEchoConsumed: true };
			}
			const kind =
				state.queuedKinds[action.content] === "follow_up"
					? "queued-follow-up"
					: "queued-steer";
			// Finalize the assistant work so far into its own bubble so the
			// delivered user message lands AFTER it, not before.
			const prev = state.streamingMessage;
			const prevIsEmpty =
				!prev ||
				(!prev.content && !prev.thinking && (!prev.toolCalls || prev.toolCalls.length === 0));
			const finalized: ChatMessage[] =
				prev && !prevIsEmpty ? [{ ...prev, isStreaming: false }] : [];
			return {
				...state,
				messages: [
					...state.messages,
					...finalized,
					{
						id: crypto.randomUUID(),
						role: "user",
						content: action.content,
						timestamp: Date.now(),
						kind,
					},
				],
				// Fresh bubble for the assistant's response to the injected message.
				streamingMessage: {
					id: crypto.randomUUID(),
					role: "assistant",
					content: "",
					thinking: "",
					isStreaming: true,
					toolCalls: [],
					timestamp: Date.now(),
				},
				streamSegments: [],
				status: "thinking",
			};
		}

		case "RESET":
			return INITIAL_STATE;

		case "CLEAR_MESSAGES":
			return state.error
				? { ...INITIAL_STATE, error: state.error, sessionError: state.sessionError, status: "error" }
				: INITIAL_STATE;

		case "QUEUE_UPDATE": {
			const queuedKinds = { ...state.queuedKinds };
			for (const t of action.steering) queuedKinds[t] = "steer";
			for (const t of action.followUp) queuedKinds[t] = "follow_up";
			return {
				...state,
				queuedKinds,
				queue: {
					steering: [...action.steering],
					followUp: [...action.followUp],
				},
			};
		}

		case "QUEUE_OPTIMISTIC": {
			// Issue #201 PR3 follow-up: optimistic queue bubbles live ONLY in
			// state.queue, never in state.messages. ChatView renders queued
			// items from state.queue AFTER the streaming AI message so they
			// appear chronologically below "work currently in flight". Keeping
			// them out of messages also means Ctrl+↑ → clearQueue() →
			// QUEUE_UPDATE(empty) atomically removes every visible queued
			// bubble — no orphan-duplicate bug (#201 follow-up screenshot).
			return {
				...state,
				queuedKinds: { ...state.queuedKinds, [action.text]: action.kind },
				queue:
					action.kind === "steer"
						? {
								...state.queue,
								steering: [...state.queue.steering, action.text],
							}
						: {
								...state.queue,
								followUp: [...state.queue.followUp, action.text],
							},
			};
		}

		default:
			return state;
	}
}

export type SessionStreamsState = Map<string, StreamState>;

export type SessionStreamsAction =
	| { type: "APPLY"; sessionFile: string; action: StreamAction }
	| { type: "REMOVE_SESSION"; sessionFile: string }
	| { type: "SIDECAR_LOST" };

export const INITIAL_SESSION_STREAMS: SessionStreamsState = new Map();

export function sessionStreamsReducer(
	states: SessionStreamsState,
	action: SessionStreamsAction,
): SessionStreamsState {
	if (action.type === "REMOVE_SESSION") {
		if (!states.has(action.sessionFile)) return states;
		const next = new Map(states);
		next.delete(action.sessionFile);
		return next;
	}

	if (action.type === "SIDECAR_LOST") {
		const next = new Map(states);
		const error: SessionWireError = {
			code: "session_interrupted",
			message: "Session stopped because the sidecar restarted",
			retryable: true,
		};
		for (const [sessionFile, state] of states) {
			const interrupted =
				state.loadStatus === "loading"
					? streamReducer(state, { type: "LOAD_FAILED", error })
					: state.isRunning
						? streamReducer(state, {
								type: "STREAM_ERROR",
								error: error.message,
								sessionError: error,
							})
						: state;
			next.set(sessionFile, {
				...interrupted,
				runtimeLoaded: false,
				awaitingDone: false,
			});
		}
		return next;
	}

	const current = states.get(action.sessionFile) ?? createStreamState(action.sessionFile);
	const updated = streamReducer(current, action.action);
	if (updated === current && states.has(action.sessionFile)) return states;
	const next = new Map(states);
	next.set(action.sessionFile, updated);
	return next;
}

function extractToolCallInfo(tc: {
	id: string;
	name?: string;
	arguments?: Record<string, unknown>;
}): ToolCallInfo {
	return {
		id: tc.id,
		name: tc.name || "unknown",
		args: tc.arguments || {},
		status: "running" as const,
	};
}

export function usePiStream(activeSessionFile: string | null) {
	const [states, dispatchSessions] = useReducer(
		sessionStreamsReducer,
		INITIAL_SESSION_STREAMS,
	);
	const statesRef = useRef(states);
	const loadedRef = useRef(new Set<string>());
	const loadingRef = useRef(new Map<string, Promise<SessionSnapshot>>());
	const deletedRef = useRef(new Set<string>());
	const sidecarEpochRef = useRef(0);
	const listenerReadyRef = useRef<Promise<void> | null>(null);
	const resolveListenerReadyRef = useRef<(() => void) | null>(null);
	if (!listenerReadyRef.current) {
		listenerReadyRef.current = new Promise<void>((resolve) => {
			resolveListenerReadyRef.current = resolve;
		});
	}

	useLayoutEffect(() => {
		statesRef.current = states;
	}, [states]);

	const state = activeSessionFile
		? states.get(activeSessionFile) ?? createStreamState(activeSessionFile)
		: INITIAL_STATE;

	const dispatchTo = useCallback((sessionFile: string, action: StreamAction) => {
		dispatchSessions({ type: "APPLY", sessionFile, action });
	}, []);

	const hydrateSession = useCallback((snapshot: SessionSnapshot) => {
		if (deletedRef.current.has(snapshot.sessionFile)) return;
		loadedRef.current.add(snapshot.sessionFile);
		dispatchTo(snapshot.sessionFile, { type: "HYDRATE_SESSION", snapshot });
	}, [dispatchTo]);

	const ensureSession = useCallback(async (sessionFile: string): Promise<SessionSnapshot | null> => {
		await listenerReadyRef.current;
		if (deletedRef.current.has(sessionFile)) throw new Error("Session was deleted");
		if (loadedRef.current.has(sessionFile)) return null;
		const pending = loadingRef.current.get(sessionFile);
		if (pending) return pending;

		const epoch = sidecarEpochRef.current;
		dispatchTo(sessionFile, { type: "BEGIN_LOAD" });
		// biome-ignore lint/style/useConst: self-referential promise (finally compares against `load` to avoid clearing a replacement's entry)
		let load!: Promise<SessionSnapshot>;
		load = invoke<SessionSnapshot>("load_session", { sessionFile })
			.then((snapshot) => {
				if (deletedRef.current.has(sessionFile) || epoch !== sidecarEpochRef.current) {
					throw new Error("Session load was invalidated");
				}
				hydrateSession(snapshot);
				return snapshot;
			})
			.catch((error) => {
				if (!deletedRef.current.has(sessionFile) && epoch === sidecarEpochRef.current) {
					const wireError: SessionWireError = {
						code: "session_load_failed",
						message: error instanceof Error ? error.message : String(error),
						retryable: true,
					};
					dispatchTo(sessionFile, { type: "LOAD_FAILED", error: wireError });
				}
				throw error;
			})
			.finally(() => {
				if (loadingRef.current.get(sessionFile) === load) loadingRef.current.delete(sessionFile);
			});
		loadingRef.current.set(sessionFile, load);
		return load;
	}, [dispatchTo, hydrateSession]);

	// ponytail: process epoch is enough for the current non-replay relay; add
	// envelope sequence cursors only if transport replay/reconnect is introduced.

	const startStream = useCallback(async (sessionFile: string, text: string) => {
		await ensureSession(sessionFile);
		dispatchTo(sessionFile, { type: "START_STREAM", prompt: text });
		try {
			await invoke("send_prompt", { sessionFile, text });
		} catch (error) {
			dispatchTo(sessionFile, {
				type: "STREAM_ERROR",
				error: error instanceof Error ? error.message : String(error),
			});
			dispatchTo(sessionFile, { type: "STREAM_COMPLETE" });
		}
	}, [dispatchTo, ensureSession]);

	const abortStream = useCallback(async (sessionFile: string): Promise<boolean> => {
		try {
			await invoke("abort_prompt", { sessionFile });
			dispatchTo(sessionFile, { type: "ABORT_STREAM" });
			return true;
		} catch (error) {
			log.warn("[cowork] abort_prompt rejected:", error);
			return false;
		}
	}, [dispatchTo]);

	/**
	 * Queue a steering message on the running session (issue #201, PR 1).
	 * Mid-turn course correction — the agent picks it up after its current
	 * tool batch finishes, before the next LLM call. Errors from the sidecar
	 * (extension command, empty text, etc.) are logged but not re-thrown:
	 * the composer's textarea is already cleared on submit so we don't want
	 * to surface a stack trace mid-conversation. Future PR may surface them
	 * as a transient toast.
	 */
	const steerStream = useCallback(async (sessionFile: string, text: string) => {
		// Optimistic: surface the user bubble immediately so the UI doesn't
		// feel like the message vanished. The next queue_update event will
		// reconcile (no-op if it matches; visible if SDK rejected text).
		dispatchTo(sessionFile, { type: "QUEUE_OPTIMISTIC", kind: "steer", text });
		try {
			await invoke("steer_prompt", { sessionFile, text });
		} catch (err) {
			log.warn("[cowork] steer_prompt rejected:", err);
		}
	}, [dispatchTo]);

	/**
	 * Queue a follow-up message on the running session (issue #201, PR 1).
	 * Delivered after the agent finishes all current work. Same error
	 * handling rationale as {@link steerStream}.
	 */
	const followUpStream = useCallback(async (sessionFile: string, text: string) => {
		dispatchTo(sessionFile, { type: "QUEUE_OPTIMISTIC", kind: "follow_up", text });
		try {
			await invoke("follow_up_prompt", { sessionFile, text });
		} catch (err) {
			log.warn("[cowork] follow_up_prompt rejected:", err);
		}
	}, [dispatchTo]);

	/**
	 * Atomically drain the SDK queue and return its contents. Issue #201
	 * PR 3 — the composer calls this when the user presses Ctrl+↑ to edit
	 * pending queued messages. The queue is left empty on return; if the
	 * user wants to re-send any pulled message they re-queue it via
	 * steerStream/followUpStream. Returns empty arrays on failure (so the
	 * caller can render "nothing to edit" rather than crash).
	 */
	const clearQueue = useCallback(async (sessionFile: string): Promise<QueueSnapshot> => {
		try {
			const raw = (await invoke("clear_queue", { sessionFile })) as {
				steering?: string[];
				followUp?: string[];
			};
			return {
				steering: raw.steering ?? [],
				followUp: raw.followUp ?? [],
			};
		} catch (err) {
			log.warn("[cowork] clear_queue rejected:", err);
			return { steering: [], followUp: [] };
		}
	}, []);

	const setSessionModel = useCallback((sessionFile: string, model: SessionModel) => {
		dispatchTo(sessionFile, { type: "SET_SESSION_MODEL", model });
	}, [dispatchTo]);

	const removeSession = useCallback((sessionFile: string) => {
		deletedRef.current.add(sessionFile);
		loadedRef.current.delete(sessionFile);
		loadingRef.current.delete(sessionFile);
		dispatchSessions({ type: "REMOVE_SESSION", sessionFile });
	}, []);

	/**
	 * Route ONE global `session_event` envelope to its keyed reducer entry.
	 * `agent_end` intentionally dispatches nothing: the normalized terminal
	 * `done` is the authoritative completion (Phase 1 prompt contract), and
	 * dispatching STREAM_COMPLETE on both would double-finalize one prompt.
	 */
	const handleEnvelope = useCallback((envelope: SessionEventEnvelope) => {
		const sessionFile = envelope.sessionFile;
		if (!sessionFile || deletedRef.current.has(sessionFile)) return;
		const event = envelope.event;
		try {
			switch (event.type) {
				case "message_update": {
					const msgEvent = event as PiMessageUpdateEvent;
					const ame = msgEvent.assistantMessageEvent;

					if (msgEvent.message?.model || msgEvent.message?.provider) {
						dispatchTo(sessionFile, {
							type: "MODEL_INFO",
							model: msgEvent.message.model || "",
							provider: msgEvent.message.provider || "",
						});
					}

					switch (ame.type) {
						case "thinking_delta":
							dispatchTo(sessionFile, { type: "THINKING_DELTA", delta: ame.delta });
							break;
						case "text_delta":
							dispatchTo(sessionFile, { type: "TEXT_DELTA", delta: ame.delta });
							break;
						/**
						 * text_end — pi emits this when a streaming content block
						 * completes. The `content` field has the authoritative final
						 * text, correcting any delta accumulation errors (#307).
						 */
						case "text_end":
							if (ame.content) {
								dispatchTo(sessionFile, { type: "TEXT_END", content: ame.content });
							}
							break;
						case "toolcall_end": {
							const tc = ame.toolCall;
							dispatchTo(sessionFile, {
								type: "TOOL_CALL_START",
								toolCall: extractToolCallInfo(tc),
							});
							break;
						}
						case "error":
							// Forward the actual error reason or message, not
							// a generic placeholder. Provider 400/500 errors
							// carry the API response in `reason` or `message`,
							// not just "aborted".
							dispatchTo(sessionFile, {
								type: "STREAM_ERROR",
								error:
									(ame as unknown as { message?: string }).message || ame.reason || "API error",
							});
							break;
					}
					break;
				}

				case "message_start": {
					if (event.message?.role === "assistant") {
						dispatchTo(sessionFile, { type: "TURN_RESET" });
					} else if (event.message?.role === "user") {
						// SDK-injected user message: the prompt echo (skipped once)
						// or a delivered steer/follow-up. Extract its text.
						const content = (event.message.content || [])
							.filter((c) => c.type === "text")
							.map((c) => (c as { text: string }).text)
							.join("");
						dispatchTo(sessionFile, { type: "USER_MESSAGE_STARTED", content });
					}
					break;
				}

				// No separate state: status is already driven by tool-call events.
				case "tool_execution_start":
					break;

				case "tool_execution_update": {
					const te = event as PiToolExecutionUpdateEvent;
					const partialText = (te.partialResult?.content || []).map((c) => c.text).join("");
					dispatchTo(sessionFile, {
						type: "TOOL_CALL_UPDATE",
						id: te.toolCallId,
						result: partialText,
						status: "running",
					});
					dispatchTo(sessionFile, {
						type: "TOOL_PARTIAL_OUTPUT",
						id: te.toolCallId,
						partialOutput: partialText,
					});
					break;
				}

				case "tool_execution_end": {
					const te = event as PiToolExecutionEndEvent;
					dispatchTo(sessionFile, {
						type: "TOOL_CALL_UPDATE",
						id: te.toolCallId,
						result: (te.result?.content || []).map((c) => c.text).join(""),
						status: te.isError ? "error" : "completed",
						isError: te.isError,
						details: te.result?.details as Record<string, unknown> | undefined,
					});
					break;
				}

				case "message_end": {
					const error = errorFromFinalMessage(event.message);
					dispatchTo(
						sessionFile,
						error ? { type: "STREAM_ERROR", error } : { type: "MESSAGE_END" },
					);
					break;
				}

				case "agent_end":
					// No reducer terminal — the guaranteed normalized `done` settles.
					break;

				case "done":
					dispatchTo(sessionFile, { type: "STREAM_COMPLETE" });
					break;

				// Pi SDK session-level queue snapshot (#201 PR 3).
				case "queue_update": {
					const qe = event as unknown as {
						steering?: string[];
						followUp?: string[];
					};
					dispatchTo(sessionFile, {
						type: "QUEUE_UPDATE",
						steering: qe.steering ?? [],
						followUp: qe.followUp ?? [],
					});
					break;
				}

				case "error": {
					const errEvent = event as PiErrorEvent;
					const wireError: SessionWireError = {
						code: errEvent.code ?? "provider_error",
						message: errEvent.message || errEvent.details || "Unknown error",
						retryable: errEvent.retryable ?? false,
						details: errEvent.details,
					};
					dispatchTo(sessionFile, {
						type: "STREAM_ERROR",
						error: wireError.message,
						sessionError: wireError,
					});
					break;
				}
				default:
					break;
			}
		} catch (err) {
			log.error("[cowork] Error processing event:", err, event);
		}
	}, [dispatchTo]);

	/**
	 * Subscribe once to the canonical relay streams. The listener gate
	 * resolves only after BOTH subscriptions exist, so no prompt/load can
	 * precede a registered listener (startStream/ensureSession await it).
	 * Sidecar loss bumps the process epoch so old loads cannot hydrate.
	 */
	useEffect(() => {
		let disposed = false;
		let unlistenSession: (() => void) | undefined;
		let unlistenLost: (() => void) | undefined;

		void Promise.all([
			listen<SessionEventEnvelope>("session_event", ({ payload }) => {
				if (!payload?.sessionFile || deletedRef.current.has(payload.sessionFile)) return;
				handleEnvelope(payload);
			}),
			listen("sidecar_lost", () => {
				sidecarEpochRef.current += 1;
				loadedRef.current.clear();
				loadingRef.current.clear();
				dispatchSessions({ type: "SIDECAR_LOST" });
			}),
		]).then(([sessionUnlisten, lostUnlisten]) => {
			if (disposed) {
				sessionUnlisten();
				lostUnlisten();
				return;
			}
			unlistenSession = sessionUnlisten;
			unlistenLost = lostUnlisten;
			resolveListenerReadyRef.current?.();
		});

		return () => {
			disposed = true;
			unlistenSession?.();
			unlistenLost?.();
		};
	}, [handleEnvelope]);

	return {
		state,
		states,
		getSessionState: (sessionFile: string) => statesRef.current.get(sessionFile),
		hydrateSession,
		ensureSession,
		startStream,
		abortStream,
		steerStream,
		followUpStream,
		clearQueue,
		setSessionModel,
		removeSession,
		// Compatibility dispatch for App reset/error paths — mutates only the
		// active key (or nothing when no session is active).
		dispatch: (action: StreamAction) => {
			if (activeSessionFile) dispatchTo(activeSessionFile, action);
		},
	};
}
