import {
	type SessionStats,
	THINKING_LEVELS,
	type ThinkingLevel,
	type ThinkingState,
} from "@/lib/sessionStats";
import type { ChatMessage, ToolCallInfo } from "@/types";
import type {
	PiErrorEvent,
	PiEvent,
	PiMessageUpdateEvent,
	PiToolExecutionEndEvent,
	PiToolExecutionStartEvent,
	PiToolExecutionUpdateEvent,
} from "@/types/pi-events";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useReducer, useState } from "react";

/** Default reasoning slice before the sidecar reports the real level (#268). */
const INITIAL_THINKING: ThinkingState = {
	level: "medium",
	available: [...THINKING_LEVELS],
	supported: true,
	// Not yet confirmed by the engine — the status-line pill stays hidden until
	// the sidecar reports the model's real reasoning capability, so we never
	// flash a misleading "Medium" for a model that can't reason.
	known: false,
};

/** Build a confirmed ThinkingState from a sidecar reasoning response. */
function toThinkingState(res: {
	thinkingLevel?: ThinkingLevel;
	availableThinkingLevels?: ThinkingLevel[];
	supportsThinking?: boolean;
}): ThinkingState {
	return {
		level: res.thinkingLevel as ThinkingLevel,
		available:
			res.availableThinkingLevels && res.availableThinkingLevels.length > 0
				? res.availableThinkingLevels
				: [...THINKING_LEVELS],
		supported: res.supportsThinking ?? true,
		known: true,
	};
}

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
	| { type: "STREAM_ERROR"; error: string }
	| { type: "ABORT_STREAM" }
	| { type: "RESET" }
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
	| { type: "TEXT_END"; content: string };

