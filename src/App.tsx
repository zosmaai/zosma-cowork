import { ChatView } from "@/chat/ChatView";
import { log } from "./lib/log";
import { HelpDialog } from "@/components/HelpDialog";
import { HomeView } from "@/components/HomeView";
import { ZosmaRouterAnnouncement } from "@/components/ZosmaRouterAnnouncement";
import { SettingsPage } from "@/components/SettingsPage";
import { Sidebar } from "@/components/Sidebar";
import { SplashScreen } from "@/components/SplashScreen";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { useUpdate } from "@/contexts/UpdateProvider";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useZosmaAuth } from "@/hooks/useZosmaAuth";
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
import { fontScaleClass, getFontScale } from "@/lib/font-scale";
import { trackEvent } from "@/lib/telemetry";
import type { SessionMode, SessionSnapshot, SidecarReadyPayload } from "@/types/session-runtime";
import type { Command } from "@/types/commands";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react";

type OpenDrawer = null | "sidebar" | "work-panel";

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
	/** Durable Chat/Work product mode for this session. */
	mode?: SessionMode;
}

function App() {
	const appUpdate = useUpdate();

	// Session management (declared BEFORE usePiStream so the hook can borrow
	// the active file; hook order stays unconditional across renders).
	const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([]);
	// Show only the active folder's sessions (pi-style) by default; toggle to all.
	const [allFolders, setAllFolders] = useState(false);
	const [activeSessionFile, setActiveSessionFile] = useState<string | null>(null);

	const {
		state: streamState,
		states: streamStates,
		getSessionState,
		hydrateSession,
		ensureSession,
		startStream,
		abortStream,
		steerStream,
		followUpStream,
		clearQueue,
		setSessionModel,
		setSessionMode,
		removeSession,
	} = usePiStream(activeSessionFile);

	// Custom instructions are no longer prepended to messages here. They live in
	// INSTRUCTIONS.md and the sidecar injects them into the system prompt as
	// always-on context (see CustomInstructions / save_instructions).

	const { models } = useProviders();
	useTelemetry(); // initialize telemetry consent from settings
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
	const zosmaEnabled = import.meta.env.VITE_ZOSMA_AUTH_ENABLED !== "false";

	// Onboarding status: explicit, non-secret classification for startup routing.
	const {
		status: onboardingStatus,
		loading: onboardingLoading,
		refresh: refreshOnboardingStatus,
	} = useOnboardingStatus();
	const isNewUser = onboardingStatus?.hasExistingSetup === false;
	// Announcement: show only for existing users without Zosma, and only once per version.
	const ZOSMA_ROUTER_ANNOUNCEMENT_KEY = "zosma-router-announcement-v1";
	const [announcementDismissed, setAnnouncementDismissed] = useState(() => {
		try {
			return localStorage.getItem(ZOSMA_ROUTER_ANNOUNCEMENT_KEY) === "1";
		} catch {
			return false;
		}
	});
	const showRouterAnnouncement =
		zosmaEnabled &&
		isNewUser === false &&
		onboardingStatus?.hasExistingSetup === true &&
		onboardingStatus.zosmaConnected === false &&
		!announcementDismissed;

	// Zosma auth for the announcement modal (single transaction, no duplication).
	const handleAnnouncementComplete = useCallback(() => {
		// Status refresh closes announcement only after sidecar persisted Zosma.
		void refreshOnboardingStatus();
	}, [refreshOnboardingStatus]);
	const announcementAuth = useZosmaAuth({ onComplete: handleAnnouncementComplete });
	const [, setSidebarView] = useState("chats");
	// Manual sidebar rail collapse (Phase 2). Default stays expanded.
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [openDrawer, setOpenDrawer] = useState<OpenDrawer>(null);
	const sidebarDrawerTriggerRef = useRef<HTMLButtonElement>(null);
	const workPanelTriggerRef = useRef<HTMLButtonElement>(null);
	const closeDrawer = useCallback(() => {
		const trigger = openDrawer === "sidebar" ? sidebarDrawerTriggerRef : workPanelTriggerRef;
		setOpenDrawer(null);
		queueMicrotask(() => trigger.current?.focus());
	}, [openDrawer]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: close overlays on session identity change
	useEffect(() => {
		setOpenDrawer(null);
	}, [activeSessionFile]);

	useEffect(() => {
		if (!openDrawer) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeDrawer();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [openDrawer, closeDrawer]);
	// Persisted font scaling (zoom preset) restored once at startup.
	const [fontScale] = useState(getFontScale);
	const handleChangeView = useCallback((view: string) => {
		setSidebarView(view);
		setShowSettings(view === "settings");
	}, []);
	const [showSettings, setShowSettings] = useState(false);
	const [showModelSelector, setShowModelSelector] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	// True iff at least one subscription (OAuth) provider is signed in.
	// Drives the "Skip" → "Continue" label flip on the Connect modal —
	// note this is *narrower* than `hasCredentials`, which is true for any
	// API-key save too.
	const [hasSubscription, setHasSubscription] = useState(false);

	// Draft prompt pushed into the composer (e.g. when a template is clicked).
	// The bumping `nonce` lets the same prompt be re-applied on repeated clicks.
	// Targetted per-session so a starter on session A never bleeds into B.
	interface ComposerDraft {
		sessionFile: string;
		text: string;
		nonce: number;
	}

	const [composerDraft, setComposerDraft] = useState<ComposerDraft>();
	const draftSessionKey = activeSessionFile ?? "__new__";

	// Durable Chat/Work mode. Loaded sessions derive it from keyed state; an
	// unbound choice (before a canonical snapshot exists) lives only until the
	// new_session snapshot returns canonical identity.
	const [unboundMode, setUnboundMode] = useState<SessionMode>("chat");
	const activeMode: SessionMode = activeSessionFile ? streamState.mode : unboundMode;
	const selectedModeRef = useRef<SessionMode>(activeMode);
	useEffect(() => {
		selectedModeRef.current = activeMode;
	}, [activeMode]);
	const isEmptySession =
		streamState.messages.length === 0 &&
		streamState.streamingMessage === null &&
		!streamState.isRunning;
	const [firstSendPending, setFirstSendPending] = useState(false);
	const modeLocked = !isEmptySession || firstSendPending;
	const [modeError, setModeError] = useState<string | null>(null);
	// Clear the mode error when entering a different session.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on session switch (value not read in body)
	useEffect(() => {
		setModeError(null);
	}, [activeSessionFile]);

	// Default the sidebar rail per entered view: empty Chat collapses, empty
	// Work and every active transcript expand. A manual expand/collapse does
	// not retrigger until the user enters a different session/mode/empty state.
	// No active session (splash/onboarding) has no sidebar view to default.
	useEffect(() => {
		if (!activeSessionFile) return;
		setSidebarCollapsed(isEmptySession && activeMode === "chat");
	}, [activeSessionFile, activeMode, isEmptySession]);
	// The agent's current workspace folder (where file/bash tools read & write).
	// The agent's current workspace folder (where file/bash tools read & write).
	// Derived from the ACTIVE cached session — each runtime owns its cwd.
	const workspaceCwd = streamState.cwd;
	// The user's home dir (sidecar's default workspace) — used to label the
	// "Home" folder group in the sidebar.
	const [homeDir, setHomeDir] = useState<string | null>(null);

	// ── Cache a sidecar snapshot into the keyed stream map ──
	const cacheSnapshot = useCallback(
		(snapshot: SessionSnapshot) => {
			hydrateSession(snapshot);
		},
		[hydrateSession],
	);

	// Cache AND switch the active render key to that session.
	const activateSnapshot = useCallback(
		(snapshot: SessionSnapshot) => {
			cacheSnapshot(snapshot);
			setActiveSessionFile(snapshot.sessionFile);
		},
		[cacheSnapshot],
	);

	// ── Sidecar readiness: drives the startup splash (#169) ──
	// Listen for the Tauri `ready` event (carrying the initial session
	// snapshot), plus a timeout fallback so the splash never hangs forever.
	useEffect(() => {
		if (!isTauri()) return;
		let mounted = true;
		let unlisten: (() => void) | undefined;
		(async () => {
			const u = await listen<SidecarReadyPayload | null>("ready", (evt) => {
				if (!mounted) return;
				setSidecarReady(true);
				const payload = evt.payload;
				if (!payload) return;
				// 1. Always apply the default workspace when present.
				if (typeof payload.defaultWorkspace === "string") {
					setHomeDir(payload.defaultWorkspace);
				}
				// 2. Ignore the spawn-level ready payload with no session.
				if (!payload.session) return;
				// 3. Fresh startup: adopt the initial runtime's snapshot.
				// 4. After a sidecar restart the cache stays visible; selecting or
				//    sending lazily reloads the runtime through ensureSession.
				if (activeSessionFileRef.current === null) {
					activateSnapshot(payload.session);
				}
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
	}, [activateSnapshot]);

	// Latest active file for the ready listener (avoids stale closures).
	const activeSessionFileRef = useRef(activeSessionFile);
	useEffect(() => {
		activeSessionFileRef.current = activeSessionFile;
	}, [activeSessionFile]);

	const needsOnboarding = authLoading === false && !hasCredentials;

	// Startup routing based on explicit onboarding status.
	const onboardingReady = !onboardingLoading && onboardingStatus !== null;
	const showNewUserConnect = onboardingReady && isNewUser && !skipOnboarding && !showKeyEntry;
	const telemetryUndecided = false;
	// Never render ChatView while startup classification is unresolved. Fresh
	// installs are classified from disk without waiting for Pi; existing users
	// remain on splash until sidecar status and models are ready.
	const waitingForStartupClassification = !onboardingReady;
	const initializing =
		!showNewUserConnect &&
		!showKeyEntry &&
		(telemetryUndecided ||
			waitingForStartupClassification ||
			(!sidecarReady && (authLoading || hasCredentials !== true)));

	// Whether to render the legacy Connect / API-key modal. It remains reachable
	// from Settings, but is not part of Zosma first-run onboarding.
	const showConnectModal = (!zosmaEnabled && needsOnboarding && !skipOnboarding) || showKeyEntry;

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
					log.debug("[settings] loaded:", data);
				} catch (err) {
					log.warn("[settings] load failed:", err);
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
						log.debug("[settings] restoring model:", match.provider, match.id);
						setActiveModelId(modelKey(match.provider, match.id));
						// Wait for an active session before pushing the model to it.
						void applyDefaultModelWhenReady(match.provider, match.id);
						return;
					}
				}

				// 2. No saved preference: MIRROR the engine's actual model so the
				//    selector matches the model that will really answer.
				try {
					const sid = activeSessionFileRef.current;
					if (!sid) return;
					const engine = (await invoke("get_active_model", { sessionFile: sid })) as {
						model?: { provider?: string; id?: string };
					} | null;
					const modelInfo = engine?.model;
					const key = modelInfo?.id ? modelKey(modelInfo.provider, modelInfo.id) : undefined;
					if (key && findModel(models, key)) {
						log.debug("[settings] mirroring engine model:", key);
						setActiveModelId(key);
						return;
					}
				} catch (err) {
					log.warn("[settings] get_active_model failed:", err);
				}

				// 3. Last resort: pick the first model.
				const fallback = models[0];
				setActiveModelId(modelKey(fallback.provider, fallback.id));
			})();
		} else if (models.length > 0 && !activeModelId) {
			setActiveModelId(modelKey(models[0].provider, models[0].id));
		}
	}, [models, activeModelId]);

	// Push the default model onto the exact session once one exists.
	const applyDefaultModelWhenReady = useCallback(
		async (provider: string, modelId: string) => {
			const sid = activeSessionFileRef.current;
			if (!sid) {
				// Retry on the next tick; the ready snapshot lands quickly.
				setTimeout(() => void applyDefaultModelWhenReady(provider, modelId), 100);
				return;
			}
			try {
				await invoke("set_active_model", { sessionFile: sid, provider, model: modelId });
				setSessionModel(sid, { provider, id: modelId });
			} catch (err) {
				log.warn("[settings] set_active_model failed:", err);
			}
		},
		[setSessionModel],
	);

	useEffect(() => {
		if (needsOnboarding || showKeyEntry) return;
		// Initial load (also re-runs when onboarding/key-entry clears).
		loadSessionList().catch(() => {});
		if (!isTauri()) return;
		// The first load races the sidecar spawn: `list_sessions` rejects before
		// the sidecar is ready and the `.catch` swallows it, leaving an empty
		// list that never refills. Re-load on every `ready` event — the initial
		// spawn AND every restart after `sidecar_lost` — so saved sessions
		// reappear instead of silently vanishing.
		let mounted = true;
		let unlisten: (() => void) | undefined;
		listen("ready", () => loadSessionList().catch(() => {})).then((u) => {
			if (!mounted) {
				u();
				return;
			}
			unlisten = u;
		});
		return () => {
			mounted = false;
			unlisten?.();
		};
	}, [needsOnboarding, showKeyEntry]);

	// A successful OAuth sign-in should dismiss the Connect modal even
	// when it was opened via "Change API Key" (where `hasCredentials` was
	// already true and so `needsOnboarding` never flips). We listen for
	// the Tauri `oauth_completed` event specifically — NOT `config-reload`,
	// because the latter also fires on sign-out/key-remove and would
	// otherwise wrongly dump a just-signed-out user back into chat with
	// no credentials.
	useEffect(() => {
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
		const request = ++sessionListRequestRef.current;
		try {
			const result = await invoke("list_sessions", {
				allFolders,
				cwd: workspaceCwd ?? undefined,
			});
			if (request !== sessionListRequestRef.current) return;
			const data = result as { sessions?: SessionEntry[] };
			setSessionEntries((current) => {
				const disk = data.sessions || [];
				const currentByFile = new Map(current.map((entry) => [entry.file, entry]));
				const diskFiles = new Set(disk.map((entry) => entry.file));
				const reconciled = disk.map((entry) => {
					const live = streamStatesRef.current.get(entry.file);
					const optimistic = currentByFile.get(entry.file);
					return live?.isRunning && optimistic
						? { ...entry, ...optimistic, pinned: entry.pinned, titleLocked: entry.titleLocked }
						: entry;
				});
				for (const entry of current) {
					if (!diskFiles.has(entry.file) && streamStatesRef.current.get(entry.file)?.isRunning) {
						reconciled.push(entry);
					}
				}
				return reconciled;
			});
		} catch (err) {
			log.error("Failed to load sessions:", err);
		}
	}

	// Reconcile live cache keys with disk metadata. `streamStatesRef` is always
	// current synchronously; the plain `streamStates` effect keeps it in sync.
	const streamStatesRef = useRef(streamStates);
	const sessionListRequestRef = useRef(0);
	useEffect(() => {
		streamStatesRef.current = streamStates;
	}, [streamStates]);
	const previousSettledRef = useRef(new Map<string, number>());

	// Re-list when the active folder switches (new_session / load_session pick a
	// different cwd) or the all-folders toggle flips.
	// biome-ignore lint/correctness/useExhaustiveDependencies: loadSessionList is a stable component-scope reconcile helper
	useEffect(() => {
		loadSessionList().catch(() => {});
	}, [workspaceCwd, allFolders]);

	// ── Reconcile sidebar metadata on every terminal `done` ──
	// Keyed on `streamStates` + a per-key monotonic `settledVersion` (the
	// done latch). Hidden sessions — not just the active one — get their row
	// metadata updated here, and a refresh pulls disk truth after pi persists.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reconcile every keyed done
	useEffect(() => {
		let settled = false;
		for (const [sessionFile, state] of streamStates) {
			const previous = previousSettledRef.current.get(sessionFile) ?? 0;
			previousSettledRef.current.set(sessionFile, state.settledVersion);
			if (state.settledVersion <= previous) continue;
			settled = true;
			const latest = state.messages.at(-1);
			setSessionEntries((entries) =>
				entries.map((entry) =>
					entry.file === sessionFile
						? {
								...entry,
								messageCount: state.messages.length,
								lastActivity: Date.now(),
								preview:
									typeof latest?.content === "string"
										? latest.content.replace(/\s+/g, " ").trim().slice(0, 120)
										: entry.preview,
							}
						: entry,
				),
			);
		}
		if (settled) {
			loadSessionList().catch((error) => log.error("Failed to refresh sessions:", error));
		}
	}, [streamStates]);

	const handleModeChange = useCallback(
		async (mode: SessionMode) => {
			if (modeLocked) return;
			// Synchronous ref closes the click→immediate-Enter gap before the keyed
			// reducer rerender lands. First send always uses the visibly chosen mode.
			selectedModeRef.current = mode;
			setModeError(null);
			if (!activeSessionFile) {
				setUnboundMode(mode);
				return;
			}
			try {
				await setSessionMode(activeSessionFile, mode);
			} catch (error) {
				log.error("[cowork] set_session_mode failed:", error);
				setModeError("Couldn’t save this session’s mode. Try again.");
			}
		},
		[activeSessionFile, modeLocked, setSessionMode],
	);

	// ── Send a new prompt ──
	// The visible model is the ACTIVE session's runtime model when known;
	// otherwise fall back to the saved default for future sessions.
	const sessionModelId = streamState.model?.id
		? modelKey(streamState.model.provider, streamState.model.id)
		: undefined;
	const visibleModelId = sessionModelId ?? activeModelId;

	const handleSend = useCallback(
		async (text: string) => {
			const selectedMode = selectedModeRef.current;
			let sessionFile = activeSessionFile;
			const isNewSession = !sessionFile;
			if (!sessionFile) {
				// No ready snapshot was adopted yet — ask the sidecar for a real
				// persisted session and require a full snapshot. Never invent a
				// client-side fallback identity.
				try {
					const snapshot = (await invoke("new_session", {})) as SessionSnapshot | null;
					if (!snapshot?.sessionFile) {
						log.error("[cowork] new_session returned no session file");
						return;
					}
					activateSnapshot(snapshot);
					sessionFile = snapshot.sessionFile;
				} catch (err) {
					log.error("[cowork] new_session failed:", err);
					return;
				}
			}

			// Lock tabs + composer if this is the first prompt. Mode may change
			// while empty, then locks. Persist BEFORE the optimistic first message
			// (startStream) so optimistic insertion cannot race persistence.
			const firstPrompt = isNewSession || streamState.messages.length === 0;
			if (firstPrompt) {
				setFirstSendPending(true);
				setModeError(null);
				try {
					await setSessionMode(sessionFile, selectedMode);
				} catch (error) {
					log.error("[cowork] first-prompt mode save failed:", error);
					setModeError("Couldn’t save this session’s mode. Try again.");
					setFirstSendPending(false);
					return;
				}
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
						mode: selectedMode,
					},
					...prev,
				]);
				trackEvent("session_created");
			}

			// Track message with provider/model info
			const activeModel = findModel(models, visibleModelId);
			trackEvent("message_sent", {
				provider: activeModel?.provider?.split("-")[0] ?? "unknown",
				model: activeModel?.id ?? "unknown",
			});

			try {
				await startStream(sessionFile, text);
			} catch (error) {
				log.error("[cowork] first prompt failed before stream start:", error);
				setModeError("Couldn’t start this session. Try again.");
			} finally {
				if (firstPrompt) setFirstSendPending(false);
			}
		},
		[
			activeSessionFile,
			startStream,
			models,
			visibleModelId,
			workspaceCwd,
			activateSnapshot,
			setSessionMode,
			streamState.messages.length,
		],
	);

	/**
	 * Issue #201 PR 3 — Ctrl+↑ in the composer fires this. We atomically
	 * drain the SDK queue (so nothing fires while the user is editing) and
	 * load the drained messages into the composer via the existing
	 * `draft` channel.
	 */
	const handleEditQueue = useCallback(async () => {
		const sid = activeSessionFile;
		if (!sid) return;
		const drained = await clearQueue(sid);
		const all = [...drained.steering, ...drained.followUp];
		if (all.length === 0) return;
		const joined = all.join("\n\n");
		setComposerDraft((prev) => ({
			sessionFile: draftSessionKey,
			text: joined,
			nonce: (prev?.nonce ?? 0) + 1,
		}));
	}, [clearQueue, activeSessionFile, draftSessionKey]);

	const handleModelSelect = useCallback(
		async (provider: string, modelId: string) => {
			setActiveModelId(modelKey(provider, modelId));
			try {
				log.debug("[settings] saving model:", provider, modelId);
				await invoke("save_settings", {
					settings: {
						defaultModel: modelId,
						defaultProvider: provider,
					},
				});
				// Actually set the model on the exact active session.
				const sid = activeSessionFile;
				if (!sid) return;
				await invoke("set_active_model", { sessionFile: sid, provider, model: modelId });
				setSessionModel(sid, { provider, id: modelId });
			} catch (err) {
				log.warn("[settings] save failed:", err);
			}
		},
		[activeSessionFile, setSessionModel],
	);

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
	// returns a full snapshot — we cache it (cwd, model, messages) and switch
	// to it without ever inventing a fallback identity. Other sessions keep
	// running; no abort is sent.
	const handleNewSession = useCallback(
		async (cwd?: string) => {
			setOpenDrawer(null);
			let resolvedCwd: string | undefined;
			try {
				const snapshot = (await invoke<SessionSnapshot>(
					"new_session",
					cwd ? { cwd } : {},
				)) as SessionSnapshot | null;
				if (!snapshot?.sessionFile) {
					log.error("[cowork] new_session returned no session file");
					return undefined;
				}
				resolvedCwd = snapshot.cwd;
				activateSnapshot(snapshot);
				// Apply the user's selected model to THIS exact new session before
				// the first prompt.
				if (activeModelId) {
					const model = findModel(models, activeModelId);
					if (model) {
						try {
							await invoke("set_active_model", {
								sessionFile: snapshot.sessionFile,
								provider: model.provider,
								model: model.id,
							});
							setSessionModel(snapshot.sessionFile, {
								provider: model.provider,
								id: model.id,
							});
						} catch {
							// model push is best-effort
						}
					}
				}
				return resolvedCwd;
			} catch (err) {
				log.error("[cowork] new_session failed:", err);
				return undefined;
			}
		},
		[activateSnapshot, activeModelId, models, setSessionModel],
	);

	// "New session" ALWAYS asks for a folder first (native picker), then starts
	// a fresh session bound to it — the chosen directory becomes the agent's
	// working dir, so generated files land where the user expects (pi's "open
	// from any folder"). Cancelling the picker is a no-op: we never silently
	// create a session in an unintended folder, and the active session is left
	// untouched.
	const handleNewSessionPrompt = useCallback(async () => {
		setOpenDrawer(null);
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
				openModelSelector: () => setShowModelSelector(true),
				openSettings,
				showHelp: () => setShowHelp(true),
			};
			runBuiltinCommand(ctx, builtin, args);
		},
		[handleNewSessionPrompt],
	);

	const [pendingDelete, setPendingDelete] = useState<{
		file: string;
		title: string;
		running: boolean;
	} | null>(null);
	const [pendingRename, setPendingRename] = useState<{ file: string; title: string } | null>(null);

	const handleDeleteSession = useCallback(
		(file: string) => {
			setOpenDrawer(null);
			const entry = sessionEntries.find((s) => s.file === file);
			setPendingDelete({
				file,
				title: entry?.title ?? "this chat",
				running: getSessionState(file)?.isRunning === true,
			});
		},
		[sessionEntries, getSessionState],
	);

	const handleConfirmDelete = useCallback(async () => {
		if (!pendingDelete) return;
		const { file, running } = pendingDelete;
		// A running runtime must stop successfully before persistent deletion,
		// so no hidden work continues and the sidecar's running-delete guard is
		// never the fallback for the normal user path.
		if (running) {
			const stopped = await abortStream(file);
			if (!stopped) {
				log.error("Failed to stop running session; deletion cancelled");
				return;
			}
		}
		try {
			await invoke("delete_session", { sessionFile: file });
		} catch (error) {
			log.error("Failed to delete session:", error);
			return;
		}
		removeSession(file);
		setSessionEntries((prev) => prev.filter((s) => s.file !== file));
		if (activeSessionFile === file) setActiveSessionFile(null);
	}, [pendingDelete, abortStream, removeSession, activeSessionFile]);

	// Open the rename popup for a session (mirrors the delete confirm flow).
	const handleRequestRename = useCallback(
		(file: string) => {
			const entry = sessionEntries.find((s) => s.file === file);
			setPendingRename({ file, title: entry?.title ?? "" });
		},
		[sessionEntries],
	);

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
			log.error("Failed to rename session:", err);
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
			log.error("Failed to pin session:", err);
			loadSessionList().catch(() => {});
		}
	}, []);

	// ── Deep content search across all session bodies ──
	const handleDeepSearch = useCallback(
		async (query: string) => {
			try {
				const result = await invoke("search_sessions", {
					query,
					allFolders,
					cwd: workspaceCwd ?? undefined,
				});
				const data = result as {
					matches?: { file: string; snippet: string; matchCount: number }[];
				};
				return data.matches ?? [];
			} catch (err) {
				log.error("Deep search failed:", err);
				return [];
			}
		},
		[allFolders, workspaceCwd],
	);

	const handleSessionSelect = useCallback(
		(file: string) => {
			setOpenDrawer(null);
			if (file === activeSessionFile) return;
			// Switching only changes the active render key. Cached states (hidden
			// sessions) keep running independently; if the target was never
			// hydrated/loaded, lazily load its runtime WITHOUT aborting anything.
			setActiveSessionFile(file);
			const cached = getSessionState(file);
			if (!cached?.runtimeLoaded) {
				void ensureSession(file).catch((error) => {
					log.error("Failed to load session:", error);
				});
			}
		},
		[activeSessionFile, ensureSession, getSessionState],
	);

	const sidebarSessions = sessionEntries.map((s) => {
		const live = streamStates.get(s.file);
		const runtimeStatus: "idle" | "running" | "error" = live?.isRunning
			? "running"
			: live?.status === "error" || live?.error
				? "error"
				: "idle";
		return {
			id: s.file,
			title: s.title,
			// Prefer a real content preview; fall back to a count for empty sessions.
			lastMessage: s.preview?.trim() ? s.preview : `${s.messageCount} messages`,
			timestamp: s.lastActivity || s.createdAt,
			active: s.file === activeSessionFile,
			folder: s.cwd,
			pinned: s.pinned,
			titleLocked: s.titleLocked,
			mode: live?.mode ?? s.mode ?? "chat",
			runtimeStatus,
			runtimeError: live?.error ?? undefined,
		};
	});

	const sidebarProps: ComponentProps<typeof Sidebar> = {
		sessions: sidebarSessions,
		activeSessionId: activeSessionFile || undefined,
		onSessionSelect: (id) => {
			setSidebarView("chats");
			handleSessionSelect(id);
		},
		onNewSession: () => {
			setSidebarView("chats");
			void handleNewSession();
		},
		onOpenSession: () => {
			setSidebarView("chats");
			void handleNewSessionPrompt();
		},
		homeDir: homeDir ?? undefined,
		onDeleteSession: handleDeleteSession,
		onRequestRename: handleRequestRename,
		onPinSession: handlePinSession,
		onDeepSearch: handleDeepSearch,
		allFolders,
		onToggleAllFolders: () => setAllFolders((value) => !value),
		onChangeView: handleChangeView,
		collapsed: sidebarCollapsed,
		onCollapsedChange: setSidebarCollapsed,
	};
	const activeSessionTitle =
		sessionEntries.find((entry) => entry.file === activeSessionFile)?.title ?? "Untitled task";

	// Hide the app chrome (sidebar, mobile bars, share button) whenever the
	// main pane is showing a full-screen state: onboarding, settings, or the
	// startup loading splash (#169).
	const hideChrome =
		showNewUserConnect || showConnectModal || showSettings || initializing || models.length === 0;

	return (
		// The app is scaled with CSS `zoom` (font-size presets). Because `zoom`
		// multiplies the PAINTED size, the root height is zoom-COMPENSATED (100vh
		// divided by the scale) so it always paints as exactly one viewport —
		// otherwise Large/Extra-Large overflows <body>, and focus-scroll clips the
		// fixed sidebar top-chrome (the New-chat button) off the top. The per-preset
		<div className={`flex md:gap-2.5 md:p-2.5 ${fontScaleClass(fontScale)}`}>
			{/* Delete chat confirmation */}
			<ConfirmDialog
				open={pendingDelete !== null}
				onClose={() => setPendingDelete(null)}
				onConfirm={handleConfirmDelete}
				title={pendingDelete?.running ? "Stop and delete chat?" : "Delete chat?"}
				description={
					<>
						<span className="text-foreground font-medium">“{pendingDelete?.title}”</span>{" "}
						{pendingDelete?.running
							? "is still running. Current work will stop before this chat is permanently deleted. This can’t be undone."
							: "will be permanently removed. This can’t be undone."}
					</>
				}
				confirmLabel={pendingDelete?.running ? "Stop and delete" : "Delete"}
				cancelLabel="Cancel"
				variant="destructive"
			/>

			{/* Rename chat popup */}
			<RenameDialog
				open={pendingRename !== null}
				initialTitle={pendingRename?.title ?? ""}
				onClose={() => setPendingRename(null)}
				onSave={(title) => {
					if (pendingRename) handleRenameSession(pendingRename.file, title);
				}}
			/>

			<HelpDialog open={showHelp} commands={BUILTIN_COMMANDS} onClose={() => setShowHelp(false)} />

			{/* Zosma Router release announcement (existing users, no Zosma) */}
			{showRouterAnnouncement && (
				<ZosmaRouterAnnouncement
					open={true}
					phase={announcementAuth.phase}
					error={announcementAuth.error}
					onStartTrial={() => announcementAuth.start()}
					onCancelAuth={() => announcementAuth.cancel()}
					onDismiss={() => {
						try {
							localStorage.setItem(ZOSMA_ROUTER_ANNOUNCEMENT_KEY, "1");
						} catch {
							// non-critical
						}
						setAnnouncementDismissed(true);
					}}
				/>
			)}

			{/* Sidebar — desktop: visible, mobile: slide-over */}
			{!hideChrome && (
				<div
					className="hidden md:block panel-sidebar overflow-hidden shrink-0"
					inert={openDrawer === "work-panel" ? true : undefined}
				>
					<Sidebar {...sidebarProps} />
				</div>
			)}

			{/* Main content — raised glass panel */}
			<div className="session-work-container relative flex-1 flex flex-col min-w-0 md:panel-raised md:overflow-hidden">
				{/* In-app update banner (issue #271) */}
				<UpdateBanner update={appUpdate} />

				{/* Content with view transition key */}
				<main
					className="flex-1 flex flex-col min-h-0 overflow-hidden"
					inert={openDrawer === "sidebar" ? true : undefined}
				>
					<div
						key={
							initializing
								? "splash"
								: showNewUserConnect
									? "connect"
									: showConnectModal
										? "connect"
										: showSettings
											? "settings"
											: "chat"
						}
						className="flex-1 flex flex-col min-h-0 animate-fade-in"
					>
						{initializing ? (
							<SplashScreen />
						) : showNewUserConnect ? (
							<HomeView
								initialStep="connect"
								onComplete={handleConnectComplete}
								onSkipToSettings={handleSkipToSettings}
								onDismiss={handleDismissConnect}
								hasSubscription={hasSubscription}
								onZosmaComplete={() => {
									void refreshOnboardingStatus();
								}}
							/>
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
							/>
						) : models.length === 0 ? (
							<SplashScreen />
						) : streamState.loadStatus === "loading" && streamState.messages.length === 0 ? (
							<div className="flex-1 flex flex-col items-center justify-center gap-4">
								<div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
								<div className="text-sm text-muted-foreground">Loading session...</div>
							</div>
						) : (
							<ChatView
								sessionFile={activeSessionFile ?? ""}
								messages={streamState.messages}
								streamingMessage={streamState.streamingMessage}
								isRunning={streamState.isRunning}
								error={streamState.error}
								onSend={handleSend}
								onAbort={() => {
									if (activeSessionFile) void abortStream(activeSessionFile);
								}}
								/* Issue #201, PR 2 — mid-turn message queuing. */
								onSteer={(text) => {
									if (activeSessionFile) void steerStream(activeSessionFile, text);
								}}
								onFollowUp={(text) => {
									if (activeSessionFile) void followUpStream(activeSessionFile, text);
								}}
								/* Issue #201, PR 3 — queue visibility + editing. */
								queue={streamState.queue}
								onEditQueue={handleEditQueue}
								sessionKey={activeSessionFile ?? "new"}
								onRetry={() => {
									const lastUser = [...streamState.messages]
										.reverse()
										.find((m) => m.role === "user");
									if (lastUser?.content) handleSend(lastUser.content);
								}}
								models={models}
								currentModelId={visibleModelId}
								onModelSelect={handleModelSelect}
								modelSelectorOpen={showModelSelector}
								onModelSelectorOpenChange={setShowModelSelector}
								draft={composerDraft?.sessionFile === draftSessionKey ? composerDraft : undefined}
								commands={BUILTIN_COMMANDS}
								onRunCommand={handleRunCommand}
								mode={activeMode}
								modeChangeDisabled={firstSendPending}
								modeError={modeError}
								onModeChange={(mode) => void handleModeChange(mode)}
								workspaceCwd={workspaceCwd}
								taskTitle={activeSessionTitle}
								drawer={openDrawer}
								onDrawerChange={(drawer) =>
									drawer === null ? closeDrawer() : setOpenDrawer(drawer)
								}
								sidebarButtonRef={sidebarDrawerTriggerRef}
								panelButtonRef={workPanelTriggerRef}
								onStarterSelect={(text) => {
									setComposerDraft((previous) => ({
										sessionFile: draftSessionKey,
										text,
										nonce: (previous?.nonce ?? 0) + 1,
									}));
								}}
							/>
						)}
					</div>
				</main>
				{openDrawer === "sidebar" && (
					<div className="mobile-sidebar-layer md:hidden">
						<button
							type="button"
							className="drawer-backdrop"
							aria-label="Close session sidebar"
							onClick={closeDrawer}
						/>
						<div
							role="dialog"
							aria-modal="true"
							aria-label="Sessions"
							className="mobile-sidebar-drawer"
						>
							<Sidebar {...sidebarProps} collapsed={false} onCollapsedChange={closeDrawer} />
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export default App;
