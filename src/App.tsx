import { ChatView } from "@/chat/ChatView";
import { HomeView } from "@/components/HomeView";
import { Sidebar } from "@/components/Sidebar";
import { useAuth } from "@/hooks/useAuth";
import { usePiStream } from "@/hooks/usePiStream";
import { useProviders } from "@/hooks/useProviders";
import type { ChatMessage } from "@/types";
import { invoke } from "@tauri-apps/api/core";
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
	const { models } = useProviders();
	const { hasCredentials, loading: authLoading, saveApiKey } = useAuth();
	const [showKeyEntry, setShowKeyEntry] = useState(false);
	const [sidebarView, setSidebarView] = useState("chats");

	// Session management
	const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([]);
	const [activeSessionFile, setActiveSessionFile] = useState<string | null>(null);
	/** Messages loaded from a saved session file — merged with stream messages */
	const [loadedSessionMessages, setLoadedSessionMessages] = useState<ChatMessage[] | null>(null);
	const [loadingSession, setLoadingSession] = useState(false);

	const needsOnboarding = authLoading === false && !hasCredentials;

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
			const title = typeof firstMsg.content === "string"
				? firstMsg.content.slice(0, 80)
				: "Chat";

			// Update loaded messages so the display shows full history
			setLoadedSessionMessages(merged);

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
			if (!sessionFile) {
				sessionFile = `session-${Date.now()}.jsonl`;
				setActiveSessionFile(sessionFile);
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
			{!needsOnboarding && !showKeyEntry && (
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
				{!needsOnboarding && (
					<header className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
						<div className="flex items-center gap-2">
							<h1 className="text-sm font-semibold text-foreground">Zosma Cowork</h1>
							<span className="text-xs text-muted-foreground">OpenCode Go</span>
						</div>
						{activeModelId && (
							<span className="text-xs text-muted-foreground/50 font-mono">
								{models.find((m) => m.id === activeModelId)?.name || activeModelId}
							</span>
						)}
					</header>
				)}

				{/* Content */}
				<main className="flex-1 flex flex-col min-h-0">
					{needsOnboarding || showKeyEntry ? (
						<HomeView
							onComplete={async (apiKey) => {
								await handleOnboardingComplete(apiKey);
								setShowKeyEntry(false);
							}}
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
								const lastUser = [...displayMessages]
									.reverse()
									.find((m) => m.role === "user");
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
