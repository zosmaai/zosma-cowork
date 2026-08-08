/**
 * SessionRuntimeManager — owns a map of canonical-session-file → isolated runtime.
 *
 * Each runtime owns its Pi AgentSession, SessionManager, resource loader/cwd,
 * model, scheduler, prompt watchdog state, queue, event subscription, and
 * extension UI binding. Commands resolve the target runtime by canonical
 * sessionFile; unknown sessions return a structured error instead of
 * falling back to whichever session was viewed most recently.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type {
	AgentSession,
	DefaultResourceLoader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { convertAgentMessagesToChat } from "./pi-session-store.js";
import type { PromptScheduler } from "./prompt-scheduler.js";
import type {
	SessionErrorCode,
	SessionSnapshot,
	SessionStatus,
	SessionWireError,
} from "./session-protocol.js";

export interface PromptRunState {
	activePromptId: string | null;
	startedAt: number;
	hasEmitted: boolean;
}

export interface SessionRuntime {
	sessionFile: string;
	cwd: string;
	session: AgentSession;
	sessionManager: SessionManager;
	resourceLoader: DefaultResourceLoader;
	promptScheduler: PromptScheduler;
	prompt: PromptRunState;
	status: SessionStatus;
	error?: SessionWireError;
	unsubscribe: () => void;
	dispose: () => Promise<void>;
}

export interface SessionRuntimeFactory {
	create(cwd: string): Promise<SessionRuntime>;
	load(sessionFile: string): Promise<SessionRuntime>;
}

export class SessionRuntimeError extends Error {
	constructor(
		message: string,
		readonly code: SessionErrorCode,
		readonly retryable: boolean,
		readonly details?: string,
	) {
		super(message);
		this.name = "SessionRuntimeError";
	}
}

/**
 * Canonical session identity: resolve to absolute + dereference symlinks so
 * duplicate paths always map to the same runtime. Falls back to absolute if
 * realpathSync fails (file not yet created).
 */
export function canonicalSessionFile(sessionFile: string): string {
	const absolute = resolve(sessionFile);
	try {
		return realpathSync.native(absolute);
	} catch {
		return absolute;
	}
}

/**
 * Snapshot a runtime into the SessionSnapshot wire shape. Used by
 * new_session, load_session, and ready payloads so the frontend hydrates
 * the full transcript, queue, status, and structured error in one shot.
 */
export function snapshotRuntime(runtime: SessionRuntime): SessionSnapshot {
	const model = runtime.session.model;
	return {
		sessionFile: runtime.sessionFile,
		mode: "chat",
		cwd: runtime.cwd,
		messages: convertAgentMessagesToChat(runtime.session.messages as unknown[]),
		isRunning:
			runtime.session.isStreaming ||
			runtime.status === "thinking" ||
			runtime.status === "tool_call" ||
			runtime.status === "responding",
		status: runtime.status,
		queue: {
			steering: [...runtime.session.getSteeringMessages()],
			followUp: [...runtime.session.getFollowUpMessages()],
		},
		model: model
			? { provider: model.provider, id: model.id, name: model.name }
			: undefined,
		error: runtime.error,
	};
}

export class SessionRuntimeManager {
	private readonly runtimes = new Map<string, SessionRuntime>();
	private readonly loading = new Map<string, Promise<SessionRuntime>>();

	constructor(private readonly factory: SessionRuntimeFactory) {}

	get(sessionFile: string): SessionRuntime | undefined {
		return this.runtimes.get(canonicalSessionFile(sessionFile));
	}

	require(sessionFile: string): SessionRuntime {
		const runtime = this.get(sessionFile);
		if (!runtime) {
			throw new SessionRuntimeError(
				"Session is not loaded",
				"session_not_loaded",
				true,
				canonicalSessionFile(sessionFile),
			);
		}
		return runtime;
	}

	async create(cwd: string): Promise<SessionRuntime> {
		return this.remember(await this.factory.create(cwd));
	}

	async load(sessionFile: string): Promise<SessionRuntime> {
		const key = canonicalSessionFile(sessionFile);
		const existing = this.runtimes.get(key);
		if (existing) return existing;
		const pending = this.loading.get(key);
		if (pending) return pending;
		const load = this.factory
			.load(key)
			.then((runtime) => this.remember(runtime))
			.finally(() => this.loading.delete(key));
		this.loading.set(key, load);
		return load;
	}

	/** Reload every loaded runtime (auth/settings refresh). */
	async reloadAll(): Promise<void> {
		await Promise.all([...this.runtimes.values()].map((runtime) => runtime.session.reload()));
	}

	async dispose(sessionFile: string): Promise<void> {
		const key = canonicalSessionFile(sessionFile);
		const pending = this.loading.get(key);
		if (pending) await pending.catch(() => undefined);
		const runtime = this.runtimes.get(key);
		if (!runtime) return;
		this.runtimes.delete(key);
		await runtime.dispose();
	}

	async disposeAll(): Promise<void> {
		await Promise.allSettled([...this.loading.values()]);
		const runtimes = [...this.runtimes.values()];
		this.runtimes.clear();
		this.loading.clear();
		await Promise.all(runtimes.map((runtime) => runtime.dispose()));
	}

	private remember(runtime: SessionRuntime): SessionRuntime {
		const key = canonicalSessionFile(runtime.sessionFile);
		const existing = this.runtimes.get(key);
		if (existing) return existing;
		runtime.sessionFile = key;
		this.runtimes.set(key, runtime);
		return runtime;
	}
}
