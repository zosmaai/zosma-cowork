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
import { useCallback, useReducer, useState } from "react";

export interface StreamState {
	messages: ChatMessage[];
	streamingMessage: ChatMessage | null;
	isRunning: boolean;
	status: "idle" | "thinking" | "tool_call" | "responding" | "error";
	error: string | null;
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
	| { type: "RESET" };

export const INITIAL_STATE: StreamState = {
	messages: [],
	streamingMessage: null,
	isRunning: false,
	status: "idle",
	error: null,
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

		case "TURN_RESET": {
			const msg = state.streamingMessage;
			if (!msg) return state;
			return {
				...state,
				streamingMessage: {
					...msg,
					content: "",
					thinking: "",
					toolCalls: msg.toolCalls || [],
					isStreaming: true,
				},
				status: "thinking",
			};
		}

		/**
		 * MESSAGE_END — Finalize the current streaming message to messages[]
		 * and create a fresh blank streaming message for the next assistant turn.
		 * This prevents inter-tool-call AI text from being lost when TURN_RESET
		 * fires on the next message_start.
		 *
		 * IMPORTANT: The new streamingMessage starts with EMPTY toolCalls.
		 * The previous message's tool calls are already saved in messages[]
		 * and TOOL_CALL_UPDATE has a messages[] fallback to update them.
		 * Inheriting toolCalls causes duplicate display.
		 */
		case "MESSAGE_END": {
			const msg = state.streamingMessage;
			if (!msg) return state;
			// Skip empty messages (no content, thinking, or tool calls)
			if (!msg.content && !msg.thinking && (!msg.toolCalls || msg.toolCalls.length === 0)) {
				return state;
			}
			// Finalize current message into messages[]
			const finalized = { ...msg, isStreaming: false };
			return {
				...state,
				messages: [...state.messages, finalized],
				// Fresh streaming message — empty toolCalls so no duplicates
				streamingMessage: {
					id: crypto.randomUUID(),
					role: "assistant" as const,
					content: "",
					thinking: "",
					isStreaming: true,
					toolCalls: [],
					timestamp: Date.now(),
					model: msg.model,
					provider: msg.provider,
				},
				status: "thinking",
			};
		}

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

	return { state, startStream, abortStream, dispatch, toolPhase };
}
