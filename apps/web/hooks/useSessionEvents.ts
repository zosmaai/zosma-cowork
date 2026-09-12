import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useReducer,
	useRef,
} from "react";
import { AgentEventConnection } from "@/lib/agent-event-connection";
import {
	asArray,
	commitAssistantReply,
	normalizeQueuedMessages,
} from "@/lib/agent-session-messages";
import { getAgentState } from "@/lib/api-v1-client";
import { normalizeToolCalls } from "@/lib/normalize";
import { userMessageKey } from "@/lib/prompt-recovery";
import {
	type ClientAssistantMessageEvent,
	INITIAL_STREAMING_STATE,
	type StreamAction,
	type StreamingState,
	streamReducer,
} from "@/lib/streaming-message";
import { getToolExecutionProgress } from "@/lib/tool-execution-progress";
import type {
	AgentMessage,
	ExtensionStatusItem,
	ExtensionUiRequest,
	ExtensionWidgetItem,
	SessionInfo,
} from "@/lib/types";
import {
	AGENT_STATE_RECONCILE_MS,
	type AgentEvent,
	type AgentPhase,
	BASH_STATE_RECONCILE_MS,
	type CompactResultInfo,
	delay,
	EVENT_STREAM_IDLE_GRACE_MS,
	EVENT_STREAM_READY_TIMEOUT_MS,
	EVENT_STREAM_RECONNECT_DELAY_MS,
	PROMPT_SETTLE_INITIAL_DELAY_MS,
	PROMPT_SETTLE_MAX_MS,
	PROMPT_SETTLE_POLL_MS,
	type QueuedMessages,
	type RetryInfo,
	readCompactResult,
} from "./agent-session-types";
import type { NoticeType } from "./useAgentNotices";
import type { SessionCoreRefs } from "./useSessionLoader";

/** Extra runtime state the events hook needs from the composition root. */
export interface SessionEventsRuntime {
	/** Scroll-attachment tracking (live-follow the streaming tail). */
	isNearBottomRef: MutableRefObject<boolean>;
	liveFollowFrameRef: MutableRefObject<number | null>;
	pendingScrollToUserRef: MutableRefObject<boolean>;
	/** Subscribable agent-event handler ref (stable across renders). */
	handleAgentEventRef: MutableRefObject<((event: AgentEvent) => void) | null>;
	bashRunningRef: MutableRefObject<boolean>;
}

export interface SessionEventsSetters {
	setMessages: Dispatch<SetStateAction<AgentMessage[]>>;
	setAgentRunning: Dispatch<SetStateAction<boolean>>;
	setAgentPhase: Dispatch<SetStateAction<AgentPhase>>;
	setRetryInfo: Dispatch<SetStateAction<RetryInfo | null>>;
	setIsCompacting: Dispatch<SetStateAction<boolean>>;
	setCompactError: Dispatch<SetStateAction<string | null>>;
	setCompactResult: Dispatch<SetStateAction<CompactResultInfo | null>>;
	setQueuedMessages: Dispatch<SetStateAction<QueuedMessages>>;
	setPendingBash: Dispatch<
		SetStateAction<{ command: string; excludeFromContext: boolean } | null>
	>;
	setBashRunning: Dispatch<SetStateAction<boolean>>;
	setContextUsage: Dispatch<
		SetStateAction<{
			percent: number | null;
			contextWindow: number;
			tokens: number | null;
		} | null>
	>;
	setSystemPrompt: Dispatch<SetStateAction<string | null>>;
	setExtensionStatuses: Dispatch<SetStateAction<ExtensionStatusItem[]>>;
	setExtensionWidgets: Dispatch<SetStateAction<ExtensionWidgetItem[]>>;
}

export interface SessionEventsOptions {
	core: SessionCoreRefs;
	runtime: SessionEventsRuntime;
	setters: SessionEventsSetters;
	/** Coalesced turn-end reload (stable identity). */
	refreshSession: (sid: string) => Promise<unknown>;
	addNotice: (notice: {
		id?: string;
		message: string;
		type?: NoticeType;
	}) => void;
	onAgentEnd?: () => void;
	scrollToBottom: (behavior?: ScrollBehavior) => void;
	handleExtensionUiRequest: (request: ExtensionUiRequest) => void;
	/** Session props forwarded from AppShell: used to attach to a session that
	 *  a different browser started while this one had it open. */
	session: SessionInfo | null;
	sessionRunning?: boolean;
}

