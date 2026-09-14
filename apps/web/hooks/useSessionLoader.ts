import type { Dispatch, SetStateAction } from "react";
import { type MutableRefObject, useCallback, useRef } from "react";
import {
	asArray,
	mergePersistedMessages,
	normalizeQueuedMessages,
} from "@/lib/agent-session-messages";
import {
	type AgentStateData,
	ApiV1Error,
	getAgentState,
	getSessionContext,
	getSessionDetails,
} from "@/lib/api-v1-client";
import { rekeyDraft } from "@/lib/draft-store";
import {
	getToolNamesForPreset,
	type ToolEntry,
	type ToolPreset,
} from "@/lib/tool-presets";
import type {
	AgentMessage,
	ExtensionStatusItem,
	ExtensionWidgetItem,
	SessionInfo,
} from "@/lib/types";
import type {
	AgentStateResponse,
	ChatInputHandle,
	SelectedModel,
	SessionData,
	SlashCommandInfo,
	SlashCommandsResponse,
	ThinkingLevelOption,
} from "./agent-session-types";

/** Shared mutable state handed to the session sub-hooks by the composition
 *  root (`useAgentSession`). Kept behind refs so stable callbacks never need
 *  to re-create on render — the same discipline the original hook used. */
export interface SessionCoreRefs {
	sessionIdRef: MutableRefObject<string | null>;
	sessionPropIdRef: MutableRefObject<string | null>;
	sessionRunningRef: MutableRefObject<boolean>;
	agentRunningRef: MutableRefObject<boolean>;
	ensuringNewSessionRef: MutableRefObject<Promise<string | null> | null>;
	newSessionPromotedRef: MutableRefObject<boolean>;
	draftKeyAliasesRef: MutableRefObject<Map<string, string>>;
	modelSwitchPendingRef: MutableRefObject<boolean>;
	thinkingLevelOverrideRef: MutableRefObject<Exclude<
		ThinkingLevelOption,
		"auto"
	> | null>;
	newSessionModelOverrideRef: MutableRefObject<SelectedModel | null>;
	sessionHookMountedRef: MutableRefObject<boolean>;
}

export interface SessionLoaderSetters {
	setData: Dispatch<SetStateAction<SessionData | null>>;
	setActiveLeafId: Dispatch<SetStateAction<string | null>>;
	setMessages: Dispatch<SetStateAction<AgentMessage[]>>;
	setEntryIds: Dispatch<SetStateAction<string[]>>;
	setError: Dispatch<SetStateAction<string | null>>;
	setSessionLost: Dispatch<SetStateAction<boolean>>;
	setLoading: Dispatch<SetStateAction<boolean>>;
	setThinkingLevel: Dispatch<SetStateAction<ThinkingLevelOption>>;
	setCurrentModelOverride: Dispatch<
		SetStateAction<{ provider: string; modelId: string } | null>
	>;
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
	setQueuedMessages: Dispatch<
		SetStateAction<{ steering: string[]; followUp: string[] }>
	>;
	setSlashCommands: Dispatch<SetStateAction<SlashCommandInfo[]>>;
	setSlashCommandsLoading: Dispatch<SetStateAction<boolean>>;
	setToolPresetState: (preset: ToolPreset) => void;
	setPendingModel: Dispatch<SetStateAction<SelectedModel | null>>;
	setNewSessionModel: Dispatch<SetStateAction<SelectedModel | null>>;
	setNewSessionDefaultModel: Dispatch<SetStateAction<SelectedModel | null>>;
}

export interface SessionLoaderOptions {
	core: SessionCoreRefs;
	setters: SessionLoaderSetters;
	session: SessionInfo | null;
	isNew: boolean;
	newSessionCwd: string | null;
	newSessionDraftKey: string | null;
	chatInput: ChatInputHandle | null | undefined;
	onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
	sendCommand: <T>(sid: string, command: Record<string, unknown>) => Promise<T>;
	toolPreset: ToolPreset;
}

