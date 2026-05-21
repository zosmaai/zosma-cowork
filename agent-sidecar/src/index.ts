/**
 * Zosma Cowork — Agent Sidecar
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
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// ═══════════════════════════════════════════════════════════════════════════
// Timeout configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maximum time (ms) to wait for a single prompt to complete before aborting.
 * Prevents the UI from staying in "thinking" state indefinitely when the
 * agent loop hangs (e.g., on a non-responsive API call or stuck tool loop).
 * When this fires, the session is aborted and a "done" event is sent.
 */
const PROMPT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Maximum time (ms) to wait for an individual streaming API request before
 * the HTTP client times out. Applied when no default is set in settings.
 */
const PROVIDER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
import {
	AuthStorage,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	createAgentSession,
} from "@earendil-works/pi-coding-agent";
import {
	discoverExtensions,
	installExtension,
	searchNpmRegistry,
	setExtensionConfig,
	setExtensionEnabled,
	uninstallExtension,
} from "./extension-manager.js";
// Vendored pi-anthropic-messages bridge (see scripts/prebuild.mjs). Without
// this loaded as an extension, Claude Pro/Max OAuth requests are
// fingerprinted by Anthropic as a "third-party app" and rejected with a
// 400 invalid_request_error pointing at claude.ai/settings/usage. The
// bridge rewrites the system prompt and tool names so requests pass as
// canonical Claude CLI traffic. esbuild inlines this module into our
// bundle; we never depend on jiti / typebox at runtime.
import piAnthropicMessages from "./vendor/anthropic-messages/extensions/index.js";
// Zosma Office Document Generation extension — registers 8 OfficeCLI tools.
import zosmaOfficeDocs from "./office-docs/extension.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InitCommand {
	type: "init";
	zosmaDir?: string;
}

interface GetModelsCommand {
	type: "get_models";
	id: string;
}

interface PromptCommand {
	type: "prompt";
	id: string;
	text: string;
}

interface AbortCommand {
	type: "abort";
	id: string;
}

interface SetModelCommand {
	type: "set_model";
	id: string;
	provider: string;
	model: string;
}

interface SaveAuthCommand {
	type: "save_auth";
	id: string;
	provider: string;
	key: string;
}

interface StartOAuthCommand {
	type: "start_oauth";
	id: string;
	provider: string;
}

interface CancelOAuthCommand {
	type: "cancel_oauth";
	id: string;
}

interface LogoutCommand {
	type: "logout";
	id: string;
	provider: string;
}

interface GetAuthStatusCommand {
	type: "get_auth_status";
	id: string;
}

interface ReloadCommand {
	type: "reload";
	id: string;
}

interface SaveSessionCommand {
	type: "save_session";
	id: string;
	/** Session display title */
	title: string;
	/** Session messages (ChatMessage array) */
	messages: unknown[];
	/** Model info */
	model?: string;
	provider?: string;
}

interface LoadSessionCommand {
	type: "load_session";
	id: string;
	/** Session file name (from list_sessions) */
	sessionFile: string;
}

interface DeleteSessionCommand {
	type: "delete_session";
	id: string;
	/** Session file name to delete */
	sessionFile: string;
}

interface NewSessionCommand {
	type: "new_session";
	id: string;
}

interface ListSessionsCommand {
	type: "list_sessions";
	id: string;
}

interface GetSettingsCommand {
	type: "get_settings";
	id: string;
}

interface SaveSettingsCommand {
	type: "save_settings";
	id: string;
	defaultModel?: string;
	defaultProvider?: string;
	[key: string]: unknown;
}

interface ListExtensionsCommand {
	type: "list_extensions";
	id: string;
}

interface InstallExtensionCommand {
	type: "install_extension";
	id: string;
	source: string;
	ref?: string;
}

interface UninstallExtensionCommand {
	type: "uninstall_extension";
	id: string;
	extensionId: string;
}

interface SetExtensionEnabledCommand {
	type: "set_extension_enabled";
	id: string;
	extensionId: string;
	enabled: boolean;
}

interface SetExtensionConfigCommand {
	type: "set_extension_config";
	id: string;
	extensionId: string;
	config: Record<string, unknown>;
}

interface SearchDiscoverCommand {
	type: "search_discover";
	id: string;
	query: string;
}

interface SearchSkillsCommand {
	type: "search_skills";
	id: string;
	query: string;
}

interface ListSkillsCommand {
	type: "list_skills";
	id: string;
}

