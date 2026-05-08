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

import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
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

type Command =
	| InitCommand
	| GetModelsCommand
	| PromptCommand
	| AbortCommand
	| SetModelCommand
	| SaveAuthCommand
	| ReloadCommand;

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

function coworkDir(): string {
	return zosmaAgentDir(defaultZosmaDir()); // ~/.zosmaai/cowork
}

function zosmaAgentDir(zosmaDir: string): string {
	return join(zosmaDir, "cowork");
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
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
		// the zosma agent dir. This is how we'll support the pi extension
		// ecosystem in Phase 4.
		resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		// Session manager — in-memory (no persistence for now)
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
					send({ type: "done", id: cmd.id ?? activePromptId ?? "abort" });
					activePromptId = null;
					break;
				}

				// ── set_model ──────────────────────────────────────────────
				case "set_model": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					// Find the model in the registry
					const found = modelRegistry?.find(cmd.provider, cmd.model);
					if (found) {
						await session.setModel(found as Parameters<typeof session.setModel>[0]);
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
					// Write auth.json directly (bypass pi-mono's file locking to avoid
					// stale lock issues). Then reload the AuthStorage.
					const agentDir = zosmaAgentDir(zosmaDir);
					ensureDir(agentDir);
					cleanStaleLocks(agentDir);

					// Read existing auth if any, then merge
					const authPath = join(agentDir, "auth.json");
					let existing: Record<string, unknown> = {};
					try {
						const { readFileSync } = await import("node:fs");
						if (existsSync(authPath)) {
							existing = JSON.parse(readFileSync(authPath, "utf-8"));
						}
					} catch {
						// Start fresh if corrupt
					}

					existing[cmd.provider] = { type: "api_key", key: cmd.key };

					const { writeFileSync } = await import("node:fs");
					writeFileSync(authPath, JSON.stringify(existing, null, 2), "utf-8");
					log("Saved API key for %s", cmd.provider);

					// Reload: recreate everything with fresh auth
					await initAgent(zosmaDir);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── reload (reinitialize with fresh extensions/auth) ──────
				case "reload": {
					await initAgent(zosmaDir);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				default:
					send({
						type: "error",
						id: "unknown",
						message: "Unknown command",
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
			// If a prompt was in flight, mark it done
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