export interface SessionLoader {
	loadSession: (
		sid: string,
		showLoading?: boolean,
		includeState?: boolean,
	) => Promise<SessionData | AgentStateData | null>;
	/** Turn-end reload with single-flight coalescing: the prompt_done /
	 *  agent_end / agent_settled chorus fires three reloads in quick
	 *  succession — collapsing them to one fetch (plus at most one trailing
	 *  rerun) kills most of the post-answer repaint burst. */
	refreshSession: (sid: string) => Promise<unknown>;
	loadContext: (sid: string, leafId: string | null) => Promise<void>;
	loadTools: (sid: string) => Promise<void>;
	resumeSession: () => Promise<void>;
	loadSystemPrompt: () => Promise<void>;
	loadSlashCommands: () => Promise<SlashCommandInfo[]>;
	ensureNewSession: () => Promise<string | null>;
	promoteNewSession: (messageCount?: number, firstMessage?: string) => void;
}

/** Session persistence + creation mechanics: loading context from the session
 *  file, reconciling it into live state, and promoting the ephemeral
 *  new-session workspace into a real pi session. */
export function useSessionLoader(opts: SessionLoaderOptions): SessionLoader {
	const {
		core,
		setters,
		isNew,
		newSessionCwd,
		newSessionDraftKey,
		chatInput,
		onSessionCreated,
		sendCommand,
		toolPreset,
	} = opts;

	// Coalesce concurrent turn-end reloads: while one loadSession is in flight
	// for a session, later requests for the same session are remembered and
	// rerun once (trailing) so the freshest state always lands last.
	const reloadInFlightRef = useRef<{ sid: string } | null>(null);
	const reloadQueuedRef = useRef(false);

	const loadSession = useCallback(
		async (sid: string, showLoading = false, includeState = false) => {
			try {
				if (showLoading) setters.setLoading(true);
				let d;
				try {
					d = await getSessionDetails(sid, {
						deferThinking: true,
						deferMedia: true,
					});
				} catch (error) {
					if (error instanceof ApiV1Error && error.status === 404) {
						if (showLoading) {
							// Brand-new sessions have no session file on disk until pi's
							// first assistant write, so every load during the first turn
							// 404s while real messages are in memory (SSE stream). Wiping
							// them here blanked the chat on any remount/recovery
							// mid-first-turn, then restreamed = the "first chat flicker".
							// Only clear when this isn't the active session, or there is
							// nothing to lose — and keep data/leafId intact for the same
							// reason (data feeds the session-details/stats panels).
							setters.setMessages((prev) =>
								core.sessionIdRef.current === sid && prev.length > 0
									? prev
									: [],
							);
							setters.setData((prev) =>
								core.sessionIdRef.current === sid && prev ? prev : null,
							);
							setters.setActiveLeafId((prev) =>
								core.sessionIdRef.current === sid && prev ? prev : null,
							);
							setters.setError(null);
						}
						return null;
					}
					throw error;
				}
				if (core.sessionIdRef.current !== sid) return null;
				const persistedMessages = d.context.messages;
				setters.setData(d);
				setters.setActiveLeafId(d.leafId);
				// Identity-preserving merge: messages already rendered keep their
				// object (memoized MessageViews skip a repaint) and the live tail
				// (optimistic user bubble, just-committed reply) survives a flush lag
				// instead of vanishing/repeating.
				setters.setMessages((prev) =>
					mergePersistedMessages(persistedMessages, prev),
				);
				setters.setEntryIds(d.context.entryIds ?? []);
				setters.setCurrentModelOverride((current) =>
					core.modelSwitchPendingRef.current ? current : null,
				);
				setters.setError(null);
				setters.setSessionLost(false);
				if (d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
					setters.setThinkingLevel(
						d.context.thinkingLevel as ThinkingLevelOption,
					);
				}

				if (showLoading) setters.setLoading(false);
				if (!includeState) return null;

				const agentState = await getAgentState(sid).catch((e) => {
					console.error("Failed to load agent state:", e);
					return null;
				});
				if (core.sessionIdRef.current !== sid) return null;

				const liveState = agentState?.state;
				if (liveState) {
					if (liveState.contextUsage !== undefined)
						setters.setContextUsage(liveState.contextUsage ?? null);
					if (liveState.systemPrompt !== undefined)
						setters.setSystemPrompt(liveState.systemPrompt ?? null);
					if (liveState.thinkingLevel !== undefined)
						setters.setThinkingLevel(
							(liveState.thinkingLevel as ThinkingLevelOption) ?? "auto",
						);
					if (liveState.extensionStatuses !== undefined)
						setters.setExtensionStatuses(asArray(liveState.extensionStatuses));
					if (liveState.extensionWidgets !== undefined)
						setters.setExtensionWidgets(asArray(liveState.extensionWidgets));
					if (liveState.queuedMessages !== undefined)
						setters.setQueuedMessages(
							normalizeQueuedMessages(liveState.queuedMessages),
						);
				} else if (!agentState?.running) {
					setters.setQueuedMessages({ steering: [], followUp: [] });
				}
				return agentState;
			} catch (e) {
				setters.setError(String(e));
				return null;
			} finally {
				if (showLoading) setters.setLoading(false);
			}
		},
		[core, setters],
	);

	const refreshSession = useCallback(
		async (sid: string) => {
			if (reloadInFlightRef.current?.sid === sid) {
				reloadQueuedRef.current = true;
				return null;
			}
			reloadInFlightRef.current = { sid };
			try {
				await loadSession(sid);
				// A trailing rerun can matter when the first fetch resolved before pi
				// finished flushing the answer to the session file.
				while (
					reloadQueuedRef.current &&
					reloadInFlightRef.current?.sid === sid
				) {
					reloadQueuedRef.current = false;
					await loadSession(sid);
				}
				return null;
			} finally {
				if (reloadInFlightRef.current?.sid === sid)
					reloadInFlightRef.current = null;
			}
		},
		[loadSession],
	);

	const loadContext = useCallback(
		async (sid: string, leafId: string | null) => {
			try {
				const d = await getSessionContext(sid, leafId);
				setters.setMessages(d.messages);
				setters.setEntryIds(d.entryIds ?? []);
			} catch (e) {
				console.error("Failed to load context:", e);
			}
		},
		[setters],
	);

	const loadTools = useCallback(
		async (sid: string) => {
			try {
				const tools = await sendCommand<ToolEntry[]>(sid, {
					type: "get_tools",
				});
				if (tools) {
					const { getPresetFromTools } = await import("@/lib/tool-presets");
					setters.setToolPresetState(getPresetFromTools(tools));
				}
			} catch (e) {
				console.error("Failed to load tools:", e);
			}
		},
		[sendCommand, setters],
	);

	const promoteNewSession = useCallback(
		(messageCount = 0, firstMessage = "(no messages)") => {
			const sid = core.sessionIdRef.current;
			if (
				!isNew ||
				!newSessionCwd ||
				!sid ||
				core.newSessionPromotedRef.current
			)
				return;
			core.newSessionPromotedRef.current = true;
			const provisionalDraftKey = newSessionDraftKey;
			if (!provisionalDraftKey) return;
			if (provisionalDraftKey !== sid) {
				core.draftKeyAliasesRef.current.set(provisionalDraftKey, sid);
				if (chatInput) chatInput.rekeyDraft(provisionalDraftKey, sid);
				else rekeyDraft(provisionalDraftKey, sid);
			}
			onSessionCreated?.(
				{
					id: sid,
					path: "",
					cwd: newSessionCwd,
					name: undefined,
					created: new Date().toISOString(),
					modified: new Date().toISOString(),
					messageCount,
					firstMessage,
					transient: true,
				},
				provisionalDraftKey,
			);
		},
		[
			chatInput,
			core,
			isNew,
			newSessionCwd,
			newSessionDraftKey,
			onSessionCreated,
		],
	);

	const ensureNewSession = useCallback(async () => {
		if (core.sessionIdRef.current) return core.sessionIdRef.current;
		if (!isNew || !newSessionCwd) return core.sessionIdRef.current;
		if (core.ensuringNewSessionRef.current)
			return core.ensuringNewSessionRef.current;

		const promise = (async () => {
			// Only send explicit user overrides. The server resolves the current
			// enabledModels scope atomically with AgentSession construction.
			const selectedModel = core.newSessionModelOverrideRef.current;
			const selectedThinkingLevel = core.thinkingLevelOverrideRef.current;
			if (selectedModel) setters.setPendingModel(selectedModel);
			const toolNames = getToolNamesForPreset(toolPreset);
			const res = await fetch("/api/agent/new", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					cwd: newSessionCwd,
					type: "ensure_session",
					toolNames,
					...(selectedModel
						? {
								provider: selectedModel.provider,
								modelId: selectedModel.modelId,
							}
						: {}),
					...(selectedThinkingLevel
						? { thinkingLevel: selectedThinkingLevel }
						: {}),
				}),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const result = (await res.json()) as {
				sessionId: string;
				model?: SelectedModel | null;
				thinkingLevel?: ThinkingLevelOption;
			};
			const realId = result.sessionId;
			core.sessionIdRef.current = realId;
			if (
				result.model &&
				core.newSessionModelOverrideRef.current === selectedModel
			) {
				setters.setPendingModel(result.model);
				if (!selectedModel) setters.setNewSessionDefaultModel(result.model);
			}
			if (
				result.thinkingLevel &&
				core.thinkingLevelOverrideRef.current === selectedThinkingLevel
			) {
				setters.setThinkingLevel(result.thinkingLevel);
			}
			return realId;
		})();

		core.ensuringNewSessionRef.current = promise;
		try {
			return await promise;
		} finally {
			core.ensuringNewSessionRef.current = null;
		}
	}, [core, isNew, newSessionCwd, setters, toolPreset]);

	const loadSystemPrompt = useCallback(async () => {
		const sid = core.sessionIdRef.current ?? (await ensureNewSession());
		if (!sid) return;
		const state = await sendCommand<AgentStateResponse>(sid, {
			type: "get_state",
		});
		if (
			!core.sessionHookMountedRef.current ||
			core.sessionIdRef.current !== sid
		)
			return;
		setters.setSystemPrompt(state.systemPrompt ?? "");
	}, [core, ensureNewSession, sendCommand, setters]);

	const loadSlashCommands = useCallback(async () => {
		const sid = core.sessionIdRef.current ?? (await ensureNewSession());
		if (!sid) {
			setters.setSlashCommands([]);
			return [] as SlashCommandInfo[];
		}
		setters.setSlashCommandsLoading(true);
		try {
			const data = await sendCommand<SlashCommandsResponse>(sid, {
				type: "get_commands",
			});
			const commands = data?.commands ?? [];
			setters.setSlashCommands(commands);
			return commands;
		} catch (e) {
			console.error("Failed to load slash commands:", e);
			setters.setSlashCommands([]);
			return [] as SlashCommandInfo[];
		} finally {
			setters.setSlashCommandsLoading(false);
		}
	}, [core, ensureNewSession, sendCommand, setters]);

	const resumeSession = useCallback(async () => {
		const sid = core.sessionIdRef.current;
		if (!sid) return;
		const restored = await loadSession(sid, true, true);
		if (restored) {
			setters.setSessionLost(false);
			setters.setError(null);
		}
	}, [core, loadSession, setters]);

	return {
		loadSession,
		refreshSession,
		loadContext,
		loadTools,
		resumeSession,
		loadSystemPrompt,
		loadSlashCommands,
		ensureNewSession,
		promoteNewSession,
	};
}