export interface SessionEvents {
	streamState: StreamingState;
	dispatch: Dispatch<StreamAction>;
	handleAgentEventRef: MutableRefObject<((event: AgentEvent) => void) | null>;
	/** Internals the composition root drives: prompt-run tracking, optimistic
	 *  user-bubble consumption, and the bash-poll recovery counter. */
	promptRunIdRef: MutableRefObject<number>;
	rpcPromptPendingRef: MutableRefObject<boolean>;
	optimisticUserMessageKeyRef: MutableRefObject<string | null>;
	sdkAgentActiveRef: MutableRefObject<boolean>;
	bashRecoveryIdRef: MutableRefObject<number>;
	ensureEventsConnected: (sid: string) => Promise<void>;
	maintainEventsConnected: (sid: string) => void;
	closeEvents: () => void;
	cancelEventStreamGrace: () => void;
	scheduleEventStreamClose: (sid: string) => void;
	settleUiStage: () => boolean;
	waitForPromptSettlement: (sid: string, runId?: number) => Promise<void>;
	waitForBashSettlement: (sid: string) => Promise<void>;
	reconcileAgentState: (sid: string) => Promise<void>;
}

/**
 * The SSE event stream + turn-settlement choreography. Owns the event
 * connection, the per-event reducer (handleAgentEvent), the idle-grace
 * shutdown sequence, and the reconciliation poll that rescues the UI when
 * SSE events go missing. Extracted from useAgentSession; messages are
 * single-source from the stream (message_end commits, reconcile is the
 * memory-backed safety net) — no turn-end file reloads.
 */
