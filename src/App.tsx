import { ChatView } from "@/chat/ChatView";
import { ChatWidthToggle } from "@/components/ChatWidthToggle";
import { ExtensionUiHost } from "@/components/ExtensionUiHost";
import { HomeView } from "@/components/HomeView";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { MobileTopBar } from "@/components/MobileTopBar";
import { RemoteConnectionBar } from "@/components/RemoteConnectionBar";
import { SettingsPage } from "@/components/SettingsPage";
import { ShareExport } from "@/components/ShareExport";
import { Sidebar } from "@/components/Sidebar";
import { SplashScreen } from "@/components/SplashScreen";
import { TelemetryConsentDialog } from "@/components/TelemetryConsentDialog";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUpdate } from "@/contexts/UpdateProvider";
import { useAuth } from "@/hooks/useAuth";
import { usePiStream } from "@/hooks/usePiStream";
import { useProviders } from "@/hooks/useProviders";
import { useTelemetry } from "@/hooks/useTelemetry";
import {
	BUILTIN_COMMANDS,
	type CommandContext,
	findBuiltinCommand,
	runBuiltinCommand,
} from "@/lib/builtinCommands";
import { findModel, modelKey } from "@/lib/model-key";
import { trackEvent } from "@/lib/telemetry";
import type { ChatMessage } from "@/types";
import type { Command } from "@/types/commands";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { getFontScale } from "./lib/font-scale";

interface SessionEntry {
	file: string;
	title: string;
	model?: string;
	provider?: string;
	/** Workspace folder this session ran in (for folder-grouped sidebar). */
	cwd?: string;
	messageCount: number;
	createdAt: number;
	lastActivity: number;
	/** Pinned sessions float to the top of the sidebar list. */
	pinned?: boolean;
	/** Whether the title was manually renamed (auto-titles won't overwrite). */
	titleLocked?: boolean;
	/** One-line preview of the latest message (real content, for the sidebar). */
	preview?: string;
}

