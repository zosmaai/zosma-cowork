import { ChatView } from "@/chat/ChatView";
import { HomeView } from "@/components/HomeView";
import { ProviderSetup } from "@/components/ProviderSetup";
import { RightPanel } from "@/components/RightPanel";
import { TelemetryDialog } from "@/components/TelemetryDialog";
import { AUTH_PROVIDERS, useAuth } from "@/hooks/useAuth";
import { usePiStatus } from "@/hooks/usePiStatus";
import { type StreamState, usePiStream } from "@/hooks/usePiStream";
import { useProviders } from "@/hooks/useProviders";
import { useSessions } from "@/hooks/useSessions";
import {
	chatMessagesToEvents,
	piEventsToChatMessages,
	readSession,
	writeSession,
} from "@/lib/session-store";
import { isEnabled as telemetryEnabled, trackAppLaunch, trackSessionCreated } from "@/lib/telemetry";
import { CommandsView } from "@/components/CommandsView";
import { SettingsView } from "@/settings/SettingsView";
import { Sidebar } from "@/sidebar/Sidebar";
import type { NavView } from "@/sidebar/NavIcons";
import { TasksView } from "@/tasks/TasksView";
import type { ChatMessage } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook that returns a stable function reference that always calls the latest version
 * of the given callback. This is the "latest ref" pattern — it lets us subscribe to
 * events (keydown, stream completion) with a stable effect, while always reading
 * the current closure values.
 *
 * Equivalent to React 19's useEffectEvent, but compatible with older versions.
 */
function useLatest<T extends (...args: never[]) => unknown>(callback: T): T {
	const ref = useRef(callback);
	ref.current = callback;
	return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}