export function useSessionEvents(opts: SessionEventsOptions): SessionEvents {
	const {
		core,
		runtime,
		setters,
		refreshSession,
		addNotice,
		onAgentEnd,
		scrollToBottom,
		handleExtensionUiRequest,
		session,
		sessionRunning,
	} = opts;

	const [streamState, dispatch] = useReducer(
		streamReducer,
		INITIAL_STREAMING_STATE,
	);

	// --- Event stream lifecycle ---------------------------------------------
	const eventConnectionRef = useRef<AgentEventConnection | null>(null);
	const eventStreamGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const eventStreamGraceGenerationRef = useRef(0);
	const eventStreamGraceActiveRef = useRef(false);

	const sdkAgentActiveRef = useRef(false);
	const rpcPromptPendingRef = useRef(false);
	const notifiedPromptRunIdRef = useRef(-1);
	const promptRunIdRef = useRef(0);
	const optimisticUserMessageKeyRef = useRef<string | null>(null);
	const bashRecoveryIdRef = useRef(0);

	if (!eventConnectionRef.current) {
		eventConnectionRef.current = new AgentEventConnection({
			createSource: (sid) =>
				new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`),
			onEvent: (event) =>
				runtime.handleAgentEventRef.current?.(event as AgentEvent),
			shouldMaintain: (sid) =>
				core.sessionHookMountedRef.current &&
				core.sessionIdRef.current === sid &&
				(core.agentRunningRef.current ||
					eventStreamGraceActiveRef.current ||
					(core.sessionPropIdRef.current === sid &&
						core.sessionRunningRef.current)),
			readinessTimeoutMs: EVENT_STREAM_READY_TIMEOUT_MS,
			reconnectDelayMs: EVENT_STREAM_RECONNECT_DELAY_MS,
			onUnexpectedError: (error) => {
				console.error("Failed to maintain the agent event stream:", error);
			},
		});
	}

	const cancelEventStreamGrace = useCallback(() => {
		eventStreamGraceGenerationRef.current += 1;
		eventStreamGraceActiveRef.current = false;
		if (eventStreamGraceTimerRef.current) {
			clearTimeout(eventStreamGraceTimerRef.current);
			eventStreamGraceTimerRef.current = null;
		}
	}, []);

	const closeEvents = useCallback(() => {
		eventConnectionRef.current?.close();
	}, []);

	const ensureEventsConnected = useCallback(
		(sid: string) => eventConnectionRef.current!.ensureConnected(sid),
		[],
	);

	const maintainEventsConnected = useCallback((sid: string) => {
		eventConnectionRef.current!.maintain(sid);
	}, []);

	// --- Turn-end chorus -----------------------------------------------------

	const settleUiStage = useCallback(() => {
		const wasRunning = core.agentRunningRef.current;
		core.agentRunningRef.current = false;
		setters.setAgentRunning(false);
		setters.setAgentPhase(null);
		setters.setRetryInfo(null);
		dispatch({ type: "end" });
		return wasRunning;
	}, [core, dispatch, setters]);

	const notifyPromptStage = useCallback(
		(runId: number) => {
			if (notifiedPromptRunIdRef.current === runId) return false;
			notifiedPromptRunIdRef.current = runId;
			onAgentEnd?.();
			return true;
		},
		[onAgentEnd],
	);

	const scheduleEventStreamClose = useCallback(
		(sid: string) => {
			cancelEventStreamGrace();
			eventStreamGraceActiveRef.current = true;
			const generation = eventStreamGraceGenerationRef.current;

			const checkServerIdle = async () => {
				if (
					generation !== eventStreamGraceGenerationRef.current ||
					core.sessionIdRef.current !== sid ||
					!eventStreamGraceActiveRef.current
				)
					return;

				try {
					const data = await getAgentState(sid);
					if (
						generation !== eventStreamGraceGenerationRef.current ||
						core.sessionIdRef.current !== sid ||
						!eventStreamGraceActiveRef.current
					)
						return;

					const state = data.state;
					const promptActive = Boolean(
						data.running &&
							state &&
							(state.isStreaming || state.isPromptRunning),
					);
					if (promptActive) {
						eventStreamGraceActiveRef.current = false;
						eventStreamGraceTimerRef.current = null;
						sdkAgentActiveRef.current = Boolean(state?.isStreaming);
						rpcPromptPendingRef.current = Boolean(state?.isPromptRunning);
						core.agentRunningRef.current = true;
						setters.setAgentRunning(true);
						setters.setAgentPhase(
							state?.isStreaming
								? { kind: "waiting_model" }
								: { kind: "running_command" },
						);
						return;
					}

					if (data.running && state?.isCompacting) {
						setters.setIsCompacting(true);
						eventStreamGraceTimerRef.current = setTimeout(
							() => void checkServerIdle(),
							PROMPT_SETTLE_POLL_MS,
						);
						return;
					}

					eventStreamGraceActiveRef.current = false;
					eventStreamGraceTimerRef.current = null;
					closeEvents();
				} catch {
					// Keep the stream alive while state cannot be verified.
					if (
						generation !== eventStreamGraceGenerationRef.current ||
						core.sessionIdRef.current !== sid ||
						!eventStreamGraceActiveRef.current
					)
						return;
					eventStreamGraceTimerRef.current = setTimeout(
						() => void checkServerIdle(),
						PROMPT_SETTLE_POLL_MS,
					);
				}
			};

			eventStreamGraceTimerRef.current = setTimeout(
				() => void checkServerIdle(),
				EVENT_STREAM_IDLE_GRACE_MS,
			);
		},
		[cancelEventStreamGrace, closeEvents, core, setters],
	);

	const finishPromptWithoutStream = useCallback(
		async (
			sid: string | null = core.sessionIdRef.current,
			runId = promptRunIdRef.current,
		) => {
			// Single-source stream: committed messages arrive via message_end; the
			// file reload that used to live here (404 → late 200 with file state →
			// wholesale replace) was the first-chat flash. When SSE misses events,
			// reconcileAgentState (memory-backed, identity-merge) is the safety net.
			if (promptRunIdRef.current !== runId) return;
			const promptWasPending = rpcPromptPendingRef.current;
			const agentWasActive = sdkAgentActiveRef.current;
			// ponytail: settle discards an uncommitted streaming tail. Loss window is
			// ONLY the double-failure edge (SSE dead + daemon idle + no replay) —
			// EventSource reconnect replays the stream normally. Committing the tail
			// here would need delta mirroring; the old fix (turn-end file reload) is
			// what produced the first-chat flash. Prefer the rare loss.
			rpcPromptPendingRef.current = false;
			sdkAgentActiveRef.current = false;
			optimisticUserMessageKeyRef.current = null;
			const wasRunning = settleUiStage();
			if (promptWasPending) {
				notifyPromptStage(runId);
			} else if (agentWasActive && wasRunning) {
				onAgentEnd?.();
			}
			if (sid) scheduleEventStreamClose(sid);
		},
		[
			core,
			notifyPromptStage,
			onAgentEnd,
			scheduleEventStreamClose,
			settleUiStage,
		],
	);

	const waitForPromptSettlement = useCallback(
		async (sid: string, runId?: number) => {
			await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
			const startedAt = Date.now();

			while (
				core.agentRunningRef.current &&
				Date.now() - startedAt < PROMPT_SETTLE_MAX_MS
			) {
				if (runId !== undefined && promptRunIdRef.current !== runId) return;
				try {
					const data = await getAgentState(sid);
					const state = data.state;
					if (
						!data.running ||
						!state ||
						(!state.isStreaming && !state.isPromptRunning)
					) {
						await finishPromptWithoutStream(sid, runId);
						return;
					}
				} catch {
					// SSE remains the primary completion path.
				}
				await delay(PROMPT_SETTLE_POLL_MS);
			}
		},
		[core, finishPromptWithoutStream],
	);

	const waitForBashSettlement = useCallback(
		async (sid: string) => {
			const recoveryId = bashRecoveryIdRef.current + 1;
			bashRecoveryIdRef.current = recoveryId;

			while (
				runtime.bashRunningRef.current &&
				bashRecoveryIdRef.current === recoveryId &&
				core.sessionIdRef.current === sid
			) {
				await delay(BASH_STATE_RECONCILE_MS);
				try {
					const data = await getAgentState(sid);
					if (data.state?.isBashRunning) continue;

					if (
						bashRecoveryIdRef.current !== recoveryId ||
						core.sessionIdRef.current !== sid
					)
						return;
					runtime.bashRunningRef.current = false;
					setters.setBashRunning(false);
					setters.setPendingBash(null);
					return;
				} catch {
					// Keep polling while the page is mounted; network recovery is transparent.
				}
			}
		},
		[core, runtime, setters],
	);

	// Reconcile client streaming state with the server. When SSE events are
	// missed (network drop, mobile tab backgrounded, half-open connection),
	// agent_end never arrives and the UI stays in streaming state forever.
	// If the server reports idle while we still think it's running, finish
	// through the same settlement path used by non-streaming prompts.
	const reconcileAgentState = useCallback(
		async (sid: string) => {
			if (!core.agentRunningRef.current || core.sessionIdRef.current !== sid)
				return;
			const runId = promptRunIdRef.current;
			try {
				const data = await getAgentState(sid);
				// A slow response can straddle a run boundary (previous run finished
				// and the user already started the next one while this request was in
				// flight) — everything in it is stale, drop it.
				if (
					core.sessionIdRef.current !== sid ||
					promptRunIdRef.current !== runId
				)
					return;
				const state = data.state;
				// Mirror compaction state unconditionally: a missed compaction_end
				// would otherwise leave the "Stop compaction" UI stuck. No state
				// (wrapper destroyed) means nothing is compacting.
				setters.setIsCompacting(state?.isCompacting ?? false);
				setters.setQueuedMessages(
					normalizeQueuedMessages(state?.queuedMessages),
				);
				const busy =
					data.running &&
					state &&
					(state.isStreaming || state.isPromptRunning || state.isCompacting);
				if (busy) {
					sdkAgentActiveRef.current = Boolean(state.isStreaming);
					rpcPromptPendingRef.current = Boolean(state.isPromptRunning);
					return;
				}
				if (!core.agentRunningRef.current) return;
				if (state) {
					if (state.contextUsage !== undefined)
						setters.setContextUsage(state.contextUsage ?? null);
					if (state.systemPrompt !== undefined)
						setters.setSystemPrompt(state.systemPrompt ?? null);
					if (state.extensionStatuses !== undefined)
						setters.setExtensionStatuses(asArray(state.extensionStatuses));
					if (state.extensionWidgets !== undefined)
						setters.setExtensionWidgets(asArray(state.extensionWidgets));
				}
				await finishPromptWithoutStream(sid, runId);
			} catch {
				// Network still down — the next poll / visibility / online tick retries.
			}
		},
		[core, finishPromptWithoutStream, setters],
	);

	// Recovery net for missed SSE events: while the agent is running, verify
	// against the server periodically and whenever the tab returns to the
	// foreground or the network comes back.
	useEffect(() => {
		if (!core.agentRunningRef.current) return;
		const reconcile = () => {
			// Read the ref on every tick: for brand-new sessions the id is
			// assigned only after ensure_session returns.
			const sid = core.sessionIdRef.current;
			if (sid) void reconcileAgentState(sid);
		};
		const onVisible = () => {
			if (document.visibilityState === "visible") reconcile();
		};
		const interval = setInterval(reconcile, AGENT_STATE_RECONCILE_MS);
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("online", reconcile);
		return () => {
			clearInterval(interval);
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("online", reconcile);
		};
	}, [core, reconcileAgentState]);

	// A different browser can start this session after it was opened here.
	// The sidebar's lightweight running-state poll gives us a cheap signal to
	// attach to the existing SSE stream without adding another synchronization
	// protocol to the chat.
	useEffect(() => {
		if (!session?.id || !sessionRunning) return;
		maintainEventsConnected(session.id);
		return () => {
			if (
				core.sessionIdRef.current === session.id &&
				!core.agentRunningRef.current &&
				!eventStreamGraceActiveRef.current &&
				(core.sessionPropIdRef.current !== session.id ||
					!core.sessionRunningRef.current)
			) {
				closeEvents();
			}
		};
	}, [closeEvents, core, maintainEventsConnected, session?.id, sessionRunning]);

	const handleAgentEvent = useCallback(
		(event: AgentEvent) => {
			switch (event.type) {
				case "connected": {
					dispatch({ type: "end" });
					if (event.isStreaming === true) {
						cancelEventStreamGrace();
						sdkAgentActiveRef.current = true;
						core.agentRunningRef.current = true;
						setters.setAgentRunning(true);
						setters.setAgentPhase({ kind: "waiting_model" });
					}
					break;
				}
				case "agent_start":
					cancelEventStreamGrace();
					sdkAgentActiveRef.current = true;
					core.agentRunningRef.current = true;
					setters.setAgentRunning(true);
					setters.setAgentPhase({ kind: "waiting_model" });
					dispatch({ type: "start" });
					break;
				case "agent_end":
					// One logical prompt can emit multiple agent_end events before retrying,
					// compacting, or continuing messages queued by extension handlers.
					// Keep the stream open until prompt_done/agent_settled and the idle grace.
					if (!core.agentRunningRef.current) break;
					setters.setAgentPhase(null);
					setters.setRetryInfo(null);
					dispatch({ type: "end" });
					if (core.sessionIdRef.current) {
						// Single-source stream: no file reload here (it 404'd on new
						// sessions and wholesale-replaced streamed messages later).
						getAgentState(core.sessionIdRef.current)
							.then((stateResult) => {
								if (stateResult.state?.contextUsage !== undefined)
									setters.setContextUsage(
										stateResult.state.contextUsage ?? null,
									);
								if (stateResult.state?.systemPrompt !== undefined)
									setters.setSystemPrompt(
										stateResult.state.systemPrompt ?? null,
									);
								if (stateResult.state?.extensionStatuses !== undefined)
									setters.setExtensionStatuses(
										asArray(stateResult.state.extensionStatuses),
									);
								if (stateResult.state?.extensionWidgets !== undefined)
									setters.setExtensionWidgets(
										asArray(stateResult.state.extensionWidgets),
									);
								// Aborted turns can leave messages queued in pi (delivered with the
								// next turn); dead wrapper (no state) means the queue is gone.
								setters.setQueuedMessages(
									normalizeQueuedMessages(stateResult.state?.queuedMessages),
								);
							})
							.catch(() => {});
					}
					break;
				case "agent_settled": {
					const agentWasActive = sdkAgentActiveRef.current;
					sdkAgentActiveRef.current = false;
					if (!agentWasActive || rpcPromptPendingRef.current) break;

					const sid = core.sessionIdRef.current;
					const wasRunning = settleUiStage();
					setters.setIsCompacting(false);
					if (sid) {
						scheduleEventStreamClose(sid);
					}
					if (wasRunning) onAgentEnd?.();
					break;
				}
				case "prompt_done":
					{
						const runId = promptRunIdRef.current;
						const promptWasPending = rpcPromptPendingRef.current;
						rpcPromptPendingRef.current = false;
						optimisticUserMessageKeyRef.current = null;
						const firstNotification = notifyPromptStage(runId);
						if (!promptWasPending && !firstNotification) break;

						const sid = core.sessionIdRef.current;
						// An extension-injected agent may already have started before the
						// command's prompt_done. Keep that active stage visible and let its
						// agent_settled event perform the next completion transition.
						if (!sdkAgentActiveRef.current) {
							settleUiStage();
							if (sid) scheduleEventStreamClose(sid);
						}
					}
					break;
				case "prompt_error":
					addNotice({
						type: "error",
						message:
							(event.errorMessage as string | undefined) ?? "Command failed",
					});
					break;
				case "extension_error":
					addNotice({
						type: "error",
						message:
							(event.error as string | undefined) ?? "Extension command failed",
					});
					break;
				case "message_start":
				case "message_update": {
					// Ignore streaming events arriving after this run already finished
					// (e.g. SSE data buffered while the tab was frozen, flushed after
					// reconcile) — they would resurrect a ghost streaming bubble.
					if (!core.agentRunningRef.current) break;
					if (event.type === "message_start") {
						const msg = event.message as AgentMessage | undefined;
						if (msg?.role === "user") break;
						if (msg?.role === "assistant") {
							dispatch({ type: "snapshot", message: msg });
							if (msg.content.length > 0) setters.setAgentPhase(null);
						} else if (msg) {
							setters.setAgentPhase(null);
						}
					} else {
						const delta = event.assistantMessageEvent as
							| ClientAssistantMessageEvent
							| undefined;
						if (delta) {
							dispatch({ type: "delta", event: delta });
							if (
								delta.type !== "toolcall_start" &&
								delta.type !== "toolcall_delta"
							) {
								setters.setAgentPhase(null);
							}
						}
					}
					// Live-follow the streaming output only when the user is already near
					// the bottom of the message list. If they scrolled up, leave them there.
					if (
						!runtime.pendingScrollToUserRef.current &&
						runtime.isNearBottomRef.current &&
						runtime.liveFollowFrameRef.current === null
					) {
						// Defer the scroll so React has time to update the DOM with the new
						// streaming content; otherwise scrollIntoView may target stale layout.
						runtime.liveFollowFrameRef.current = requestAnimationFrame(() => {
							runtime.liveFollowFrameRef.current = null;
							if (runtime.isNearBottomRef.current) scrollToBottom("auto");
						});
					}
					break;
				}
				case "message_end": {
					// Same late-event guard: after reconcile finished this run,
					// loadSession already loaded this message from the session file —
					// appending it again would duplicate it.
					if (!core.agentRunningRef.current) break;
					const completed = event.message as AgentMessage | undefined;
					if (completed && completed.role === "user") {
						// Delivered steering/follow-up messages surface here as user
						// messages. The run's initial prompt also emits one, but handleSend
						// already appended it optimistically. Consume only the still-adjacent
						// optimistic bubble; later same-text queue deliveries must render.
						const delivered = normalizeToolCalls(completed);
						const deliveredKey = userMessageKey(delivered);
						const optimisticKey = optimisticUserMessageKeyRef.current;
						optimisticUserMessageKeyRef.current = null;
						setters.setMessages((prev) => {
							const last = prev[prev.length - 1];
							const lastIsOptimistic =
								optimisticKey &&
								last?.role === "user" &&
								userMessageKey(last) === optimisticKey;
							if (lastIsOptimistic) {
								// Consume the adjacent optimistic bubble; replace if the delivered
								// copy differs, otherwise no-op.
								return optimisticKey === deliveredKey
									? prev
									: [...prev.slice(0, -1), delivered];
							}
							// No adjacent optimistic bubble (already reconciled / replay). Guard
							// against appending a duplicate user message for the same prompt.
							const already = prev.findIndex(
								(m) => m.role === "user" && userMessageKey(m) === deliveredKey,
							);
							if (already !== -1) return prev;
							return [...prev, delivered];
						});
						// User prompt delivered; the model should reply next.
						setters.setAgentPhase({ kind: "waiting_model" });
					} else if (completed) {
						// Idempotent commit: the SSE message_end and a concurrent
						// loadSession can race on the first turn, appending the same
						// assistant reply twice. commitAssistantReply replaces a same-text
						// tail with the authoritative commit instead of stacking a
						// duplicate bubble.
						setters.setMessages((prev) =>
							commitAssistantReply(prev, normalizeToolCalls(completed)),
						);
						// Assistant reply is complete. Do NOT flip back to waiting_model —
						// that would flash a spurious "waiting for model…" status right
						// after the answer renders, until agent_end clears it.
						setters.setAgentPhase(null);
					}
					dispatch({ type: "end" });
					break;
				}
				case "tool_execution_start": {
					const id = event.toolCallId as string;
					const name = event.toolName as string;
					setters.setAgentPhase((prev) => {
						const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
						if (!tools.some((t) => t.id === id)) tools.push({ id, name });
						return { kind: "running_tools", tools };
					});
					break;
				}
				case "tool_execution_update": {
					const id = event.toolCallId as string;
					const name = event.toolName as string;
					const progress = getToolExecutionProgress(event.partialResult);
					setters.setAgentPhase((prev) => {
						const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
						const existing = tools.find((tool) => tool.id === id);
						const updated = {
							id,
							name: name || existing?.name || "tool",
							progress: progress ?? existing?.progress,
						};
						return {
							kind: "running_tools",
							tools: [...tools.filter((tool) => tool.id !== id), updated],
						};
					});
					break;
				}
				case "tool_execution_end": {
					const id = event.toolCallId as string;
					setters.setAgentPhase((prev) => {
						if (prev?.kind !== "running_tools") return prev;
						const tools = prev.tools.filter((t) => t.id !== id);
						if (tools.length === 0) return { kind: "waiting_model" };
						return { kind: "running_tools", tools };
					});
					break;
				}
				case "queue_update":
					setters.setQueuedMessages({
						steering: [...((event.steering as string[] | undefined) ?? [])],
						followUp: [...((event.followUp as string[] | undefined) ?? [])],
					});
					break;
				case "auto_retry_start":
					setters.setRetryInfo({
						attempt: event.attempt as number,
						maxAttempts: event.maxAttempts as number,
						errorMessage: event.errorMessage as string | undefined,
					});
					break;
				case "auto_retry_end":
					setters.setRetryInfo(null);
					break;
				case "auto_compaction_start":
				case "compaction_start":
					setters.setIsCompacting(true);
					setters.setCompactError(null);
					setters.setCompactResult(null);
					break;
				case "auto_compaction_end":
				case "compaction_end":
					setters.setIsCompacting(false);
					if (event.errorMessage) {
						setters.setCompactError(event.errorMessage as string);
						setters.setCompactResult(null);
					} else if (!event.aborted) {
						setters.setCompactResult(
							readCompactResult(
								event.result,
								(event.reason as string | undefined) ?? "auto",
							),
						);
						if (core.sessionIdRef.current)
							refreshSession(core.sessionIdRef.current);
					}
					break;
				case "extension_ui_request":
					handleExtensionUiRequest(event as ExtensionUiRequest);
					break;
			}
		},
		[
			addNotice,
			cancelEventStreamGrace,
			core,
			dispatch,
			handleExtensionUiRequest,
			notifyPromptStage,
			onAgentEnd,
			refreshSession,
			runtime,
			scheduleEventStreamClose,
			scrollToBottom,
			setters,
			settleUiStage,
		],
	);
	runtime.handleAgentEventRef.current = handleAgentEvent;

	return {
		streamState,
		dispatch,
		handleAgentEventRef: runtime.handleAgentEventRef,
		promptRunIdRef,
		rpcPromptPendingRef,
		optimisticUserMessageKeyRef,
		sdkAgentActiveRef,
		bashRecoveryIdRef,
		ensureEventsConnected,
		maintainEventsConnected,
		closeEvents,
		cancelEventStreamGrace,
		scheduleEventStreamClose,
		settleUiStage,
		waitForPromptSettlement,
		waitForBashSettlement,
		reconcileAgentState,
	};
}
