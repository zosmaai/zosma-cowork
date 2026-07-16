/**
 * Zosma Content CoWork — Agent Sidecar Entry Point
 *
 * A thin Node.js process that runs pi-mono's agent SDK programmatically.
 * Communicates with the Tauri Rust backend via stdin/stdout JSON lines.
 *
 * Protocol:
 *   Stdin (commands):  {"type":"<cmd>", ...}
 *   Stdout (events):   {"type":"event", "event":<AgentSessionEvent>}
 *                      {"type":"result", "id":"...", "data":<value>}
 *                      {"type":"done", "id":"..."}
 *                      {"type":"error", "id":"...", "message":"..."}
 *
 * Architecture: this file is the orchestration layer — it creates the agent
 * session, wires pi-routines, subscribes to events, and runs the stdin
 * readline loop. All command handling is delegated to modules under
 * `commands/`, and pure utilities live in sibling modules.
 */

// ── Core SDK imports ───────────────────────────────────────────────────────
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	AuthStorage,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	createAgentSession,
} from "@earendil-works/pi-coding-agent";

// ── Cowork utilities ───────────────────────────────────────────────────────
import { send, log, logWarn, logError } from "./protocol.js";
import { registerGeminiAntigravity } from "./gemini-antigravity/index.js";
import { activateBundledBinaries } from "./bundled-binaries.js";
import { readPiPackages } from "./disk-extension-loader.js";
import { applyBundledNpm } from "./extension-manager.js";
import { migrateLegacyTokens, defaultGooglePaths } from "./google-auth/broker.js";
import { bindExtensionUi, resolveUiResponse } from "./extension-ui-bridge.js";
import { createPromptScheduler } from "./prompt-scheduler.js";
import { createHandler, type HandlerDependencies } from "./commands/handler-registry.js";
import type { Command } from "./commands/types.js";
import { subscribeSession } from "./prompt-runner.js";

// ── Agent init helpers (pure) ──────────────────────────────────────────────
import {
	defaultZosmaDir,
	zosmaAgentDir,
	piAgentDir,
	resolveWorkspace,
	ensureDir,
	cleanStaleLocks,
	buildResourceLoader,
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
	let workspaceCwd = resolveWorkspace(undefined, zosmaDir);
	let activePromptId: string | null = null;
	// Startup-watchdog tracking: prompt-runner.ts manages the module-level
	// currentPromptStartedAt / promptHasEmitted flags; we just use them.

	// Serialized prompt execution
	const promptScheduler = createPromptScheduler();

	// OAuth state
	let oauthAbort: AbortController | null = null;
	let oauthInflight: Promise<void> | null = null;
	let googleConsentAbort: AbortController | null = null;

	// Agent infrastructure (set during init)
	let authStorage: AuthStorage | undefined;
	let modelRegistry: ModelRegistry | undefined;
	let sessionManager: ReturnType<typeof SessionManager.inMemory> | undefined;
	let settingsManager: ReturnType<typeof SettingsManager.inMemory> | undefined;
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	let resourceLoader: Awaited<ReturnType<typeof buildResourceLoader>> | undefined;
	let initialized = false;

	// ── initAgent orchestration ────────────────────────────────────────
	async function initAgent(zosmaDirPath: string, workspace?: string) {
		zosmaDir = zosmaDirPath || defaultZosmaDir();
		activateBundledBinaries();

		if (workspace !== undefined) {
			workspaceCwd = resolveWorkspace(workspace, zosmaDir);
		}
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

		// Extensions install/resolve via npm. In production the bundled npm
		// needs a writable global prefix so `install -g` doesn't hit a root-owned
		// app dir. With SDK ≥0.80.7 user-scope installs go to ~/.pi/agent/npm
		// (pi's own managed prefix), so dev gets true pi parity without EACCES.
		applyBundledNpm(settingsManager);

		resourceLoader = await buildResourceLoader(workspaceCwd, zosmaDir, settingsManager);

		// Persist to ~/.pi/agent/sessions (pi-native) so sessions are listable
		// via SessionManager.listAll() — no bespoke ~/.zosmaai store anymore.
		sessionManager = SessionManager.create(workspaceCwd);
		const result = await createAgentSession({
			cwd: workspaceCwd,
			authStorage,
			modelRegistry,
			sessionManager,
			settingsManager,
			resourceLoader,
		});
		session = result.session;


		const coworkActivePath = join(workspaceCwd, ".pi", "cowork_active");
		try {
			writeFileSync(coworkActivePath, `${process.pid}`, "utf-8");
		} catch {
			// best-effort
		}

		// Subscribe to all agent events and forward to stdout
		// Uses ESM live binding: currentPromptStartedAt is set by runPromptTask
		// in prompt-runner.ts, and we read its live value on every event.
		subscribeSession(session);

		// Bind extension UI bridge
		await bindExtensionUi(session);

		initialized = true;

		// Report available models
		const available = await modelRegistry.getAvailable();
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

		send({
			type: "ready",
			models,
			providers: Array.from(providerMap.values()),
			activeModel: session?.model
				? { provider: session.model.provider, id: session.model.id, name: session.model.name }
				: null,
			thinkingLevel: session?.thinkingLevel ?? null,
		});
		log("Sidecar ready — %d models available", models.length);
	}

	// ── Build handler deps ─────────────────────────────────────────────
	const deps: HandlerDependencies = {
		get initialized() { return initialized; },
		get modelRegistry() { return modelRegistry!; },
		get session() { return session; },
		get authStorage() { return authStorage; },
		get settingsManager() { return settingsManager; },
		get sessionManager() { return sessionManager; },
		get resourceLoader() { return resourceLoader; },
		get zosmaDir() { return zosmaDir; },
		get workspaceCwd() { return workspaceCwd; },
		get promptScheduler() { return promptScheduler; },
		get oauthAbort() { return oauthAbort; },
		get oauthInflight() { return oauthInflight; },
		get googleConsentAbort() { return googleConsentAbort; },
		initAgent,
		bindExtensionUi,
		resolveUiResponse,
		buildResourceLoader: async (cwd: string, opts?: any) => {
			return buildResourceLoader(cwd, zosmaDir, settingsManager!, opts);
		},
		setInitialized: (v: boolean) => { initialized = v; },
		setSession: (s: any) => { session = s; },
		setSessionManager: (sm: any) => { sessionManager = sm; },
		setResourceLoader: (rl: any) => { resourceLoader = rl; },
		setWorkspaceCwd: (cwd: string) => { workspaceCwd = cwd; },
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
			logError("command error (type=%s): %s", "type" in cmd ? cmd.type : "?", message);
			send({ type: "error", id: "id" in cmd ? cmd.id : "unknown", message });
			if (activePromptId) {
				send({ type: "done", id: activePromptId });
				activePromptId = null;
			}
		}
	}

	log("Sidecar shutting down (stdin closed)");
	process.exit(0);
}

main().catch((err) => {
	log("Fatal: %s", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
