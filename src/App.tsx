import { ChatView } from "@/chat/ChatView";
import { HomeView } from "@/components/HomeView";
import { Sidebar } from "@/components/Sidebar";
import { useAuth } from "@/hooks/useAuth";
import { usePiStream } from "@/hooks/usePiStream";
import { useProviders } from "@/hooks/useProviders";
import type { ChatMessage } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

interface SessionEntry {
	file: string;
	title: string;
	model?: string;
	provider?: string;
	messageCount: number;
	createdAt: number;
	lastActivity: number;
}

function App() {
	const { state: streamState, startStream, abortStream, toolPhase, dispatch } = usePiStream();

	// Prevent right-click context menu (no reload/inspect in the desktop app)
	useEffect(() => {
		function handler(e: MouseEvent) {
			e.preventDefault();
		}
		document.addEventListener("contextmenu", handler);
		return () => document.removeEventListener("contextmenu", handler);
	}, []);
	const { models } = useProviders();
	const { hasCredentials, loading: authLoading, saveApiKey } = useAuth();
	const [showKeyEntry, setShowKeyEntry] = useState(false);
	// User explicitly chose "configure in Settings" — bypass the Connect
	// modal even without stored credentials.
	const [skipOnboarding, setSkipOnboarding] = useState(false);
	const [sidebarView, setSidebarView] = useState("chats");
	// True iff at least one subscription (OAuth) provider is signed in.
	// Drives the "Skip" → "Continue" label flip on the Connect modal —
	// note this is *narrower* than `hasCredentials`, which is true for any
	// API-key save too.
	const [hasSubscription, setHasSubscription] = useState(false);

	// Session management
	const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([]);
	const [activeSessionFile, setActiveSessionFile] = useState<string | null>(null);
	/** Messages loaded from a saved session file — merged with stream messages */
	const [loadedSessionMessages, setLoadedSessionMessages] = useState<ChatMessage[] | null>(null);
	const [loadingSession, setLoadingSession] = useState(false);

	const needsOnboarding = authLoading === false && !hasCredentials;
	// Whether to render the Connect / API-key modal. Either we're forcing
	// it (initial onboarding, unless the user explicitly skipped) or the
	// user opened "Change API Key" from Settings.
	const showConnectModal =
		(needsOnboarding && !skipOnboarding) || showKeyEntry;

	// Settings persistence
	const settingsLoadedRef = useRef(false);

	// Model management
	const [activeModelId, setActiveModelId] = useState<string | undefined>();

	// ── Startup: restore model from settings and load session list ──
	useEffect(() => {
		if (models.length > 0 && !settingsLoadedRef.current) {
			settingsLoadedRef.current = true;
			invoke("get_settings")
				.then((result) => {
					const data = result as { defaultModel?: string; defaultProvider?: string };
					console.log("[settings] loaded:", data);
					if (data.defaultModel) {
						const match = models.find((m) => m.id === data.defaultModel);
						if (match) {
							console.log("[settings] restoring model:", match.id);
							setActiveModelId(match.id);
							invoke("set_active_model", {
								provider: match.provider,
								model: match.id,
							}).catch(() => {});
							return;
						}
					}
					setActiveModelId(models[0].id);
				})
				.catch((err) => {
					console.warn("[settings] load failed:", err);
					if (models.length > 0) setActiveModelId(models[0].id);
				});
		} else if (models.length > 0 && !activeModelId) {
			setActiveModelId(models[0].id);
		}
	}, [models, activeModelId]);

	useEffect(() => {
		if (!needsOnboarding && !showKeyEntry) {
			loadSessionList().catch(() => {});
		}
	}, [needsOnboarding, showKeyEntry]);

	// A successful OAuth sign-in should dismiss the Connect modal even
	// when it was opened via "Change API Key" (where `hasCredentials` was
	// already true and so `needsOnboarding` never flips). We listen for
	// the Tauri `oauth_completed` event specifically — NOT `config-reload`,
	// because the latter also fires on sign-out/key-remove and would
	// otherwise wrongly dump a just-signed-out user back into chat with
	// no credentials.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		(async () => {
			unlisten = await listen("oauth_completed", () => {
				setShowKeyEntry(false);
			});
		})();
		return () => unlisten?.();
	}, []);

	// Track whether any subscription (OAuth) is signed in. Refreshes on
	// mount, on sidecar "ready", and on every `config-reload` (which fires
	// for both sign-in and sign-out, so we always re-check).
	useEffect(() => {
		async function refresh() {
			try {
				const res = await invoke<{
					providers: Array<{ id: string; type: string }>;
				}>("get_auth_status");
				const any = (res.providers ?? []).some((p) => p.type === "oauth");
				setHasSubscription(any);
			} catch {
				// Sidecar may not be ready yet — leave existing state.
			}
		}
		refresh();
		const onReload = () => refresh();
		window.addEventListener("config-reload", onReload);
		let unlisten: (() => void) | undefined;
		(async () => {
			unlisten = await listen("ready", () => refresh());
		})();
		return () => {
			window.removeEventListener("config-reload", onReload);
			unlisten?.();
		};
	}, []);

	async function loadSessionList() {
		try {
			const result = await invoke("list_sessions");
			const data = result as { sessions?: SessionEntry[] };
			setSessionEntries(data.sessions || []);
		} catch (err) {
			console.error("Failed to load sessions:", err);
		}
	}

	// ── When stream completes, merge into loaded messages and save to disk ──
	// biome-ignore lint/correctness/useExhaustiveDependencies: Only trigger when stream finishes, not on every dep change
	useEffect(() => {
		if (!streamState.isRunning && streamState.messages.length > 0) {
			const sid = activeSessionFile;
			if (!sid) return;

			// Merge: loaded history + new stream messages
			const merged = loadedSessionMessages
				? [...loadedSessionMessages, ...streamState.messages]
				: streamState.messages;

			if (merged.length === 0) return;

			const firstMsg = merged[0];
			const title = typeof firstMsg.content === "string" ? firstMsg.content.slice(0, 80) : "Chat";

			// Update loaded messages so the display shows full history
			setLoadedSessionMessages(merged);

			// Clear stream messages to prevent duplication on next render
			dispatch({ type: "RESET" });

			// Save to disk
			invoke("save_session", {
				sid,
				title,
				messages: merged,
				model: merged.find((m) => m.model)?.model || null,
				provider: merged.find((m) => m.provider)?.provider || null,
			}).catch((err) => console.error("Failed to save session:", err));

			// Update sidebar entry
			setSessionEntries((prev) => {
				const filtered = prev.filter((s) => s.file !== sid);
				return [
					{
						file: sid,
						title,
						messageCount: merged.length,
						createdAt: prev.find((s) => s.file === sid)?.createdAt || Date.now(),
						lastActivity: Date.now(),
					},
					...filtered,
				];
			});
		}
	}, [streamState.isRunning]);

	// ── Send a new prompt ──
	const handleSend = useCallback(
		async (text: string) => {
			let sessionFile = activeSessionFile;
			const isNewSession = !sessionFile;
			if (!sessionFile) {
				sessionFile = `session-${Date.now()}.jsonl`;
				setActiveSessionFile(sessionFile);
			}

			// Immediately show session in sidebar with title from first message
			if (isNewSession) {
				const title = text.length > 80 ? `${text.slice(0, 77)}...` : text;
				setSessionEntries((prev) => [
					{
						file: sessionFile,
						title,
						messageCount: 1,
						createdAt: Date.now(),
						lastActivity: Date.now(),
					},
					...prev,
				]);
			}

			// Keep loadedSessionMessages — startStream only produces the new turn.
			// Merging happens in the stream-complete effect above.
			startStream(text);
		},
		[activeSessionFile, startStream],
	);

	const handleModelSelect = async (_provider: string, modelId: string) => {
		setActiveModelId(modelId);
		try {
			const model = models.find((m) => m.id === modelId);
			console.log("[settings] saving model:", modelId);
			await invoke("save_settings", {
				settings: {
					defaultModel: modelId,
					defaultProvider: model?.provider || _provider,
				},
			});
			// Actually set the model on the sidecar so it takes effect immediately
			await invoke("set_active_model", {
				provider: model?.provider || _provider,
				model: modelId,
			});
		} catch (err) {
			console.warn("[settings] save failed:", err);
		}
	};

	const handleOnboardingComplete = async (apiKey: string) => {
		await saveApiKey(apiKey);
	};

	const handleNewSession = useCallback(async () => {
		try {
			await invoke("new_session");
		} catch {
			// ignore
		}
		dispatch({ type: "RESET" });
		setLoadedSessionMessages(null);
		setActiveSessionFile(`session-${Date.now()}.jsonl`);
	}, [dispatch]);

	const handleDeleteSession = useCallback(
		async (file: string) => {
			try {
				await invoke("delete_session", { sessionFile: file });
			} catch {
				// ignore
			}
			setSessionEntries((prev) => prev.filter((s) => s.file !== file));
			if (activeSessionFile === file) {
				setActiveSessionFile(null);
				setLoadedSessionMessages(null);
				dispatch({ type: "RESET" });
			}
		},
		[activeSessionFile, dispatch],
	);

	const handleSessionSelect = useCallback(
		async (file: string) => {
			if (file === activeSessionFile) return;
			setLoadingSession(true);
			setActiveSessionFile(file);
			setLoadedSessionMessages(null);
			dispatch({ type: "RESET" });
			try {
				const result = await invoke("load_session", { sessionFile: file });
				const data = result as { messages: ChatMessage[] };
				if (data.messages && data.messages.length > 0) {
					setLoadedSessionMessages(data.messages);
				}
			} catch (err) {
				console.error("Failed to load session:", err);
			} finally {
				setLoadingSession(false);
			}
		},
		[activeSessionFile, dispatch],
	);

	// ── Build display messages ──
	// Show loaded session history + any new stream messages together
	const displayMessages = loadedSessionMessages
		? streamState.messages.length > 0
			? [...loadedSessionMessages, ...streamState.messages]
			: loadedSessionMessages
		: streamState.messages;

	const sidebarSessions = sessionEntries.map((s) => ({
		id: s.file,
		title: s.title,
		lastMessage: `${s.messageCount} messages`,
		timestamp: s.lastActivity || s.createdAt,
		active: s.file === activeSessionFile,
	}));

	return (
		<div className="flex h-screen bg-background">
			{/* Sidebar */}
			{!showConnectModal && (
				<Sidebar
					view={sidebarView}
					sessions={sidebarSessions}
					activeSessionId={activeSessionFile || undefined}
					onSessionSelect={(id) => {
						setSidebarView("chats");
						handleSessionSelect(id);
					}}
					onNewSession={handleNewSession}
					onDeleteSession={handleDeleteSession}
					onChangeView={setSidebarView}
					onShowKeyEntry={() => setShowKeyEntry(true)}
				/>
			)}

			{/* Main content */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Header bar */}
				{!showConnectModal && (
					<header className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
						<div className="flex items-center gap-2">
							<h1 className="text-sm font-semibold text-foreground">Zosma Cowork</h1>
							<span className="text-xs text-muted-foreground">OpenCode Go</span>
						</div>
						{activeModelId &&
							(() => {
								const m = models.find((m) => m.id === activeModelId);
								const p = m?.provider?.split("-")[0] || "";
								return (
									<span className="text-xs text-muted-foreground/50 font-mono">
										{m?.name || activeModelId}
										{p && <span className="text-muted-foreground/30"> ({p})</span>}
									</span>
								);
							})()}
					</header>
				)}

				{/* Content */}
				<main className="flex-1 flex flex-col min-h-0">
					{showConnectModal ? (
						<HomeView
							onComplete={async (apiKey) => {
								await handleOnboardingComplete(apiKey);
								setShowKeyEntry(false);
							}}
							onSkipToSettings={() => {
								setSkipOnboarding(true);
								setShowKeyEntry(false);
								setSidebarView("settings");
							}}
							onDismiss={() => {
								setSkipOnboarding(true);
								setShowKeyEntry(false);
							}}
							hasSubscription={hasSubscription}
						/>
					) : loadingSession ? (
						<div className="flex-1 flex items-center justify-center">
							<div className="text-sm text-muted-foreground">Loading session...</div>
						</div>
					) : (
						<ChatView
							messages={displayMessages}
							streamingMessage={streamState.streamingMessage}
							isRunning={streamState.isRunning}
							status={streamState.status}
							error={streamState.error}
							onSend={handleSend}
							onAbort={() => abortStream()}
							onRetry={() => {
								const lastUser = [...displayMessages].reverse().find((m) => m.role === "user");
								if (lastUser?.content) handleSend(lastUser.content);
							}}
							models={models}
							currentModelId={activeModelId}
							onModelSelect={handleModelSelect}
							toolPhase={toolPhase}
						/>
					)}
				</main>
			</div>
		</div>
	);
}

export default App;