// Skill install/remove moved to Rust (src-tauri/src/lib.rs).
// These handlers no longer exist in the sidecar — npx is not needed.
// interface InstallSkillCommand { type: "install_skill"; id: string; source: string; }
// interface RemoveSkillCommand { type: "remove_skill"; id: string; name: string; }

interface FetchSkillPackumentCommand {
	type: "fetch_skill_packument";
	id: string;
	packageName: string;
}

type Command =
	| InitCommand
	| GetModelsCommand
	| PromptCommand
	| AbortCommand
	| SetModelCommand
	| SaveAuthCommand
	| StartOAuthCommand
	| CancelOAuthCommand
	| LogoutCommand
	| GetAuthStatusCommand
	| ReloadCommand
	| SaveSessionCommand
	| LoadSessionCommand
	| DeleteSessionCommand
	| NewSessionCommand
	| ListSessionsCommand
	| GetSettingsCommand
	| SaveSettingsCommand
	| ListExtensionsCommand
	| InstallExtensionCommand
	| UninstallExtensionCommand
	| SetExtensionEnabledCommand
	| SetExtensionConfigCommand
	| SearchDiscoverCommand
	| SearchSkillsCommand
	| ListSkillsCommand
	// | InstallSkillCommand — moved to Rust (lib.rs)
	// | RemoveSkillCommand — moved to Rust (lib.rs)
	| FetchSkillPackumentCommand;

// ---------------------------------------------------------------------------
// Logger (stderr — never interferes with stdout protocol)
// ---------------------------------------------------------------------------

function log(...args: unknown[]) {
	process.stderr.write(`[sidecar] ${args.join(" ")}\n`);
}

// ---------------------------------------------------------------------------
// JSON stdout sender
// ---------------------------------------------------------------------------

function send(obj: unknown) {
	try {
		process.stdout.write(`${JSON.stringify(obj)}\n`);
	} catch (err) {
		// EPIPE happens when the Rust side kills us — ignore gracefully
		if ((err as NodeJS.ErrnoException)?.code === "EPIPE") {
			process.exit(0);
		}
		throw err;
	}
}

// Handle EPIPE on stdout globally (when pipe breaks before our next write)
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") {
		process.exit(0);
	}
});

// ---------------------------------------------------------------------------
// Zosma config directories
// ---------------------------------------------------------------------------

function defaultZosmaDir(): string {
	const home = homedir();
	return join(home, ".zosmaai");
}

