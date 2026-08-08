/**
 * Zosma Content CoWork — Agent Sidecar Entry Point
 *
 * A thin Node.js process that runs pi-mono's agent SDK programmatically.
 * Communicates with the Tauri Rust backend via stdin/stdout JSON lines.
 *
 * Protocol:
 *   Stdin (commands):  {"type":"<cmd>", ...}
 *   Stdout (events):   {"type":"event", "sessionFile":..., "event":<AgentSessionEvent>}
 *                      {"type":"result", "id":"...", "sessionFile":..., "data":<value>}
 *                      {"type":"done", "id":"...", "sessionFile":...}
 *                      {"type":"error", "id":"...", "sessionFile":..., "code":...}
 *
 * Architecture: this file is the orchestration layer — it owns a
 * SessionRuntimeManager (canonical-session-file → isolated runtime), wires
 * the stdin readline loop, and delegates handles to modules under `commands/`.
 */

// ── Core SDK imports ───────────────────────────────────────────────────────
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	AuthStorage,
	ModelRegistry,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

// ── Cowork utilities ───────────────────────────────────────────────────────
import { send, log, logWarn, logError } from "./protocol.js";
import { registerGeminiAntigravity } from "./gemini-antigravity/index.js";
import { activateBundledBinaries } from "./bundled-binaries.js";
import { readPiPackages } from "./disk-extension-loader.js";
import { applyBundledNpm } from "./extension-manager.js";
import { migrateLegacyTokens, defaultGooglePaths } from "./google-auth/broker.js";
import { resolveUiResponse } from "./extension-ui-bridge.js";
import { createHandler, type HandlerDependencies } from "./commands/handler-registry.js";
import type { Command } from "./commands/types.js";
import { makeSessionError, makeSessionDone } from "./session-protocol.js";
import { snapshotRuntime, SessionRuntimeManager } from "./session-runtime-manager.js";
import { createPiRuntimeFactory } from "./session-runtime-factory.js";

