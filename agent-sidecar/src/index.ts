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
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	AuthStorage,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	createAgentSession,
} from "@earendil-works/pi-coding-agent";

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

type Command =
	| InitCommand
	| GetModelsCommand
	| PromptCommand
	| AbortCommand
	| SetModelCommand
	| SaveAuthCommand
	| ReloadCommand
	| SaveSessionCommand
	| LoadSessionCommand
	| DeleteSessionCommand
	| NewSessionCommand
	| ListSessionsCommand
	| GetSettingsCommand
	| SaveSettingsCommand;

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
	process.stdout.write(`${JSON.stringify(obj)}\n`);
}

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

	const filePath = join(sDir, `${sessionId}.jsonl`);
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
function restoreSessionContext(session: Awaited<ReturnType<typeof createAgentSession>>["session"], messages: unknown[]): void {
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
		settingsManager = SettingsManager.inMemory({
			compaction: { enabled: false },
		});

		// Resource loader — discovers extensions, skills, prompts from
		// the zosma agent dir.
		resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

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
					activePromptId = cmd.id;
					try {
						await session.prompt(cmd.text);
					} finally {
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
						await session.setModel(
							found as Parameters<typeof session.setModel>[0],
						);
						send({ type: "result", id: cmd.id, data: { success: true } });
					} else {
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
				id: "unknown",
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