function zosmaAgentDir(zosmaDir: string): string {
	return join(zosmaDir, "cowork");
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function sessionsDir(zosmaDir: string): string {
	return join(zosmaAgentDir(zosmaDir), "sessions");
}

/**
 * Clean up stale lock files left by old Rust backend (fs4) or crashed processes.
 * pi-mono's AuthStorage uses proper-lockfile which can get stuck on stale locks.
 */
function cleanStaleLocks(dir: string): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		if (entry.endsWith(".lock")) {
			const lockPath = join(dir, entry);
			try {
				unlinkSync(lockPath);
				log("Cleaned stale lock: %s", entry);
			} catch {
				// ignore if another process holds it
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Session persistence helpers
// ---------------------------------------------------------------------------

/**
 * List all session files with their metadata headers.
 * Returns sorted by most recent first.
 */
function listSessionFiles(zosmaDir: string): Array<{
	file: string;
	title: string;
	model?: string;
	provider?: string;
	messageCount: number;
	createdAt: number;
	lastActivity: number;
}> {
	const sDir = sessionsDir(zosmaDir);
	if (!existsSync(sDir)) return [];

	const files = readdirSync(sDir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort()
		.reverse();

	const sessions: Array<{
		file: string;
		title: string;
		model?: string;
		provider?: string;
		messageCount: number;
		createdAt: number;
		lastActivity: number;
	}> = [];

	for (const file of files) {
		try {
			const filePath = join(sDir, file);
			const content = readFileSync(filePath, "utf-8");
			const lines = content.trim().split("\n");
			if (lines.length === 0) continue;

			// First line is header
			const header = JSON.parse(lines[0]);
			if (header.type !== "session") continue;

			// Count messages (non-header lines)
			const messageCount = lines.slice(1).filter((l) => l.trim()).length;

			// Last activity is last message timestamp or header timestamp
			let lastActivity = header.createdAt || 0;
			if (lines.length > 1) {
				try {
					const lastLine = JSON.parse(lines[lines.length - 1]);
					lastActivity = lastLine.timestamp || lastActivity;
				} catch {
					// ignore
				}
			}

			sessions.push({
				file,
				title: header.title || file.replace(".jsonl", ""),
				model: header.model,
				provider: header.provider,
				messageCount,
				createdAt: header.createdAt || 0,
				lastActivity,
			});
		} catch (err) {
			log("Error reading session %s: %s", file, err);
		}
	}

	// Sort by lastActivity descending
	sessions.sort((a, b) => b.lastActivity - a.lastActivity);
	return sessions;
}

/**
 * Save messages to a session JSONL file.
 * Format: First line is header, subsequent lines are JSON message objects.
 */
function saveSession(
	zosmaDir: string,
	sessionId: string,
	title: string,
	messages: unknown[],
	model?: string,
	provider?: string,
): void {
	const sDir = sessionsDir(zosmaDir);
	ensureDir(sDir);

	// Strip .jsonl if already present (sent from frontend which adds extension)
	const cleanId = sessionId.replace(/\.jsonl$/i, "");
	const filePath = join(sDir, `${cleanId}.jsonl`);
	const header = {
		type: "session",
		version: 1,
		title,
		createdAt: Date.now(),
		model,
		provider,
		messageCount: messages.length,
	};

	const lines = [JSON.stringify(header)];
	for (const msg of messages) {
		lines.push(JSON.stringify(msg));
	}

	writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
	log("Saved session: %s (%d messages)", sessionId, messages.length);
}

/**
 * Load messages from a session file.
 * Returns the messages array (excluding the header).
 */
function loadSessionMessages(zosmaDir: string, sessionFile: string): unknown[] {
	const filePath = join(sessionsDir(zosmaDir), sessionFile);
	if (!existsSync(filePath)) {
		throw new Error(`Session not found: ${sessionFile}`);
	}

	const content = readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n");
	if (lines.length === 0) return [];

	const messages: unknown[] = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line) {
			try {
				messages.push(JSON.parse(line));
			} catch {
				log("Skipping invalid JSON in session line %d", i + 1);
			}
		}
	}
	return messages;
}

/**
 * Delete a session file.
 */
function deleteSessionFile(zosmaDir: string, sessionFile: string): boolean {
	const filePath = join(sessionsDir(zosmaDir), sessionFile);
	if (!existsSync(filePath)) return false;
	unlinkSync(filePath);
	log("Deleted session: %s", sessionFile);
	return true;
}

// ---------------------------------------------------------------------------
// Session context restoration
// ---------------------------------------------------------------------------

/**
 * Convert our saved ChatMessage format to pi-mono AgentMessage format
 * and restore them into the active session so the agent has context.
 */
function restoreSessionContext(
	session: Awaited<ReturnType<typeof createAgentSession>>["session"],
	messages: unknown[],
): void {
	const piMessages: unknown[] = [];

	for (const raw of messages) {
		const msg = raw as Record<string, unknown>;
		const role = msg.role as string;
		const content = msg.content as string | undefined;
		const timestamp = msg.timestamp as number | undefined;
		const thinking = msg.thinking as string | undefined;
		const toolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined;
		const model = msg.model as string | undefined;
		const provider = msg.provider as string | undefined;

		if (role === "user") {
			piMessages.push({
				role: "user",
				content: [{ type: "text", text: content || "" }],
				timestamp,
			});
		} else if (role === "assistant") {
			const contentArr: Array<Record<string, unknown>> = [];

			// Order: thinking → tool calls → final text
			if (thinking) {
				contentArr.push({ type: "thinking", thinking });
			}

			if (toolCalls && toolCalls.length > 0) {
				for (const tc of toolCalls) {
					contentArr.push({
						type: "toolCall",
						id: tc.id,
						name: tc.name,
						arguments: tc.args || {},
					});
				}
			}

			if (content) {
				contentArr.push({ type: "text", text: content });
			}

			piMessages.push({
				role: "assistant",
				content: contentArr,
				timestamp,
				model,
				provider,
			});

			// Append tool result messages for completed tool calls
			if (toolCalls) {
				for (const tc of toolCalls) {
					const status = tc.status as string;
					if (status === "completed" || status === "error") {
						piMessages.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name as string,
							content: [{ type: "text", text: (tc.result as string) || "" }],
							isError: status === "error",
							timestamp,
						});
					}
				}
			}
		}
		// System messages: skip — they're display-only status indicators
	}

	if (piMessages.length > 0) {
		log("Restoring %d messages into session context", piMessages.length);
		// biome-ignore lint/suspicious/noExplicitAny: pi-mono doesn't export AgentState type
		(session as any).agent.state.messages = piMessages;
	}
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

function settingsFilePath(zosmaDir: string): string {
	return join(zosmaAgentDir(zosmaDir), "settings.json");
}

function loadSettings(zosmaDir: string): Record<string, unknown> {
	const fp = settingsFilePath(zosmaDir);
	if (!existsSync(fp)) return {};
	try {
		return JSON.parse(readFileSync(fp, "utf-8"));
	} catch {
		return {};
	}
}

function saveSettings(zosmaDir: string, settings: Record<string, unknown>): void {
	const fp = settingsFilePath(zosmaDir);
	ensureDir(zosmaAgentDir(zosmaDir));
	writeFileSync(fp, JSON.stringify(settings, null, 2), "utf-8");
	log("Settings saved");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	log("Sidecar starting (pid=%s)", process.pid);

	// Defaults
	let zosmaDir = defaultZosmaDir();
	let activePromptId: string | null = null;

	// In-flight OAuth login (only one at a time). Holds the AbortController so
	// `cancel_oauth` can interrupt the SDK's loopback callback server, and the
	// promise tracking the flow's full lifecycle so a re-entrant `start_oauth`
	// can wait for the previous flow's cleanup before installing a fresh one.
	let oauthAbort: AbortController | null = null;
	let oauthInflight: Promise<void> | null = null;

	// These are set during init
	let authStorage: AuthStorage | undefined;
	let modelRegistry: ModelRegistry | undefined;
	let sessionManager: ReturnType<typeof SessionManager.inMemory> | undefined;
	let settingsManager: ReturnType<typeof SettingsManager.inMemory> | undefined;
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	let resourceLoader: DefaultResourceLoader | undefined;

	// Flag: ready to accept prompts
	let initialized = false;

	async function initAgent(zosmaDirPath: string) {
		zosmaDir = zosmaDirPath;
		const agentDir = zosmaAgentDir(zosmaDir);
		ensureDir(agentDir);

		const authPath = join(agentDir, "auth.json");
		const modelsPath = join(agentDir, "models.json");

		// Clean stale lock files from old Rust backend
		cleanStaleLocks(agentDir);

		log("Agent dir: %s", agentDir);
		log("Auth path: %s", authPath);
		log("Models path: %s", modelsPath);

		// Auth storage — points at our zosma dir
		authStorage = AuthStorage.create(authPath);

		// Model registry — reads built-in + custom models from our dir
		modelRegistry = ModelRegistry.create(authStorage, modelsPath);

		// Settings — in-memory for now, minimal config
		// Set a default provider timeout so API calls never hang indefinitely
		settingsManager = SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: {
				provider: {
					timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
					maxRetries: 3,
				},
			},
		});

		// Resource loader — discovers extensions, skills, prompts from
		// the zosma agent dir. Also takes the vendored pi-anthropic-messages
		// bridge as an inline factory so we don't depend on pi's disk-based
		// extension discovery (which needs jiti + a node_modules tree to
		// resolve `typebox`, neither of which is available in our bundled
		// sidecar).
		resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir,
			settingsManager,
			extensionFactories: [piAnthropicMessages, zosmaOfficeDocs],
		});
		await resourceLoader.reload();
		// Surface any extension-load errors — they're silently collected by
		// the loader otherwise, which made the pi-anthropic-messages bridge
		// look "installed" while never actually activating.
		try {
			const extResult = resourceLoader.getExtensions();
			if (extResult.errors && extResult.errors.length > 0) {
				for (const err of extResult.errors) {
					log("extension load error: %s — %s", err.path, err.error);
				}
			}
			log(
				"extensions loaded: %d (errors: %d)",
				extResult.extensions?.length ?? 0,
				extResult.errors?.length ?? 0,
			);
			for (const ext of extResult.extensions ?? []) {
				log("  - %s", ext.path);
			}
		} catch (err) {
			log("getExtensions failed: %s", err);
		}

		// Session manager — in-memory (persistence handled by sidecar commands)
		sessionManager = SessionManager.inMemory();

		// Create the agent session
		const result = await createAgentSession({
			authStorage,
			modelRegistry,
			sessionManager,
			settingsManager,
			resourceLoader,
		});
		session = result.session;

		// Subscribe to all agent events and forward to stdout
		session.subscribe((event) => {
			send({ type: "event", event });
		});

		initialized = true;

		// Report available models
		const available = await modelRegistry.getAvailable();
		const models = available.map((m) => ({
			id: m.id,
			name: m.name,
			provider: m.provider,
			reasoning: m.reasoning,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
		}));

		// Build provider list
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
		});

		log("Sidecar ready — %d models available", models.length);
	}

	// Process stdin commands
	const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

	for await (const line of rl) {
		if (!line.trim()) continue;

		let cmd: Command;
		try {
			cmd = JSON.parse(line);
		} catch {
			log("Invalid JSON: %s", line.slice(0, 100));
			continue;
		}

		log("Command: type=%s id=%s", cmd.type, "id" in cmd ? cmd.id : "-");

		try {
			switch (cmd.type) {
				// ── init ───────────────────────────────────────────────────
				case "init": {
					await initAgent(cmd.zosmaDir ?? defaultZosmaDir());
					break;
				}

				// ── get_models ─────────────────────────────────────────────
				case "get_models": {
					if (!initialized || !modelRegistry) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					const available = await modelRegistry.getAvailable();
					const models = available.map((m) => ({
						id: m.id,
						name: m.name,
						provider: m.provider,
						reasoning: m.reasoning,
						contextWindow: m.contextWindow,
						maxTokens: m.maxTokens,
					}));
					send({ type: "result", id: cmd.id, data: { models } });
					break;
				}

				// ── prompt ─────────────────────────────────────────────────
				case "prompt": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					const promptModel = session.model;
					log("prompt: using model %s/%s", promptModel?.provider, promptModel?.id);
					activePromptId = cmd.id;

					// Auto-abort timeout: prevents the UI from staying in "thinking"
					// state indefinitely when a prompt hangs (e.g. streaming request
					// interrupted, API unresponsive, tool loop stuck). The timeout
					// calls session.abort() which triggers the agent's abort signal,
					// cancelling the active streaming request or tool execution. The
					// agent loop then terminates with "aborted" stop reason and
					// session.prompt() resolves, allowing the "done" event to be sent.
					const abortTimeout = setTimeout(() => {
						log(
							"prompt: timeout after %dms — aborting session",
							PROMPT_TIMEOUT_MS,
						);
						// Abort the active agent run (cancels streaming HTTP request
						// or tool execution). The agent loop will detect the abort
						// signal and terminate with "aborted" stop reason.
						try {
							session!.abort();
						} catch {
							// ignore if session already completed
						}
					}, PROMPT_TIMEOUT_MS);

					try {
						await session.prompt(cmd.text);
					} catch (err) {
						// Surface SDK errors back to the UI instead of swallowing them
						// silently with just a "done" event.
						const msg = err instanceof Error ? err.message : String(err);
						log("prompt: %s", msg);
						send({ type: "error", id: cmd.id, message: msg });
					} finally {
						clearTimeout(abortTimeout);
						send({ type: "done", id: cmd.id });
						activePromptId = null;
					}
					break;
				}

				// ── abort ──────────────────────────────────────────────────
				case "abort": {
					if (session) {
						session.abort();
					}
					send({
						type: "done",
						id: cmd.id ?? activePromptId ?? "abort",
					});
					activePromptId = null;
					break;
				}

				// ── set_model ──────────────────────────────────────────────
				case "set_model": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					const found = modelRegistry?.find(cmd.provider, cmd.model);
					if (found) {
						log("set_model: found %s/%s (id=%s)", cmd.provider, cmd.model, found.id);
						await session.setModel(found as Parameters<typeof session.setModel>[0]);
						const currentModel = session.model;
						log(
							"set_model: after setModel, session.model = %s/%s",
							currentModel?.provider,
							currentModel?.id,
						);
						send({ type: "result", id: cmd.id, data: { success: true } });
					} else {
						log("set_model: NOT FOUND %s/%s", cmd.provider, cmd.model);
						send({
							type: "error",
							id: cmd.id,
							message: `Model not found: ${cmd.provider}/${cmd.model}`,
						});
					}
					break;
				}

				// ── save_auth ──────────────────────────────────────────────
				case "save_auth": {
					const agentDir = zosmaAgentDir(zosmaDir);
					ensureDir(agentDir);
					cleanStaleLocks(agentDir);

					const authPath = join(agentDir, "auth.json");
					let existing: Record<string, unknown> = {};
					try {
						if (existsSync(authPath)) {
							existing = JSON.parse(readFileSync(authPath, "utf-8"));
						}
					} catch {
						// Start fresh if corrupt
					}

					existing[cmd.provider] = { type: "api_key", key: cmd.key };
					writeFileSync(authPath, JSON.stringify(existing, null, 2), "utf-8");
					log("Saved API key for %s", cmd.provider);

					// Reload: recreate everything with fresh auth
					await initAgent(zosmaDir);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── start_oauth ────────────────────────────────────────────
				case "start_oauth": {
					if (!authStorage) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					// If a previous flow is still in flight (e.g. the user closed
					// the browser without completing), abort it and wait for its
					// cleanup before installing a new one. This makes start_oauth
					// idempotent — clicking "Sign In" again always works.
					if (oauthAbort) {
						log("start_oauth: aborting previous in-flight flow");
						oauthAbort.abort();
						if (oauthInflight) {
							try {
								await oauthInflight;
							} catch {
								// expected: previous flow rejected with AbortError
							}
						}
					}
					const ac = new AbortController();
					oauthAbort = ac;
					const provider = cmd.provider;
					const cmdId = cmd.id;
					const storage = authStorage;
					log("Starting OAuth for %s", provider);
					oauthInflight = (async () => {
						try {
							await storage.login(provider, {
								onAuth: (info) => {
									send({
										type: "event",
										event: {
											kind: "oauth_open_url",
											provider,
											url: info.url,
											instructions: info.instructions,
										},
									});
								},
								onPrompt: async (prompt) => {
									// Some providers (notably GitHub Copilot) ask for a
									// GitHub Enterprise URL during the OAuth flow with a
									// "blank for github.com" affordance. There's no input
									// surface in the desktop UI for this, so accept the
									// blank default. Any prompt whose placeholder reads as
									// "blank for <something>" or "default <something>" is
									// safe to default — the SDK validates the result and
									// will report a clear error if the empty answer is
									// rejected. Everything else still throws.
									const msg = String(prompt.message ?? "").trim();
									const placeholder = String(prompt.placeholder ?? "").trim();
									const blankIsValid =
										/blank for|default[: ]/i.test(placeholder) ||
										/enterprise/i.test(msg);
									if (blankIsValid) {
										log(
											"OAuth prompt auto-answered with empty (message=%s, placeholder=%s)",
											msg,
											placeholder,
										);
										return "";
									}
									throw new Error(
										`Interactive prompts are not supported in the desktop OAuth flow (message: ${msg})`,
									);
								},
								onProgress: (message) => {
									send({
										type: "event",
										event: { kind: "oauth_progress", provider, message },
									});
								},
								// The SDK's loginAnthropic ignores the `signal` parameter,
								// so `cancel_oauth` cannot unstick the loopback HTTP
								// server (bound on 53692) directly. Provide an
								// onManualCodeInput callback that rejects when our
								// AbortController fires: that triggers the SDK's
								// server.cancelWait() path, which lets the finally
								// block in loginAnthropic close the server. Without this
								// the server stays bound and subsequent sign-in attempts
								// fail with EADDRINUSE.
								onManualCodeInput: () =>
									new Promise<string>((_resolve, reject) => {
										const err = new Error("OAuth cancelled");
										err.name = "AbortError";
										if (ac.signal.aborted) {
											reject(err);
											return;
										}
										const onAbort = () => reject(err);
										ac.signal.addEventListener("abort", onAbort, {
											once: true,
										});
									}),
								signal: ac.signal,
							});
							log("OAuth login succeeded for %s", provider);
							// Release the AbortSignal so the dangling
							// onManualCodeInput promise rejects and gets GC'd.
							if (!ac.signal.aborted) ac.abort();
							send({ type: "result", id: cmdId, data: { success: true } });
							send({
								type: "event",
								event: { kind: "oauth_completed", provider },
							});
							// Reload the agent so the new provider's models appear.
							initAgent(zosmaDir).catch((err) => {
								log("initAgent failed after oauth: %s", err);
								send({
									type: "event",
									event: { kind: "agent_reload_failed", error: String(err) },
								});
							});
						} catch (err: unknown) {
							const errAny = err as { name?: string; message?: string } | undefined;
							const cancelled = errAny?.name === "AbortError" || ac.signal.aborted;
							log(
								"OAuth login %s for %s: %s",
								cancelled ? "cancelled" : "failed",
								provider,
								errAny?.message ?? err,
							);
							send({
								type: "result",
								id: cmdId,
								data: {
									success: false,
									cancelled,
									error: cancelled ? undefined : String(errAny?.message ?? err),
								},
							});
							send({
								type: "event",
								event: {
									kind: cancelled ? "oauth_cancelled" : "oauth_failed",
									provider,
									error: cancelled ? undefined : String(errAny?.message ?? err),
								},
							});
						} finally {
							// Only clear if we still own the slot. A subsequent
							// start_oauth call may have installed a fresh AC/promise
							// while this one was unwinding.
							if (oauthAbort === ac) {
								oauthAbort = null;
								oauthInflight = null;
							}
						}
					})();
					break;
				}

				// ── cancel_oauth ───────────────────────────────────────────
				case "cancel_oauth": {
					if (oauthAbort) {
						log("Cancelling OAuth flow");
						oauthAbort.abort();
					}
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── logout ─────────────────────────────────────────────────
				case "logout": {
					if (!authStorage) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					try {
						authStorage.logout(cmd.provider);
						log("Logged out provider %s", cmd.provider);
					} catch (err) {
						log("logout failed: %s", err);
					}
					send({ type: "result", id: cmd.id, data: { success: true } });
					initAgent(zosmaDir).catch((err) => {
						log("initAgent failed after logout: %s", err);
						send({
							type: "event",
							event: { kind: "agent_reload_failed", error: String(err) },
						});
					});
					break;
				}

				// ── get_auth_status ────────────────────────────────────────
				case "get_auth_status": {
					if (!authStorage) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					const providers: Array<{
						id: string;
						type: "api_key" | "oauth" | "unknown";
						expires?: number;
					}> = [];
					for (const providerId of authStorage.list()) {
						const cred = authStorage.get(providerId);
						if (!cred) continue;
						if (cred.type === "oauth") {
							providers.push({
								id: providerId,
								type: "oauth",
								expires: (cred as { expires?: number }).expires,
							});
						} else if (cred.type === "api_key") {
							providers.push({ id: providerId, type: "api_key" });
						} else {
							providers.push({ id: providerId, type: "unknown" });
						}
					}
					// Also expose OAuth providers the SDK supports, so the UI can
					// offer "Sign in" buttons for providers the user hasn't yet
					// configured.
					let supported: string[] = [];
					try {
						supported = authStorage.getOAuthProviders().map((p) => p.id);
					} catch {
						// older SDKs may not expose this — fail soft
					}
					send({
						type: "result",
						id: cmd.id,
						data: { providers, supported },
					});
					break;
				}

				// ── reload ─────────────────────────────────────────────────
				case "reload": {
					await initAgent(zosmaDir);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── new_session ────────────────────────────────────────────
				case "new_session": {
					// Reset the in-memory session for a fresh start
					if (session) {
						session.abort();
					}
					if (!authStorage || !modelRegistry || !settingsManager || !resourceLoader) {
						send({ type: "error", id: cmd.id, error: "Agent not initialized" });
						break;
					}
					const newSessionManager = SessionManager.inMemory();
					const result = await createAgentSession({
						authStorage,
						modelRegistry,
						sessionManager: newSessionManager,
						settingsManager,
						resourceLoader,
					});
					session = result.session;
					sessionManager = newSessionManager;

					// Re-subscribe to events
					session.subscribe((event) => {
						send({ type: "event", event });
					});

					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── list_sessions ──────────────────────────────────────────
				case "list_sessions": {
					const sessions = listSessionFiles(zosmaDir);
					send({
						type: "result",
						id: cmd.id,
						data: { sessions },
					});
					break;
				}

				// ── save_session ───────────────────────────────────────────
				case "save_session": {
					saveSession(
						zosmaDir,
						cmd.id,
						cmd.title || "Chat",
						cmd.messages || [],
						cmd.model,
						cmd.provider,
					);
					send({ type: "done", id: cmd.id });
					break;
				}

				// ── load_session ───────────────────────────────────────────
				case "load_session": {
					try {
						const messages = loadSessionMessages(zosmaDir, cmd.sessionFile);
						// Also read the header for metadata
						const filePath = join(sessionsDir(zosmaDir), cmd.sessionFile);
						const content = readFileSync(filePath, "utf-8");
						const header = JSON.parse(content.trim().split("\n")[0]);

						// Restore messages into pi-mono session so agent has context
						if (session && Array.isArray(messages) && messages.length > 0) {
							restoreSessionContext(session, messages);
						}

						send({
							type: "result",
							id: cmd.id,
							data: {
								messages,
								title: header.title || "",
								model: header.model,
								provider: header.provider,
							},
						});
					} catch (err) {
						send({
							type: "error",
							id: cmd.id,
							message: err instanceof Error ? err.message : String(err),
						});
					}
					break;
				}

				// ── delete_session ─────────────────────────────────────────
				case "delete_session": {
					const deleted = deleteSessionFile(zosmaDir, cmd.sessionFile);
					send({
						type: "result",
						id: cmd.id,
						data: { deleted },
					});
					break;
				}

				// ── get_settings ───────────────────────────────────────────
				case "get_settings": {
					try {
						const settings = loadSettings(zosmaDir);
						send({
							type: "result",
							id: cmd.id,
							data: { settings },
						});
					} catch (err) {
						send({
							type: "error",
							id: cmd.id,
							message: err instanceof Error ? err.message : String(err),
						});
					}
					break;
				}

				// ── save_settings ───────────────────────────────────────────
				case "save_settings": {
					try {
						const { id: _sid, type: _t, ...rest } = cmd as Record<string, unknown>;
						saveSettings(zosmaDir, rest as Record<string, unknown>);
						send({ type: "result", id: cmd.id, data: { success: true } });
					} catch (err) {
						send({
							type: "error",
							id: cmd.id,
							message: err instanceof Error ? err.message : String(err),
						});
					}
					break;
				}

				// ── list_extensions ─────────────────────────────────────────
				case "list_extensions": {
					const extensions = discoverExtensions(zosmaDir);
					send({ type: "result", id: cmd.id, data: { extensions } });
					break;
				}

				// ── install_extension ───────────────────────────────────────
				case "install_extension": {
					const ext = installExtension(zosmaDir, cmd.source, cmd.ref);
					send({ type: "result", id: cmd.id, data: { extension: ext } });
					break;
				}

				// ── uninstall_extension ─────────────────────────────────────
				case "uninstall_extension": {
					uninstallExtension(zosmaDir, cmd.extensionId);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── set_extension_enabled ───────────────────────────────────
				case "set_extension_enabled": {
					setExtensionEnabled(zosmaDir, cmd.extensionId, cmd.enabled);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── set_extension_config ────────────────────────────────────
				case "set_extension_config": {
					setExtensionConfig(zosmaDir, cmd.extensionId, cmd.config);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── search_discover ─────────────────────────────────────────
				case "search_discover": {
					const results = await searchNpmRegistry(cmd.query || "pi extension");
					send({ type: "result", id: cmd.id, data: { packages: results } });
					break;
				}

				// ── skills: search ────────────────────────────────────────────
				case "search_skills": {
					const query = (cmd as unknown as Record<string, string>).query || "";
					if (!query.trim()) {
						send({ type: "result", id: cmd.id, data: { results: [] } });
						break;
					}
					try {
						const url = `https://skills.sh/api/search?q=${encodeURIComponent(query.trim())}&limit=20`;
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), 15000);
						const res = await fetch(url, { signal: controller.signal });
						clearTimeout(timeout);
						if (!res.ok) {
							log("search_skills: API returned %d", res.status);
							send({ type: "result", id: cmd.id, data: { results: [] } });
							break;
						}
						const data = (await res.json()) as {
							skills: Array<{
								id: string;
								name: string;
								installs: number;
								source: string;
							}>;
						};
						const results = (data.skills || []).map((skill) => {
							// Construct a proper URL: skill.id is owner/repo/skill-name or owner/repo
							const path = skill.id || (skill.source ? `${skill.source}/${skill.name}` : skill.name);
							return {
								id: path,
								installCount: skill.installs || 0,
								url: `https://skills.sh/${path}`,
								npmData: null,
							};
						});
						send({ type: "result", id: cmd.id, data: { results } });
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						log("search_skills error: %s", message);
						send({ type: "result", id: cmd.id, data: { results: [] } });
					}
					break;
				}

				// ── skills: list installed ───────────────────────────────────
				case "list_skills": {
					try {
						// Read from global (~/.agents/skills/) and local (./agents/skills/) dirs
						const skills: Array<{ name: string; path: string; scope: string; agents: string[] }> = [];
						const seen = new Set<string>();

						const globalDir = join(homedir(), ".agents", "skills");
						const localDir = join(process.cwd(), ".agents", "skills");

						for (const [scope, dir] of [["global", globalDir], ["project", localDir]] as const) {
							if (existsSync(dir)) {
								for (const entry of readdirSync(dir)) {
									const fullPath = join(dir, entry);
									if (entry.startsWith(".") || entry.startsWith("_") || entry === "node_modules") continue;
									if (seen.has(entry)) continue;
									seen.add(entry);
									skills.push({
										name: entry,
										path: fullPath,
										scope,
										agents: [],
									});
								}
							}
						}
						send({ type: "result", id: cmd.id, data: skills });
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						log("list_skills error: %s", message);
						send({ type: "result", id: cmd.id, data: [] });
					}
					break;
				}

				// Skill install/remove handled directly in Rust (lib.rs) — no npx needed.
				// case "install_skill" and case "remove_skill" removed from sidecar.

				default:
					send({
						type: "error",
						id: "unknown",
						message: `Unknown command: ${(cmd as Command).type}`,
					});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log("Error: %s", message);
			send({
				type: "error",
				id: "id" in cmd ? cmd.id : "unknown",
				message,
			});
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