export const INITIAL_STATE: StreamState = {
	messages: [],
	streamingMessage: null,
	isRunning: false,
	status: "idle",
	error: null,
	queue: { steering: [], followUp: [] },
	streamSegments: [],
};

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
			return {
				...INITIAL_STATE,
				isRunning: true,
				status: "thinking",
				messages: [
					{
						id: crypto.randomUUID(),
						role: "user",
						content: action.prompt,
						timestamp: Date.now(),
					},
				],
				streamingMessage: {
					id: crypto.randomUUID(),
					role: "assistant",
					content: "",
					thinking: "",
					isStreaming: true,
					toolCalls: [],
					timestamp: Date.now(),
				},
			};

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
			if (!msg) return state;
			return {
				...state,
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
			if (!msg) {
				return { ...state, isRunning: false, status: "idle", streamingMessage: null };
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
				};
			}
			return {
				...state,
				isRunning: false,
				status: "idle",
				messages: [...state.messages, { ...msg, isStreaming: false }],
				streamingMessage: null,
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

		case "RESET":
			return INITIAL_STATE;

		case "QUEUE_UPDATE":
			return {
				...state,
				queue: {
					steering: [...action.steering],
					followUp: [...action.followUp],
				},
			};

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

export function usePiStream() {
	const [state, dispatch] = useReducer(streamReducer, INITIAL_STATE);
	const [toolPhase, setToolPhase] = useState<ToolPhase | null>(null);
	// #268 — always-on status-line telemetry. `sessionStats` is the
	// authoritative snapshot from the sidecar (token/cache/cost + live context
	// usage); `thinking` mirrors the engine's current reasoning level + the
	// model-supported ladder. Both live as plain state (not in the reducer)
	// since they're fetched async and don't participate in streaming reducer
	// transitions.
	const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
	const [thinking, setThinking] = useState<ThinkingState>(INITIAL_THINKING);

	/**
	 * Pull the authoritative session stats from the sidecar. Called after each
	 * turn completes and on session load/reset. No-ops gracefully off-Tauri
	 * (remote/browser mode) where the command isn't available.
	 */
	const refreshStats = useCallback(async () => {
		if (!isTauri()) return;
		try {
			const stats = (await invoke("get_session_stats")) as SessionStats;
			setSessionStats(stats);
			if (stats.thinkingLevel) {
				setThinking(toThinkingState(stats));
			}
		} catch (err) {
			console.warn("[cowork] get_session_stats failed:", err);
		}
	}, []);

	/** Apply a specific thinking level; reconciles to the engine's effective
	 * (clamped) level returned by the sidecar. */
	const applyThinkingLevel = useCallback(async (level: ThinkingLevel) => {
		if (!isTauri()) {
			setThinking((prev) => ({ ...prev, level }));
			return;
		}
		// Optimistic — snap the pill immediately, reconcile on the result.
		setThinking((prev) => ({ ...prev, level }));
		try {
			const res = (await invoke("set_thinking_level", { level })) as {
				thinkingLevel?: ThinkingLevel;
				availableThinkingLevels?: ThinkingLevel[];
				supportsThinking?: boolean;
			};
			if (res?.thinkingLevel) {
				setThinking(toThinkingState(res));
			}
		} catch (err) {
			console.warn("[cowork] set_thinking_level failed:", err);
		}
	}, []);

	/** Advance reasoning to the next supported level (clickable pill). */
	const cycleThinking = useCallback(async () => {
		if (!isTauri()) return;
		try {
			const res = (await invoke("cycle_thinking_level")) as {
				thinkingLevel?: ThinkingLevel;
				availableThinkingLevels?: ThinkingLevel[];
				supportsThinking?: boolean;
			};
			if (res?.thinkingLevel) {
				setThinking(toThinkingState(res));
			}
		} catch (err) {
			console.warn("[cowork] cycle_thinking_level failed:", err);
		}
	}, []);

	const startStream = useCallback(
		async (text: string) => {
			dispatch({ type: "START_STREAM", prompt: text });

			const channel = new Channel<PiEvent>();

			channel.onmessage = (event: PiEvent) => {
				try {
					switch (event.type) {
						case "message_update": {
							const msgEvent = event as PiMessageUpdateEvent;
							const ame = msgEvent.assistantMessageEvent;

							if (msgEvent.message?.model || msgEvent.message?.provider) {
								dispatch({
									type: "MODEL_INFO",
									model: msgEvent.message.model || "",
									provider: msgEvent.message.provider || "",
								});
							}

							switch (ame.type) {
								case "thinking_delta":
									dispatch({ type: "THINKING_DELTA", delta: ame.delta });
									break;
								case "text_delta":
									dispatch({ type: "TEXT_DELTA", delta: ame.delta });
									break;
								/**
								 * text_end — pi emits this when a streaming content block
								 * completes. The `content` field has the authoritative final
								 * text, correcting any delta accumulation errors (#307).
								 */
								case "text_end":
									if (ame.content) {
										dispatch({ type: "TEXT_END", content: ame.content });
									}
									break;
								case "toolcall_end": {
									const tc = ame.toolCall;
									dispatch({
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
									dispatch({
										type: "STREAM_ERROR",
										error: (ame as unknown as { message?: string }).message || ame.reason || "API error",
									});
									break;
							}
							break;
						}

						case "message_start": {
							if (event.message?.role === "assistant") {
								dispatch({ type: "TURN_RESET" });
							}
							break;
						}

						case "tool_execution_start": {
							const te = event as PiToolExecutionStartEvent;
							setToolPhase({
								type: "calling",
								toolName: te.toolName,
								args: te.args as Record<string, unknown>,
							});
							break;
						}

						case "tool_execution_update": {
							const te = event as PiToolExecutionUpdateEvent;
							const partialText = (te.partialResult?.content || []).map((c) => c.text).join("");
							dispatch({
								type: "TOOL_CALL_UPDATE",
								id: te.toolCallId,
								result: partialText,
								status: "running",
							});
							dispatch({
								type: "TOOL_PARTIAL_OUTPUT",
								id: te.toolCallId,
								partialOutput: partialText,
							});
							setToolPhase({
								type: "executing",
								toolName: te.toolName,
								partialOutput: partialText,
							});
							break;
						}

						case "tool_execution_end": {
							const te = event as PiToolExecutionEndEvent;
							dispatch({
								type: "TOOL_CALL_UPDATE",
								id: te.toolCallId,
								result: (te.result?.content || []).map((c) => c.text).join(""),
								status: te.isError ? "error" : "completed",
								isError: te.isError,
								details: te.result?.details as Record<string, unknown> | undefined,
							});
							setToolPhase(
								te.isError
									? { type: "error", toolName: te.toolName, message: "Tool failed" }
									: { type: "done", toolName: te.toolName },
							);
							break;
						}

						case "message_end": {
							dispatch({ type: "MESSAGE_END" });
							// #268 — each assistant message carries finalized usage; refresh
							// so token/cost/context update per sub-message within a run, not
							// only at the very end (agent_end). Feels closer to realtime.
							void refreshStats();
							break;
						}

						case "agent_end":
						case "done":
							dispatch({ type: "STREAM_COMPLETE" });
							// #268 — a turn just finished: pull fresh token/cost/context
							// totals so the status line updates as turns complete.
							void refreshStats();
							break;

						case "error": {
							const errEvent = event as PiErrorEvent;
							// Prefer pi's structured payload (v0.3.0+) over the bare
							// message: surface the provider and a retry hint so the
							// ErrorBanner is actionable instead of a generic string.
							const base = errEvent.message || errEvent.details || "Unknown error";
							const where = errEvent.provider
								? ` (${errEvent.provider}${errEvent.model ? `/${errEvent.model}` : ""})`
								: "";
							const hint = errEvent.retryable ? " — retrying may help" : "";
							dispatch({
								type: "STREAM_ERROR",
								error: `${base}${where}${hint}`,
							});
							break;
						}

						// Pi SDK session-level queue snapshot (#201 PR 3). Arrives
						// on every steer/follow-up enqueue, dequeue, and clear.
						// The Rust layer also emits this globally (see
						// `listen("queue_update")` below) so the queue stays in
						// sync even when no prompt channel is active.
						case "queue_update": {
							const qe = event as unknown as {
								steering?: string[];
								followUp?: string[];
							};
							dispatch({
								type: "QUEUE_UPDATE",
								steering: qe.steering ?? [],
								followUp: qe.followUp ?? [],
							});
							break;
						}
					}
				} catch (err) {
					console.error("[cowork] Error processing event:", err, event);
				}
			};

			try {
				await invoke("send_prompt", { text, ch: channel });
			} catch (err) {
				dispatch({
					type: "STREAM_ERROR",
					error: err instanceof Error ? err.message : String(err),
				});
			}
		},
		[refreshStats],
	);

	const abortStream = useCallback(async () => {
		dispatch({ type: "ABORT_STREAM" });
		try {
			await invoke("abort_prompt");
		} catch {
			// ignore
		}
	}, []);

	/**
	 * Queue a steering message on the running session (issue #201, PR 1).
	 * Mid-turn course correction — the agent picks it up after its current
	 * tool batch finishes, before the next LLM call. Errors from the sidecar
	 * (extension command, empty text, etc.) are logged but not re-thrown:
	 * the composer’s textarea is already cleared on submit so we don’t want
	 * to surface a stack trace mid-conversation. Future PR may surface them
	 * as a transient toast.
	 */
	const steerStream = useCallback(async (text: string) => {
		// Optimistic: surface the user bubble immediately so the UI doesn't
		// feel like the message vanished. The next queue_update event will
		// reconcile (no-op if it matches; visible if SDK rejected text).
		dispatch({ type: "QUEUE_OPTIMISTIC", kind: "steer", text });
		try {
			await invoke("steer_prompt", { text });
		} catch (err) {
			console.warn("[cowork] steer_prompt rejected:", err);
		}
	}, []);

	/**
	 * Queue a follow-up message on the running session (issue #201, PR 1).
	 * Delivered after the agent finishes all current work. Same error
	 * handling rationale as {@link steerStream}.
	 */
	const followUpStream = useCallback(async (text: string) => {
		dispatch({ type: "QUEUE_OPTIMISTIC", kind: "follow_up", text });
		try {
			await invoke("follow_up_prompt", { text });
		} catch (err) {
			console.warn("[cowork] follow_up_prompt rejected:", err);
		}
	}, []);

	/**
	 * Atomically drain the SDK queue and return its contents. Issue #201
	 * PR 3 — the composer calls this when the user presses Ctrl+↑ to edit
	 * pending queued messages. The queue is left empty on return; if the
	 * user wants to re-send any pulled message they re-queue it via
	 * steerStream/followUpStream. Returns empty arrays on failure (so the
	 * caller can render "nothing to edit" rather than crash).
	 */
	const clearQueue = useCallback(async (): Promise<QueueSnapshot> => {
		try {
			const raw = (await invoke("clear_queue")) as {
				steering?: string[];
				followUp?: string[];
			};
			return {
				steering: raw.steering ?? [],
				followUp: raw.followUp ?? [],
			};
		} catch (err) {
			console.warn("[cowork] clear_queue rejected:", err);
			return { steering: [], followUp: [] };
		}
	}, []);

	/**
	 * Global queue_update listener. The Rust event router emits
	 * `queue_update` globally (separate from the prompt channel) so we
	 * get queue mutations even when no prompt is active — e.g. a
	 * follow-up dequeues right after STREAM_COMPLETE.
	 */
	// #268 — seed the reasoning level on mount and whenever the sidecar
	// (re)becomes ready. The `ready` payload carries `thinkingLevel`; we also
	// fetch the full thinking state + stats so the status line is populated from
	// the first paint of a restored/continued session.
	useEffect(() => {
		if (!isTauri()) return;
		let mounted = true;
		let unlistenReady: (() => void) | undefined;
		const seed = async () => {
			try {
				const res = (await invoke("get_thinking_level")) as {
					thinkingLevel?: ThinkingLevel;
					availableThinkingLevels?: ThinkingLevel[];
					supportsThinking?: boolean;
				};
				if (mounted && res?.thinkingLevel) {
					setThinking(toThinkingState(res));
				}
			} catch {
				// sidecar not ready yet — the `ready` listener below retries.
			}
			void refreshStats();
		};
		void seed();
		listen("ready", () => {
			void seed();
		}).then((fn) => {
			if (mounted) unlistenReady = fn;
			else fn();
		});
		return () => {
			mounted = false;
			unlistenReady?.();
		};
	}, [refreshStats]);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		listen<{ steering?: string[]; followUp?: string[] }>("queue_update", (evt) => {
			const payload = evt.payload ?? {};
			dispatch({
				type: "QUEUE_UPDATE",
				steering: payload.steering ?? [],
				followUp: payload.followUp ?? [],
			});
		}).then((fn) => {
			unlisten = fn;
		});
		return () => {
			unlisten?.();
		};
	}, []);

	return {
		state,
		startStream,
		abortStream,
		steerStream,
		followUpStream,
		clearQueue,
		dispatch,
		toolPhase,
		// #268 — status-line telemetry + reasoning control
		sessionStats,
		thinking,
		refreshStats,
		setThinkingLevel: applyThinkingLevel,
		cycleThinking,
	};
}
