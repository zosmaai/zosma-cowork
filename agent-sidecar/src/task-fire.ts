/**
 * Task fire execution (#300) — runs a scheduled task's prompt in its OWN
 * isolated agent session and captures that session's conversation into the run
 * record.
 *
 * WHY an isolated session: previously a task fired on the SHARED Cowork chat
 * session. That had two fatal problems:
 *   1. Bleed-over — the run's `subscribe()` handler captured EVERY event on the
 *      shared session, so a "Drink Water" run could record thinking/tool steps
 *      from whatever unrelated work the chat was doing (e.g. building
 *      pi-llm-wiki). The run showed totally unrelated steps.
 *   2. "Agent is already processing" — if the chat was mid-stream, the task
 *      fire fast-failed.
 *
 * The fix: each fire gets a fresh session (its own `sessionId`, its own event
 * stream) via the injected `createSession` factory, runs the prompt there,
 * captures ONLY that session's events, then disposes it. The factory MUST build
 * a session whose resource loader has NO pi-routines extension, otherwise the
 * per-run session would spawn a second scheduler (recursive fires).
 */

export interface TaskFireConversationEntry {
	type: "thinking" | "text" | "tool_call" | "tool_result";
	content?: string;
	toolName?: string;
	toolArgs?: Record<string, unknown>;
	toolResult?: string;
	toolError?: boolean;
}

/** Minimal surface of AgentSession needed to run + capture a task fire. */
export interface TaskFireSession {
	subscribe(listener: (event: Record<string, unknown>) => void): () => void;
	prompt(text: string, options?: Record<string, unknown>): Promise<void>;
	/** Tear down the isolated session once the fire completes. */
	dispose(): void;
}

export interface TaskFireStore {
	updateRun(
		taskId: string,
		runId: string,
		updates: Record<string, unknown>,
	): void;
}

export interface TaskFireTask {
	id: string;
	name: string;
	prompt: string;
}

export interface RunTaskFireOptions {
	task: TaskFireTask;
	runId: string;
	store: TaskFireStore;
	/**
	 * Factory that creates a FRESH, isolated session for THIS run. The session
	 * must use a routines-free resource loader (no nested scheduler).
	 */
	createSession: () => Promise<TaskFireSession>;
	send: (msg: { type: "event"; event: Record<string, unknown> }) => void;
	log?: (fmt: string, ...args: unknown[]) => void;
	now?: () => Date;
	/** Throttle window for live conversation flushes (ms). Default 600. */
	flushIntervalMs?: number;
}

/**
 * Run a single scheduled-task fire in an isolated session and persist its run
 * record. Never throws — failures are recorded on the run.
 */
export async function runTaskFire(opts: RunTaskFireOptions): Promise<void> {
	const { task, runId, store, send } = opts;
	const now = opts.now ?? (() => new Date());
	const flushIntervalMs = opts.flushIntervalMs ?? 600;

	store.updateRun(task.id, runId, { status: "running" });

	let session: TaskFireSession;
	try {
		session = await opts.createSession();
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		store.updateRun(task.id, runId, {
			status: "failed",
			completedAt: now().toISOString(),
			// Actionable reason (never a silent blank) so the Tasks→Activity
			// timeline explains why the fire didn't run. Most commonly this is a
			// missing/unusable model on a machine that hasn't connected an AI.
			response: `Task could not run: ${reason}. Connect an AI model to run scheduled tasks.`,
			conversation: [],
		});
		opts.log?.(
			"task fire could not create session for %s (%s): %s",
			task.id,
			task.name,
			reason,
		);
		return;
	}

	const conversation: TaskFireConversationEntry[] = [];

	// Incremental persistence: flush the in-progress conversation periodically so
	// the UI can show LIVE steps while the task is still running. Throttled to
	// avoid hammering the jsonl file.
	let lastFlush = 0;
	let flushScheduled: ReturnType<typeof setTimeout> | null = null;
	const flushConversation = () => {
		lastFlush = Date.now();
		try {
			store.updateRun(task.id, runId, {
				status: "running",
				conversation: structuredClone(conversation),
			});
			send({
				type: "event",
				event: { type: "task_run_progress", taskId: task.id, runId },
			});
		} catch {
			// best-effort live flush
		}
	};
	const scheduleFlush = () => {
		if (flushIntervalMs <= 0) {
			flushConversation();
			return;
		}
		const elapsed = Date.now() - lastFlush;
		if (elapsed >= flushIntervalMs) {
			flushConversation();
		} else if (!flushScheduled) {
			flushScheduled = setTimeout(() => {
				flushScheduled = null;
				flushConversation();
			}, flushIntervalMs - elapsed);
		}
	};

	const unsub = session.subscribe((event: Record<string, unknown>) => {
		if (event.type === "message_update") {
			const ame = event.assistantMessageEvent as
				| Record<string, unknown>
				| undefined;
			if (!ame) return;
			if (ame.type === "text_delta") {
				const last = conversation[conversation.length - 1];
				if (last?.type === "text") {
					last.content = (last.content ?? "") + ((ame.delta as string) ?? "");
				} else {
					conversation.push({ type: "text", content: (ame.delta as string) ?? "" });
				}
			} else if (ame.type === "thinking_delta") {
				const last = conversation[conversation.length - 1];
				if (last?.type === "thinking") {
					last.content = (last.content ?? "") + ((ame.delta as string) ?? "");
				} else {
					conversation.push({
						type: "thinking",
						content: (ame.delta as string) ?? "",
					});
				}
			} else if (ame.type === "toolcall_end") {
				const tc = (ame as Record<string, unknown>).toolCall as
					| Record<string, unknown>
					| undefined;
				if (tc) {
					conversation.push({
						type: "tool_call",
						toolName: (tc.name as string) ?? "unknown",
						toolArgs: (tc.arguments as Record<string, unknown>) ?? {},
					});
				}
			}
			scheduleFlush();
		} else if (event.type === "tool_execution_end") {
			const te = event as Record<string, unknown>;
			const result = te.result as Record<string, unknown> | undefined;
			const contentArr = result?.content as
				| Array<Record<string, unknown>>
				| undefined;
			const text = contentArr?.map((c) => (c.text as string) ?? "").join("") ?? "";
			conversation.push({
				type: "tool_result",
				toolName: (te.toolName as string) ?? "unknown",
				toolResult: text,
				toolError: (te.isError as boolean) ?? false,
			});
			scheduleFlush();
		}
	});

	const finish = (status: "completed" | "failed") => {
		unsub();
		if (flushScheduled) {
			clearTimeout(flushScheduled);
			flushScheduled = null;
		}
		const responseText = conversation
			.filter((c) => c.type === "text")
			.map((c) => c.content ?? "")
			.join("");
		store.updateRun(task.id, runId, {
			status,
			completedAt: now().toISOString(),
			response: responseText,
			conversation,
		});
		try {
			session.dispose();
		} catch {
			// disposal is best-effort
		}
	};

	try {
		await session.prompt(task.prompt);
		finish("completed");
		send({
			type: "event",
			event: { type: "task_run_completed", taskId: task.id, runId },
		});
	} catch (err) {
		finish("failed");
		opts.log?.(
			"task fire failed for %s (%s): %s",
			task.id,
			task.name,
			err instanceof Error ? err.message : String(err),
		);
	}
}
