import type { ChatMessage, ToolCallInfo } from "@/types";
import type {
	PiErrorEvent,
	PiEvent,
	PiMessageUpdateEvent,
	PiToolExecutionEndEvent,
	PiToolExecutionStartEvent,
	PiToolExecutionUpdateEvent,
} from "@/types/pi-events";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useReducer, useState } from "react";

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
	| { type: "QUEUE_OPTIMISTIC"; kind: "steer" | "follow_up"; text: string };

export const INITIAL_STATE: StreamState = {
	messages: [],
	streamingMessage: null,
	isRunning: false,
	status: "idle",
	error: null,
	queue: { steering: [], followUp: [] },
};

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
			const prevContent = msg.content || "";
			return {
				...state,
				streamingMessage: {
					...msg,
					// New sub-turn's thinking starts on a fresh line so the simple
					// view's "latest thought" picks up the newest reasoning.
					thinking:
						prevThinking && !prevThinking.endsWith("\n") ? `${prevThinking}\n` : prevThinking,
					// Separate successive answer paragraphs across sub-turns.
					content: prevContent && !prevContent.endsWith("\n") ? `${prevContent}\n\n` : prevContent,
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
			return {
				...state,
				streamingMessage: { ...msg, content: msg.content + action.delta },
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

		case "STREAM_ERROR":
			return {
				...state,
				isRunning: false,
				status: "idle",
				error: action.error,
			};

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

	const startStream = useCallback(async (text: string) => {
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
							case "toolcall_end": {
								const tc = ame.toolCall;
								dispatch({
									type: "TOOL_CALL_START",
									toolCall: extractToolCallInfo(tc),
								});
								break;
							}
							case "error":
								dispatch({
									type: "STREAM_ERROR",
									error: ame.reason === "aborted" ? "Aborted" : "Error",
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
						break;
					}

					case "agent_end":
					case "done":
						dispatch({ type: "STREAM_COMPLETE" });
						break;

					case "error": {
						const errEvent = event as PiErrorEvent;
						dispatch({
							type: "STREAM_ERROR",
							error: errEvent.message || "Unknown error",
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
	}, []);

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
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		listen<{ steering?: string[]; followUp?: string[] }>(
			"queue_update",
			(evt) => {
				const payload = evt.payload ?? {};
				dispatch({
					type: "QUEUE_UPDATE",
					steering: payload.steering ?? [],
					followUp: payload.followUp ?? [],
				});
			},
		).then((fn) => {
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
	};
}