function App() {
	const appUpdate = useUpdate();
	const {
		state: streamState,
		startStream,
		abortStream,
		steerStream,
		followUpStream,
		clearQueue,
		toolPhase,
		dispatch,
		// #268 — status-line telemetry + reasoning control
		sessionStats,
		thinking,
		refreshStats,
		cycleThinking,
	} = usePiStream();
	const telemetry = useTelemetry();
	const [showTelemetryConsent, setShowTelemetryConsent] = useState<boolean | null>(null);
	const personaRef = useRef("");

	// Load custom instructions (persona) from settings
	useEffect(() => {
		invoke<{ persona?: string }>("get_settings")
			.then((settings) => {
				if (settings?.persona) {
					personaRef.current = settings.persona;
				}
			})
			.catch(() => {});
	}, []);

	// Remove right-click prevention — users need copy/paste/inspect.
	// The desktop app is a serious tool, not a locked-down kiosk.
	// (Context menu prevention removed intentionally.)
	const { models } = useProviders();
	const { hasCredentials, loading: authLoading, saveApiKey } = useAuth();
	// Whether the agent sidecar has finished booting. Until it has,
	// `has_credentials` always resolves to false (see src-tauri lib.rs), so we
	// can't yet tell authenticated users apart from new ones. We track this to
	// show a loading splash instead of flashing the onboarding screen (#169).
	// In remote/browser mode (no Tauri) the server is already up at page load
	// and the native `ready` event never fires, so we start ready there.
	const [sidecarReady, setSidecarReady] = useState(() => !isTauri());
	const [showKeyEntry, setShowKeyEntry] = useState(false);
	// User explicitly chose "configure in Settings" — bypass the Connect
	// modal even without stored credentials.
	const [skipOnboarding, setSkipOnboarding] = useState(false);
	const [sidebarView, setSidebarView] = useState("chats");
	const [showSettings, setShowSettings] = useState(false);
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	// True iff at least one subscription (OAuth) provider is signed in.
	// Drives the "Skip" → "Continue" label flip on the Connect modal —
	// note this is *narrower* than `hasCredentials`, which is true for any
	// API-key save too.
	const [hasSubscription, setHasSubscription] = useState(false);

	// Session management
	const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([]);
	const [activeSessionFile, setActiveSessionFile] = useState<string | null>(null);
	// Draft prompt pushed into the composer (e.g. when a template is clicked).
	// The bumping `nonce` lets the same prompt be re-applied on repeated clicks.
	const [composerDraft, setComposerDraft] = useState<{ text: string; nonce: number }>();
	// The agent's current workspace folder (where file/bash tools read & write).
	const [workspaceCwd, setWorkspaceCwd] = useState<string | null>(null);
	// The user's home dir (sidecar's default workspace) — used to label the
	// "Home" folder group in the sidebar.
	const [homeDir, setHomeDir] = useState<string | null>(null);
	/** Messages loaded from a saved session file — merged with stream messages */
	const [loadedSessionMessages, setLoadedSessionMessages] = useState<ChatMessage[] | null>(null);
	const [loadingSession, setLoadingSession] = useState(false);

	// ── Sidecar readiness: drives the startup splash (#169) ──
	// Listen for the Tauri `ready` event, plus a timeout fallback so the
	// splash never hangs forever if the sidecar fails to start.
	useEffect(() => {
		if (!isTauri()) return;
		let mounted = true;
		let unlisten: (() => void) | undefined;
		(async () => {
			const u = await listen("ready", () => {
				if (mounted) setSidecarReady(true);
			});
			if (!mounted) {
				u();
				return;
			}
			unlisten = u;
		})();
		// Fallback: stop waiting after 20s and let the normal UI take over.
		const timeout = setTimeout(() => {
			if (mounted) setSidecarReady(true);
		}, 20_000);
		return () => {
			mounted = false;
			clearTimeout(timeout);
			unlisten?.();
		};
	}, []);

	// ── First-run telemetry consent (#169 follow-up) ──
	// POLL `get_settings` until it succeeds, then decide. The sidecar may still
	// be booting (get_settings throws "no sidecar"/"timeout"), and concurrent
	// callers can transiently collide. The previous single-shot version gave up
	// on the first failure (catch → false), so a fresh install silently skipped
	// the prompt and dropped straight to the Welcome screen. We only set a
	// definitive state on a SUCCESSFUL read, and only give up after ~30s.
	useEffect(() => {
		let cancelled = false;
		const startedAt = Date.now();
		async function decide() {
			while (!cancelled) {
				try {
					const settings = await invoke<{ telemetry?: { enabled?: boolean } }>("get_settings");
					if (cancelled) return;
					// Show the popup only when no decision has been stored yet
					// (new user, or upgrade from a pre-telemetry version).
					if (settings?.telemetry === undefined) {
						setShowTelemetryConsent(true);
					} else {
						setShowTelemetryConsent(false);
						if (settings.telemetry.enabled) {
							trackEvent("app_launch");
						}
					}
					return; // authoritative answer — stop polling
				} catch {
					if (cancelled) return;
					if (Date.now() - startedAt > 30_000) {
						// Couldn't read settings after 30s — don't block forever.
						setShowTelemetryConsent(false);
						return;
					}
					await new Promise((r) => setTimeout(r, 400));
				}
			}
		}
		void decide();
		return () => {
			cancelled = true;
		};
	}, []);

	const needsOnboarding = authLoading === false && !hasCredentials;
	// True until the first-run telemetry decision is resolved: `null` while we're
	// still reading settings, `true` while the popup is awaiting the user's
	// choice. We keep the neutral splash behind the consent modal so telemetry is
	// genuinely the FIRST thing a new user sees — not the onboarding screen.
	const telemetryUndecided = showTelemetryConsent !== false;
	// While the sidecar is still booting we can't determine credentials, so
	// show a loading splash rather than the onboarding/Welcome screen. Keeping
	// `authLoading` in the condition avoids a one-frame onboarding flash during
	// the credentials re-check that fires right after the sidecar becomes ready.
	const initializing =
		telemetryUndecided || (!sidecarReady && (authLoading || hasCredentials !== true));
	// Whether to render the Connect / API-key modal. Either we're forcing
	// it (initial onboarding, unless the user explicitly skipped) or the
	// user opened "Change API Key" from Settings.
	const showConnectModal = (needsOnboarding && !skipOnboarding) || showKeyEntry;

	// Settings persistence
	const settingsLoadedRef = useRef(false);

	// Model management
	const [activeModelId, setActiveModelId] = useState<string | undefined>();

	// ── Startup: restore model from settings and load session list ──
	useEffect(() => {
		if (models.length > 0 && !settingsLoadedRef.current) {
			settingsLoadedRef.current = true;
			(async () => {
				let data: { defaultModel?: string; defaultProvider?: string } = {};
				try {
					data = (await invoke("get_settings")) as typeof data;
					console.log("[settings] loaded:", data);
				} catch (err) {
					console.warn("[settings] load failed:", err);
				}

				// 1. Honour the user's explicitly-saved model and push it to the
				//    engine so it actually takes effect. Match on provider+id: ids
				//    are NOT unique across providers, so matching by id alone could
				//    bind the wrong provider (e.g. zai/glm vs opencode-go/glm).
				if (data.defaultModel) {
					const match =
						models.find((m) => m.id === data.defaultModel && m.provider === data.defaultProvider) ??
						models.find((m) => m.id === data.defaultModel);
					if (match) {
						console.log("[settings] restoring model:", match.provider, match.id);
						setActiveModelId(modelKey(match.provider, match.id));
						invoke("set_active_model", {
							provider: match.provider,
							model: match.id,
						}).catch(() => {});
						return;
					}
				}

				// 2. No saved preference: MIRROR the engine's actual model so the
				//    selector matches the model that will really answer (the
				//    per-message usage label). No push needed — it's already active.
				try {
					const engine = (await invoke("get_active_model")) as {
						provider?: string;
						id?: string;
					} | null;
					const key = engine?.id ? modelKey(engine.provider, engine.id) : undefined;
					if (key && findModel(models, key)) {
						console.log("[settings] mirroring engine model:", key);
						setActiveModelId(key);
						return;
					}
				} catch (err) {
					console.warn("[settings] get_active_model failed:", err);
				}

				// 3. Last resort: pick the first model AND push it so the UI and
				//    engine still agree even if the mirror query failed.
				const fallback = models[0];
				setActiveModelId(modelKey(fallback.provider, fallback.id));
				invoke("set_active_model", {
					provider: fallback.provider,
					model: fallback.id,
				}).catch(() => {});
			})();
		} else if (models.length > 0 && !activeModelId) {
			setActiveModelId(modelKey(models[0].provider, models[0].id));
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
		// Guard against async-cleanup race in StrictMode dev / HMR. Without
		// this, the listener registers after cleanup ran, leaks, and a
		// future `oauth_completed` event fires it multiple times.
		let mounted = true;
		let unlisten: (() => void) | undefined;
		(async () => {
			const u = await listen("oauth_completed", () => {
				setShowKeyEntry(false);
			});
			if (!mounted) {
				u();
				return;
			}
			unlisten = u;
		})();
		return () => {
			mounted = false;
			unlisten?.();
		};
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
		let mounted = true;
		let unlisten: (() => void) | undefined;
		(async () => {
			const u = await listen("ready", () => refresh());
			if (!mounted) {
				u();
				return;
			}
			unlisten = u;
		})();
		return () => {
			mounted = false;
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
			})
				// Reconcile the sidebar with disk truth (so the cwd stamped into the
				// header drives folder grouping and nothing is "not listed").
				.then(() => loadSessionList())
				.catch((err) => console.error("Failed to save session:", err));

			// Optimistic sidebar entry (folder = active workspace). A user-renamed
			// (locked) title must not be clobbered by the auto-derived one, and the
			// pin state is preserved across the optimistic update.
			setSessionEntries((prev) => {
				const existing = prev.find((s) => s.file === sid);
				const filtered = prev.filter((s) => s.file !== sid);
				return [
					{
						file: sid,
						title: existing?.titleLocked ? existing.title : title,
						cwd: workspaceCwd ?? undefined,
						messageCount: merged.length,
						createdAt: existing?.createdAt || Date.now(),
						lastActivity: Date.now(),
						pinned: existing?.pinned,
						titleLocked: existing?.titleLocked,
						preview:
							typeof merged[merged.length - 1]?.content === "string"
								? (merged[merged.length - 1].content as string)
										.replace(/\s+/g, " ")
										.trim()
										.slice(0, 120)
								: existing?.preview,
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
						cwd: workspaceCwd ?? undefined,
						messageCount: 1,
						createdAt: Date.now(),
						lastActivity: Date.now(),
					},
					...prev,
				]);
				trackEvent("session_created");
			}

			// Track message with provider/model info
			const activeModel = findModel(models, activeModelId);
			trackEvent("message_sent", {
				provider: activeModel?.provider?.split("-")[0] ?? "unknown",
				model: activeModel?.id ?? "unknown",
			});

			// Keep loadedSessionMessages — startStream only produces the new turn.
			// Merging happens in the stream-complete effect above.
			const finalText = personaRef.current ? `${personaRef.current}\n\n---\n\n${text}` : text;
			startStream(finalText);
		},
		[activeSessionFile, startStream, models, activeModelId, workspaceCwd],
	);

	// Load a prompt template into the composer instead of sending it directly,
	// so the user can review/edit before hitting send.
	const handleUseTemplate = useCallback((prompt: string) => {
		setSidebarView("chats");
		setShowSettings(false);
		setMobileMenuOpen(false);
		setComposerDraft((prev) => ({ text: prompt, nonce: (prev?.nonce ?? 0) + 1 }));
	}, []);

	/**
	 * Issue #201 PR 3 — Ctrl+↑ in the composer fires this. We atomically
	 * drain the SDK queue (so nothing fires while the user is editing) and
	 * load the drained messages into the composer via the existing
	 * `draft` channel.
	 *
	 * Format: steering items first, follow-up items second, separated by a
	 * blank line. The user can rewrite, reorder, or delete freely. When
	 * they press Enter / Alt+Enter, the whole edited blob re-queues as ONE
	 * message (intentional: simpler than splitting + per-kind round-trip,
	 * and the agent reads the result identically). If they want to drop
	 * the queue entirely they just clear the textarea — nothing fires.
	 */
	const handleEditQueue = useCallback(async () => {
		const drained = await clearQueue();
		const all = [...drained.steering, ...drained.followUp];
		if (all.length === 0) return;
		const joined = all.join("\n\n");
		setComposerDraft((prev) => ({
			text: joined,
			nonce: (prev?.nonce ?? 0) + 1,
		}));
	}, [clearQueue]);

	const handleModelSelect = useCallback(async (provider: string, modelId: string) => {
		setActiveModelId(modelKey(provider, modelId));
		try {
			console.log("[settings] saving model:", provider, modelId);
			await invoke("save_settings", {
				settings: {
					defaultModel: modelId,
					defaultProvider: provider,
				},
			});
			// Actually set the model on the sidecar so it takes effect immediately
			await invoke("set_active_model", {
				provider,
				model: modelId,
			});
		} catch (err) {
			console.warn("[settings] save failed:", err);
		}
	}, []);

	// ── Connect-modal handlers (passed to <HomeView>) ──
	const handleConnectComplete = useCallback(
		async (provider: string, apiKey: string) => {
			await saveApiKey(provider, apiKey);
			setShowKeyEntry(false);
		},
		[saveApiKey],
	);

	const handleSkipToSettings = useCallback(() => {
		setSkipOnboarding(true);
		setShowKeyEntry(false);
		setShowSettings(true);
		setSidebarView("settings");
	}, []);

	const handleDismissConnect = useCallback(() => {
		setSkipOnboarding(true);
		setShowKeyEntry(false);
	}, []);

	// Create a fresh session bound to `cwd` (a chosen folder). The sidecar
	// returns the resolved workspace (it may fall back to home if the path was
	// invalid) — we reflect that. Creating a new session never mutates the
	// previously-active session's folder; each session owns its own cwd.
	const handleNewSession = useCallback(
		async (cwd?: string) => {
			let resolvedCwd: string | undefined;
			try {
				const res = await invoke<{ cwd?: string }>("new_session", cwd ? { cwd } : {});
				if (res && typeof res.cwd === "string") {
					resolvedCwd = res.cwd;
					setWorkspaceCwd(res.cwd);
				}
			} catch {
				// ignore
			}
			dispatch({ type: "RESET" });
			setLoadedSessionMessages(null);
			setActiveSessionFile(`session-${Date.now()}.jsonl`);
			// #268 — fresh session starts with empty totals; resync the footer.
			void refreshStats();
			return resolvedCwd;
		},
		[dispatch, refreshStats],
	);

	// "New session" ALWAYS asks for a folder first (native picker), then starts
	// a fresh session bound to it — the chosen directory becomes the agent's
	// working dir, so generated files land where the user expects (pi's "open
	// from any folder"). Cancelling the picker is a no-op: we never silently
	// create a session in an unintended folder, and the active session is left
	// untouched.
	const handleNewSessionPrompt = useCallback(async () => {
		let selected: string | null = null;
		try {
			const picked = await openDialog({
				directory: true,
				multiple: false,
				title: "Choose a folder for this session",
				...(workspaceCwd ? { defaultPath: workspaceCwd } : {}),
			});
			if (typeof picked === "string") selected = picked;
		} catch {
			// dialog unavailable — fall through to no-op
		}
		if (!selected) return; // cancelled — don't create, don't touch active session
		setSidebarView("chats");
		await handleNewSession(selected);
	}, [handleNewSession, workspaceCwd]);

	// Slash-command dispatch (epic #179). Built-in commands close over these
	// GUI actions; the registry itself is pure (src/lib/builtinCommands.ts).
	// Interim: bare `/model` and `/help` open Settings until dedicated UI lands
	// (see docs/plans/slash-commands-roadmap.md A2b).
	const handleRunCommand = useCallback(
		(cmd: Command, args: string) => {
			const builtin = findBuiltinCommand(cmd.name);
			if (!builtin) return;
			const openSettings = () => {
				setSidebarView("settings");
				setShowSettings(true);
			};
			const ctx: CommandContext = {
				newSession: () => handleNewSessionPrompt(),
				openSessions: () => setSidebarView("chats"),
				openModelSelector: openSettings,
				setModel: (modelId) => {
					const match = models.find(
						(m) => m.id === modelId || modelKey(m.provider, m.id) === modelId,
					);
					if (match) handleModelSelect(match.provider, match.id);
				},
				openSettings,
				showHelp: openSettings,
			};
			runBuiltinCommand(ctx, builtin, args);
		},
		[handleNewSessionPrompt, handleModelSelect, models],
	);

	// Load the sidecar's active workspace once it's ready, so the sidebar can
	// show "where am I working" from the first paint.
	useEffect(() => {
		let cancelled = false;
		invoke<{ cwd?: string; default?: string }>("get_workspace")
			.then((res) => {
				if (cancelled || !res) return;
				if (typeof res.cwd === "string") setWorkspaceCwd(res.cwd);
				if (typeof res.default === "string") setHomeDir(res.default);
			})
			.catch(() => {
				// sidecar not ready yet — harmless; updated on next new_session
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Font scale / zoom preference
	const [fontScale, setFontScale] = useState<number>(() => getFontScale());

	const [pendingDelete, setPendingDelete] = useState<{ file: string; title: string } | null>(null);

	const handleDeleteSession = useCallback(
		(file: string) => {
			const entry = sessionEntries.find((s) => s.file === file);
			setPendingDelete({ file, title: entry?.title ?? "this chat" });
		},
		[sessionEntries],
	);

	const handleConfirmDelete = useCallback(async () => {
		if (!pendingDelete) return;
		const file = pendingDelete.file;
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
	}, [pendingDelete, activeSessionFile, dispatch]);

	// ── Rename a session (sticky, user-chosen title) ──
	// biome-ignore lint/correctness/useExhaustiveDependencies: loadSessionList is a stable component-scope reconcile helper
	const handleRenameSession = useCallback(async (file: string, title: string) => {
		const clean = title.trim();
		if (!clean) return;
		// Optimistic: update the sidebar immediately and lock the title so the
		// auto-derive-on-save path won't clobber it before the disk reconcile.
		setSessionEntries((prev) =>
			prev.map((s) => (s.file === file ? { ...s, title: clean, titleLocked: true } : s)),
		);
		try {
			await invoke("rename_session", { sessionFile: file, title: clean });
			trackEvent("session_renamed");
		} catch (err) {
			console.error("Failed to rename session:", err);
			loadSessionList().catch(() => {});
		}
	}, []);

	// ── Pin / unpin a session ──
	// biome-ignore lint/correctness/useExhaustiveDependencies: loadSessionList is a stable component-scope reconcile helper
	const handlePinSession = useCallback(async (file: string, pinned: boolean) => {
		setSessionEntries((prev) => prev.map((s) => (s.file === file ? { ...s, pinned } : s)));
		try {
			await invoke("set_session_pinned", { sessionFile: file, pinned });
			trackEvent(pinned ? "session_pinned" : "session_unpinned");
			// Reconcile so pinned-first ordering matches disk truth.
			loadSessionList().catch(() => {});
		} catch (err) {
			console.error("Failed to pin session:", err);
			loadSessionList().catch(() => {});
		}
	}, []);

	// ── Deep content search across all session bodies ──
	const handleDeepSearch = useCallback(async (query: string) => {
		try {
			const result = await invoke("search_sessions", { query });
			const data = result as { matches?: { file: string; snippet: string; matchCount: number }[] };
			return data.matches ?? [];
		} catch (err) {
			console.error("Deep search failed:", err);
			return [];
		}
	}, []);

	const handleSessionSelect = useCallback(
		async (file: string) => {
			if (file === activeSessionFile) return;
			setLoadingSession(true);
			setActiveSessionFile(file);
			setLoadedSessionMessages(null);
			dispatch({ type: "RESET" });
			try {
				const result = await invoke("load_session", { sessionFile: file });
				const data = result as { messages: ChatMessage[]; cwd?: string };
				if (data.messages && data.messages.length > 0) {
					setLoadedSessionMessages(data.messages);
				}
				// Reflect the workspace this session was restored into (the sidecar
				// rebinds to the session's saved folder, or home for legacy chats).
				if (typeof data.cwd === "string") {
					setWorkspaceCwd(data.cwd);
				}
				// #268 — the sidecar rebinds to the loaded session; pull its
				// token/cost/context totals so the footer reflects history.
				void refreshStats();
			} catch (err) {
				console.error("Failed to load session:", err);
			} finally {
				setLoadingSession(false);
			}
		},
		[activeSessionFile, dispatch, refreshStats],
	);

	// ── Build display messages ──
	// Show loaded session history + any new stream messages together
	const displayMessages = loadedSessionMessages
		? streamState.messages.length > 0
			? [...loadedSessionMessages, ...streamState.messages]
			: loadedSessionMessages
		: streamState.messages;

	// Hide the app chrome (sidebar, mobile bars, share button) whenever the
	// main pane is showing a full-screen state: onboarding, settings, or the
	// startup loading splash (#169).
	const hideChrome = showConnectModal || showSettings || initializing;

	const sidebarSessions = sessionEntries.map((s) => ({
		id: s.file,
		title: s.title,
		// Prefer a real content preview; fall back to a count for empty sessions.
		lastMessage: s.preview?.trim() ? s.preview : `${s.messageCount} messages`,
		timestamp: s.lastActivity || s.createdAt,
		active: s.file === activeSessionFile,
		folder: s.cwd,
		pinned: s.pinned,
		titleLocked: s.titleLocked,
	}));

	return (
		<div className="flex h-screen md:gap-2.5 md:p-2.5" style={{ zoom: fontScale }}>
			{/* Extension UI dialogs (pi-ask-user etc. via ctx.ui) */}
			<ExtensionUiHost />

			{/* Delete chat confirmation */}
			<ConfirmDialog
				open={pendingDelete !== null}
				onClose={() => setPendingDelete(null)}
				onConfirm={handleConfirmDelete}
				title="Delete chat?"
				description={
					<>
						<span className="text-foreground font-medium">“{pendingDelete?.title}”</span> will be
						permanently removed. This can’t be undone.
					</>
				}
				confirmLabel="Delete"
				cancelLabel="Cancel"
				variant="destructive"
			/>

			{/* Telemetry consent dialog (overlays everything on first launch) */}
			{showTelemetryConsent && (
				<TelemetryConsentDialog
					onEnable={() => {
						telemetry.enable();
						trackEvent("app_launch");
						setShowTelemetryConsent(false);
					}}
					onDismiss={() => {
						telemetry.disable();
						setShowTelemetryConsent(false);
					}}
				/>
			)}

			{/* Sidebar — desktop: visible, mobile: slide-over */}
			{!hideChrome && (
				<>
					{/* Desktop sidebar — floating glass panel */}
					<div className="hidden md:block panel-sidebar overflow-hidden shrink-0">
						<Sidebar
							view={sidebarView}
							sessions={sidebarSessions}
							activeSessionId={activeSessionFile || undefined}
							onSessionSelect={(id) => {
								setSidebarView("chats");
								handleSessionSelect(id);
								setMobileMenuOpen(false);
							}}
							onNewSession={() => {
								setSidebarView("chats");
								handleNewSessionPrompt();
							}}
							homeDir={homeDir ?? undefined}
							onDeleteSession={handleDeleteSession}
							onRenameSession={handleRenameSession}
							onPinSession={handlePinSession}
							onDeepSearch={handleDeepSearch}
							onChangeView={(view) => {
								setSidebarView(view);
								if (view === "settings") {
									setShowSettings(true);
								} else {
									setShowSettings(false);
								}
							}}
							onUseTemplate={handleUseTemplate}
						/>
					</div>

					{/* Mobile sidebar (slide-over) */}
					<div
						className={`md:hidden fixed inset-0 z-50 transition-opacity duration-200 ${
							mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
						}`}
					>
						{/* Backdrop */}
						<div
							className="absolute inset-0 bg-black/50"
							role="presentation"
							onClick={() => setMobileMenuOpen(false)}
							onKeyDown={(e) => {
								if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
									setMobileMenuOpen(false);
								}
							}}
						/>
						{/* Sidebar panel */}
						<div
							className={`relative w-64 h-full bg-sidebar border-r border-sidebar-border transition-transform duration-200 ${
								mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
							}`}
						>
							<Sidebar
								view={sidebarView}
								sessions={sidebarSessions}
								activeSessionId={activeSessionFile || undefined}
								onSessionSelect={(id) => {
									setSidebarView("chats");
									handleSessionSelect(id);
									setMobileMenuOpen(false);
								}}
								onNewSession={() => {
									setSidebarView("chats");
									handleNewSessionPrompt();
								}}
								homeDir={homeDir ?? undefined}
								onDeleteSession={handleDeleteSession}
								onRenameSession={handleRenameSession}
								onPinSession={handlePinSession}
								onDeepSearch={handleDeepSearch}
								onChangeView={(view) => {
									setSidebarView(view);
									if (view === "settings") {
										setShowSettings(true);
									} else {
										setShowSettings(false);
									}
								}}
								onUseTemplate={handleUseTemplate}
							/>
						</div>
					</div>
				</>
			)}

			{/* Main content — raised glass panel */}
			<div className="relative flex-1 flex flex-col min-w-0 md:panel-raised md:overflow-hidden">
				{/* In-app update banner (issue #271) */}
				<UpdateBanner update={appUpdate} />

				{/* Remote connection status (browser mode only) */}
				<RemoteConnectionBar />

				{/* Mobile top bar */}
				{!hideChrome && (
					<MobileTopBar
						title="Zosma Cowork"
						subtitle={
							activeModelId ? (findModel(models, activeModelId)?.name ?? activeModelId) : undefined
						}
						open={mobileMenuOpen}
						onToggle={() => setMobileMenuOpen((prev) => !prev)}
						onSettings={() => {
							setSidebarView("settings");
							setShowSettings(true);
							setMobileMenuOpen(false);
						}}
					/>
				)}

				{/* Floating action overlay — no layout cost */}
				{!hideChrome && (
					<div className="hidden md:flex items-center gap-2 absolute top-2 right-3 z-10">
						<ChatWidthToggle />
						<ShareExport messages={displayMessages} />
					</div>
				)}

				{/* Content with view transition key */}
				<main className="flex-1 flex flex-col min-h-0 overflow-hidden">
					<div
						key={
							initializing
								? "splash"
								: showConnectModal
									? "connect"
									: showSettings
										? "settings"
										: loadingSession
											? "loading"
											: "chat"
						}
						className="flex-1 flex flex-col min-h-0 animate-fade-in"
					>
						{initializing ? (
							<SplashScreen />
						) : showConnectModal ? (
							<HomeView
								onComplete={handleConnectComplete}
								onSkipToSettings={handleSkipToSettings}
								onDismiss={handleDismissConnect}
								hasSubscription={hasSubscription}
							/>
						) : showSettings ? (
							<SettingsPage
								onClose={() => {
									setShowSettings(false);
									setSidebarView("chats");
								}}
								onShowKeyEntry={() => setShowKeyEntry(true)}
								telemetryEnabled={telemetry.isEnabled}
								onTelemetryToggle={(enabled) => {
									if (enabled) telemetry.enable();
									else telemetry.disable();
								}}
								fontScale={fontScale}
								onFontScaleChange={setFontScale}
							/>
						) : loadingSession ? (
							<div className="flex-1 flex flex-col items-center justify-center gap-4">
								<div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
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
								/* Issue #201, PR 2 — mid-turn message queuing. */
								onSteer={steerStream}
								onFollowUp={followUpStream}
								/* Issue #201, PR 3 — queue visibility + editing. */
								queue={streamState.queue}
								onEditQueue={handleEditQueue}
								/* #268 — always-on status line telemetry + reasoning. */
								sessionStats={sessionStats}
								thinking={thinking}
								onCycleThinking={cycleThinking}
								sessionKey={activeSessionFile ?? "new"}
								onRetry={() => {
									const lastUser = [...displayMessages].reverse().find((m) => m.role === "user");
									if (lastUser?.content) handleSend(lastUser.content);
								}}
								models={models}
								currentModelId={activeModelId}
								onModelSelect={handleModelSelect}
								toolPhase={toolPhase}
								draft={composerDraft}
								commands={BUILTIN_COMMANDS}
								onRunCommand={handleRunCommand}
							/>
						)}
					</div>
				</main>

				{/* Mobile bottom nav */}
				{!hideChrome && (
					<MobileBottomNav
						view={sidebarView}
						onChangeView={(view) => {
							setSidebarView(view);
							if (view === "settings") {
								setShowSettings(true);
							} else {
								setShowSettings(false);
							}
						}}
					/>
				)}
			</div>
		</div>
	);
}

export default App;