function App() {
	const { status } = usePiStatus();
	const { state: streamState, startStream, abortStream, dispatch: streamDispatch } = usePiStream();
	const {
		sessions,
		activeSessionId,
		loading: sessionsLoading,
		createSession,
		deleteSession,
		refresh: refreshSessions,
	} = useSessions();
	const { config, modelsForProvider } = useProviders();
	const { hasCredentials, configuredProviders, loading: authLoading, saveApiKey } = useAuth();

	// Provider setup wizard state
	const [showProviderSetup, setShowProviderSetup] = useState(false);

	// Telemetry: show opt-in dialog on first launch if not configured
	const [showTelemetryDialog, setShowTelemetryDialog] = useState(false);

	// Check telemetry status on mount and emit app_launch
	useEffect(() => {
		(async () => {
			try {
				await trackAppLaunch();
			} catch {
				// Non-fatal
			}

			// Show opt-in dialog if telemetry has never been configured (enabled = false by default)
			const enabled = await telemetryEnabled();
			if (!enabled) {
				setShowTelemetryDialog(true);
			}
		})();
	}, []);

	const [activeView, setActiveView] = useState<NavView>("chat");
	const [rightPanelOpen, setRightPanelOpen] = useState(false);

	// Track the currently selected model for the active session.
	// Initialized to the global default, updated on user selection.
	const [activeModelId, setActiveModelId] = useState<string | undefined>(
		config?.defaultModel ?? undefined,
	);

	// Sync with config when it loads (e.g., on first mount)
	useEffect(() => {
		if (config?.defaultModel && !activeModelId) {
			setActiveModelId(config.defaultModel);
		}
	}, [config?.defaultModel, activeModelId]);

	// Persistent chat history that survives stream resets
	const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

	// Refs for accessing latest values in effects without adding deps
	const chatHistoryRef = useRef<ChatMessage[]>(chatHistory);
	chatHistoryRef.current = chatHistory;

	// Track the previous isRunning state to detect stream completion
	const prevIsRunningRef = useRef(false);

	// Use a ref for session ID to avoid React state timing issues
	const currentSessionIdRef = useRef<string | null>(null);

	// Stable callback refs for effect subscriptions
	const stableSaveSessionToDisk = useLatest(
		useCallback(
			(messages: ChatMessage[]) => {
				const sessionId = currentSessionIdRef.current;
				if (!sessionId || messages.length === 0) return;

				const events = chatMessagesToEvents(sessionId, messages);
				writeSession(sessionId, events)
					.then(() => {
						refreshSessions();
					})
					.catch((err) => console.error("[cowork] Failed to save session:", err));
			},
			[refreshSessions],
		),
	);

	// Track when a new session is created (not loading an existing one)
	const stableTrackSessionCreated = useLatest(
		useCallback(
			(sessionId: string) => {
				try {
					void trackSessionCreated({ sessionId: sessionId.substring(0, 8) });
				} catch {
					// Non-fatal
				}
			},
			[],
		),
	);

	// Keep ref in sync with state
	useEffect(() => {
		if (activeSessionId) {
			currentSessionIdRef.current = activeSessionId;
		}
	}, [activeSessionId]);

	// Handle stream completion — merge accumulated stream messages into history.
	// Refs provide latest values without re-subscribing the effect.
	const streamStateRef = useRef(streamState);
	streamStateRef.current = streamState;

	// We need isRunning as a separate reactive value to trigger the effect
	// on transitions, while reading all other state from refs.
	const isRunning = streamState.isRunning;

	useEffect(() => {
		const wasRunning = prevIsRunningRef.current;
		prevIsRunningRef.current = isRunning;

		// Detect: stream just finished (transition from running → idle)
		if (wasRunning && !isRunning) {
			const state = streamStateRef.current;
			if (state.messages.length === 0) return;

			const history = chatHistoryRef.current;

			// Find the user message that started this stream
			const streamUserMsg = state.messages.find((m) => m.role === "user");
			const streamUserContent = streamUserMsg?.content || "";

			// Find where in history this user message starts
			let overlapStart = -1;
			for (let i = history.length - 1; i >= 0; i--) {
				if (history[i].role === "user" && history[i].content === streamUserContent) {
					overlapStart = i;
					break;
				}
			}

			const finalMessages = state.messages.map((m) => ({ ...m, isStreaming: false }));

			if (overlapStart >= 0) {
				const newHistory = [...history.slice(0, overlapStart), ...finalMessages];
				setChatHistory(newHistory);
				stableSaveSessionToDisk(newHistory);
			} else {
				const newHistory = [...history, ...finalMessages];
				setChatHistory(newHistory);
				stableSaveSessionToDisk(newHistory);
			}
		}
	}, [isRunning, stableSaveSessionToDisk]);

	// Stable handler ref for keyboard shortcuts — always calls latest version
	const handleNewSessionRef = useLatest(function handleNewSession() {
		// Save current session first
		if (currentSessionIdRef.current && chatHistoryRef.current.length > 0) {
			stableSaveSessionToDisk(chatHistoryRef.current);
		}

		const id = crypto.randomUUID();
		currentSessionIdRef.current = id;
		createSession(id);
		stableTrackSessionCreated(id);
		setChatHistory([]);
		// Reset active model to the global default for new sessions
		setActiveModelId(config?.defaultModel ?? undefined);
		streamDispatch({ type: "RESET" });
	});

	// Keyboard shortcuts — registered once, handler reads latest values via stable ref
	// Listen for custom "navigate" events from child components
	// (e.g., the "Configure Providers" button in ChatView's empty state)
	useEffect(() => {
		function handleNavigate(e: Event) {
			const detail = (e as CustomEvent).detail;
			if (detail === "settings") {
				setActiveView("settings");
			}
		}
		window.addEventListener("navigate", handleNavigate);
		return () => window.removeEventListener("navigate", handleNavigate);
	}, []);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			// CMD+B: Toggle right panel
			if ((e.metaKey || e.ctrlKey) && e.key === "b") {
				e.preventDefault();
				setRightPanelOpen((prev) => !prev);
			}

			// CMD+N: New session
			if ((e.metaKey || e.ctrlKey) && e.key === "n") {
				e.preventDefault();
				handleNewSessionRef();
			}

			// Escape: Focus input
			if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
				const textarea = document.querySelector(
					"textarea[placeholder]",
				) as HTMLTextAreaElement | null;
				textarea?.focus();
			}

			// CMD+K: Reserved for command palette (future)
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				// TODO: Open command palette
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleNewSessionRef]);

	const handleSend = useCallback(
		async (text: string) => {
			// Auto-create a session if none exists.
			// Must await createSession to avoid a race with send_prompt.
			if (!currentSessionIdRef.current) {
				const id = crypto.randomUUID();
				currentSessionIdRef.current = id;
				await createSession(id);
				stableTrackSessionCreated(id);
			}
			void startStream(text, currentSessionIdRef.current);
		},
		[startStream, createSession, stableTrackSessionCreated],
	);

	// Listen for 
	async function handleModelSelect(provider: string, modelId: string) {
		// Always update the UI optimistically, even without a session yet.
		// The model will be applied when the first prompt is sent.
		setActiveModelId(modelId);

		if (!currentSessionIdRef.current) return;

		try {
			await invoke("set_active_model", {
				payload: {
					sessionId: currentSessionIdRef.current,
					provider,
					modelId,
				},
			});
		} catch (err) {
			console.error("[cowork] Failed to set active model:", err);
			// Revert on error
			setActiveModelId(config?.defaultModel ?? undefined);
		}
	}

	// Retry the last user message (for error recovery)
	// Supports automatic model fallback: if the error was a retryable provider
	// error (e.g., model unavailable), switches to a different model first.
	const handleRetry = useCallback(async () => {
		const sessionId = currentSessionIdRef.current;

		// Try automatic model fallback if the error was retryable
		const errPayload = streamState.errorPayload;
		if (
			errPayload?.retryable &&
			errPayload.provider &&
			errPayload.model &&
			sessionId &&
			modelsForProvider
		) {
			const providerModels = modelsForProvider(errPayload.provider);
			const fallbackModel = providerModels.find(
				(m) => m.id !== errPayload.model,
			);

			if (fallbackModel) {
				try {
					await invoke("set_active_model", {
						payload: {
							sessionId,
							provider: errPayload.provider,
							modelId: fallbackModel.id,
						},
					});
					setActiveModelId(fallbackModel.id);
					console.log(
						`[cowork] Fallback model: ${errPayload.provider}/${fallbackModel.id}`,
					);
				} catch (switchErr) {
					console.error(
						"[cowork] Failed to switch model for fallback:",
						switchErr,
					);
				}
			}
		}

		// Find the last user message from either the stream state or chat history
		const streamMsgs = streamState.messages;
		const lastStreamUser = [...streamMsgs].reverse().find((m) => m.role === "user");
		const lastHistoryUser = [...chatHistory].reverse().find((m) => m.role === "user");

		// Prefer the stream state (more recent), fall back to history
		const lastUserMsg = lastStreamUser || lastHistoryUser;
		if (lastUserMsg?.content) {
			void handleSend(lastUserMsg.content);
		} else {
			// Focus the input so the user can type
			const textarea = document.querySelector(
				"textarea[placeholder]",
			) as HTMLTextAreaElement | null;
			textarea?.focus();
		}
	}, [streamState.messages, streamState.errorPayload, chatHistory, handleSend, modelsForProvider]);

	async function handleSelectSession(id: string) {
		// Save current session first
		if (currentSessionIdRef.current && chatHistoryRef.current.length > 0) {
			stableSaveSessionToDisk(chatHistoryRef.current);
		}

		currentSessionIdRef.current = id;
		createSession(id);

		const data = await readSession(id);
		if (data?.events) {
			const loadedMessages = piEventsToChatMessages(data.events);
			setChatHistory(loadedMessages);
			streamDispatch({ type: "LOAD_SESSION", messages: loadedMessages });
		} else {
			setChatHistory([]);
			streamDispatch({ type: "RESET" });
		}
	}

	// Build the display messages: chat history + active stream
	const displayMessages = buildDisplayMessages(chatHistory, streamState);

	// The MetaAgents engine runs in-process (no `pi` CLI required).
	// Onboarding: if no API keys are configured, show welcome/setup flow.
	const hasAnyAuth = !!hasCredentials;
	const needsOnboarding = authLoading === false && !hasAnyAuth;

	return (
		<>
			<Sidebar
				sessions={sessions}
				activeSessionId={activeSessionId}
				sessionsLoading={sessionsLoading}
				status={status}
				activeView={activeView}
				onNewSession={handleNewSessionRef}
				onSelectSession={handleSelectSession}
				onDeleteSession={(id: string) => {
					if (currentSessionIdRef.current === id) {
						currentSessionIdRef.current = null;
						setChatHistory([]);
					}
					deleteSession(id);
				}}
				onNavigate={setActiveView}
			/>

			{/* Main content */}
			<main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
				{activeView === "chat" && (
					/* Provider setup wizard overlay */
					showProviderSetup ? (
						<ProviderSetup
							providers={AUTH_PROVIDERS}
							configuredProviders={configuredProviders}
							onSave={async (providerId, apiKey) => {
								await saveApiKey(providerId, apiKey);
								setShowProviderSetup(false);
							}}
							onCancel={() => setShowProviderSetup(false)}
						/>
					) : needsOnboarding ? (
						/* Welcome screen (no credentials yet) */
						<HomeView
							showWelcome
							onConnectProvider={() => setShowProviderSetup(true)}
						/>
					) : (
						/* Normal chat view */
						<ChatView
							messages={displayMessages}
							streamingMessage={streamState.streamingMessage}
							isRunning={streamState.isRunning}
							status={streamState.status}
							error={streamState.error}
							errorPayload={streamState.errorPayload}
							onSend={handleSend}
							onAbort={abortStream}
							onRetry={handleRetry}
							models={config?.models}
							currentModelId={activeModelId}
							onModelSelect={handleModelSelect}
						/>
					)
				)}

				{activeView === "commands" && <CommandsView />}

				{activeView === "tasks" && <TasksView />}

				{activeView === "settings" && <SettingsView />}
			</main>

			{/* Right panel */}
			{rightPanelOpen && (
				<RightPanel streamState={streamState} onClose={() => setRightPanelOpen(false)} />
			)}

			{/* Telemetry opt-in dialog (shown once on first launch) */}
			{showTelemetryDialog && <TelemetryDialog onDecided={() => setShowTelemetryDialog(false)} />}
		</>
	);
}

/**
 * Merge chat history with active stream state to produce display messages.
 * - If not streaming and no stream messages: show history only
 * - If streaming: show history followed by stream messages/streaming message
 * - Deduplicate overlap between history tail and stream messages head
 */
function buildDisplayMessages(history: ChatMessage[], streamState: StreamState): ChatMessage[] {
	// No active stream — just show history
	if (
		!streamState.isRunning &&
		streamState.messages.length === 0 &&
		!streamState.streamingMessage
	) {
		return history;
	}

	// Stream has messages — merge with history
	if (streamState.messages.length === 0) {
		return history;
	}

	const streamFirstUser = streamState.messages.find((m) => m.role === "user");
	let overlapIdx = -1;
	if (streamFirstUser) {
		for (let i = history.length - 1; i >= 0; i--) {
			if (history[i].role === "user" && history[i].content === streamFirstUser.content) {
				overlapIdx = i;
				break;
			}
		}
	}

	if (overlapIdx >= 0) {
		return [...history.slice(0, overlapIdx), ...streamState.messages];
	}

	return [...history, ...streamState.messages];
}

export default App;