// ── Agent init helpers (pure) ──────────────────────────────────────────────
import {
	defaultZosmaDir,
	piAgentDir,
	resolveWorkspace,
	ensureDir,
	cleanStaleLocks,
	defaultWorkspaceDir,
	PROVIDER_REQUEST_TIMEOUT_MS,
} from "./agent-init.js";

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
	log("Sidecar starting (pid=%s)", process.pid);

	// Register Gemini OAuth provider before any auth command
	registerGeminiAntigravity();

	// ── State ──────────────────────────────────────────────────────────
	let zosmaDir = defaultZosmaDir();

	// OAuth state
	let oauthAbort: AbortController | null = null;
	let oauthInflight: Promise<void> | null = null;
	let googleConsentAbort: AbortController | null = null;

	// Shared agent infrastructure (created on first init)
	let authStorage: AuthStorage | undefined;
	let modelRegistry: ModelRegistry | undefined;
	let settingsManager: SettingsManager | undefined;
	let runtimeManager: SessionRuntimeManager | undefined;
	let initialized = false;

	/** Local helper: emit a ready payload from the current model catalog.
	 * `session` is only set on FIRST initialization — in-process auth/resource
	 * refreshes keep existing runtime identities and never replace the session. */
	async function emitReady(
		opts: { session?: ReturnType<typeof snapshotRuntime>; defaultWorkspace?: string } = {},
	) {
		const available = modelRegistry!.getAvailable();
		const models = available.map((m: { id: string; name: string; provider: string; reasoning?: unknown; contextWindow?: number; maxTokens?: number }) => ({
			id: m.id,
			name: m.name,
			provider: m.provider,
			reasoning: m.reasoning,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
		}));
		const providerMap = new Map<string, { id: string; modelCount: number }>();
		for (const m of available) {
			const p = m.provider;
			const existing = providerMap.get(p) ?? { id: p, modelCount: 0 };
			existing.modelCount++;
			providerMap.set(p, existing);
		}
		const activeSession = opts.session;
		send({
			type: "ready",
			models,
			providers: Array.from(providerMap.values()),
			session: activeSession,
			defaultWorkspace: opts.defaultWorkspace ?? defaultWorkspaceDir(zosmaDir),
			activeModel: activeSession?.model
				? { provider: activeSession.model.provider, id: activeSession.model.id, name: activeSession.model.name }
				: null,
			thinkingLevel: null,
		});
		log("Sidecar ready — %d models available", models.length);
	}

	// ── initAgent orchestration ────────────────────────────────────────
	// First call does full first initialization (creates shared infra + the
	// initial runtime). Subsequent calls are in-process auth/settings/resource
	// refreshes: they keep the same runtime manager and session identities so
	// App can keep targeting the same files. They never dispose runtimes.
	async function initAgent(zosmaDirPath: string, workspace?: string) {
		zosmaDir = zosmaDirPath || defaultZosmaDir();
		activateBundledBinaries();

		if (runtimeManager && authStorage && modelRegistry && settingsManager) {
			// In-process refresh — preserve runtimes and identities.
			modelRegistry.refresh();
			const piPackages = readPiPackages(piAgentDir());
			settingsManager.setPackages(piPackages);
			applyBundledNpm(settingsManager);
			await runtimeManager.reloadAll();
			await emitReady();
			return;
		}

		if (workspace !== undefined) {
			log("Workspace cwd from init: %s", resolveWorkspace(workspace, zosmaDir));
		}
		const workspaceCwd = resolveWorkspace(workspace, zosmaDir);
		log("Workspace cwd: %s", workspaceCwd);

		const piDir = piAgentDir();
		ensureDir(piDir);
		const authPath = join(piDir, "auth.json");
		const modelsPath = join(piDir, "models.json");
		cleanStaleLocks(piDir);

		const migration = migrateLegacyTokens(defaultGooglePaths(piDir));
		if (migration.migrated) log("Migrated legacy Google tokens from %s", migration.from);

		authStorage = AuthStorage.create(authPath);
		modelRegistry = ModelRegistry.create(authStorage, modelsPath);

		settingsManager = SettingsManager.inMemory({
			retry: { provider: { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS, maxRetries: 3 } },
		});
		const piPackages = readPiPackages(piDir);
		if (piPackages.length > 0) settingsManager.setPackages(piPackages);

		applyBundledNpm(settingsManager);

		runtimeManager = new SessionRuntimeManager(
			createPiRuntimeFactory({
				zosmaDir,
				authStorage,
				modelRegistry,
				settingsManager,
			}),
		);

		// Create one initial runtime for the default workspace so the first
		// ready payload carries a real, persisted session identity.
		const initialRuntime = await runtimeManager.create(workspaceCwd);

		initialized = true;

		await emitReady({
			session: snapshotRuntime(initialRuntime),
			defaultWorkspace: defaultWorkspaceDir(zosmaDir),
		});
		log("Sidecar ready — initial runtime %s", initialRuntime.sessionFile);
	}

	// ── Build handler deps ─────────────────────────────────────────────
	const deps: HandlerDependencies = {
		get initialized() { return initialized; },
		get modelRegistry() { return modelRegistry!; },
		get authStorage() { return authStorage; },
		get settingsManager() { return settingsManager; },
		get runtimeManager() {
			if (!runtimeManager) throw new Error("Runtime manager not initialized");
			return runtimeManager;
		},
		get zosmaDir() { return zosmaDir; },
		get oauthAbort() { return oauthAbort; },
		get oauthInflight() { return oauthInflight; },
		get googleConsentAbort() { return googleConsentAbort; },
		initAgent,
		resolveUiResponse,
		setInitialized: (v: boolean) => { initialized = v; },
		setOauthAbort: (ac: AbortController | null) => { oauthAbort = ac; },
		setOauthInflight: (p: Promise<void> | null) => { oauthInflight = p; },
		setGoogleConsentAbort: (ac: AbortController | null) => { googleConsentAbort = ac; },
	};

	const handleCommand = createHandler(deps);

	// ── Stdin readline loop ────────────────────────────────────────────
	const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

	for await (const line of rl) {
		if (!line.trim()) continue;

		let cmd: Command;
		try {
			cmd = JSON.parse(line);
		} catch {
			logWarn("Invalid JSON: %s", line.slice(0, 100));
			continue;
		}

		try {
			await handleCommand(cmd);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const sessionFile = "sessionFile" in cmd && cmd.sessionFile ? (cmd as any).sessionFile : undefined;
			logError("command error (type=%s): %s", "type" in cmd ? cmd.type : "?", message);
			if (sessionFile) {
				send(makeSessionError("id" in cmd ? cmd.id : "unknown", sessionFile, {
					code: "provider_error",
					message,
					retryable: true,
				}));
				// A failed prompt must still terminate its pending relay channel.
				if (cmd.type === "prompt") {
					send(makeSessionDone((cmd as any).id, sessionFile));
				}
			} else {
				send({ type: "error", id: "id" in cmd ? cmd.id : "unknown", message });
			}
		}
	}

	log("Sidecar shutting down (stdin closed)");
	await runtimeManager?.disposeAll();
	process.exit(0);
}

main().catch((err) => {
	log("Fatal: %s", err instanceof Error ? err.message : String(err));
	process.exit(1);
});