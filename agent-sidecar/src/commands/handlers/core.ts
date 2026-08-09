/**
 * Zosma Content CoWork — Core Command Handlers
 *
 * Handles: init, get_models, get_active_model, prompt, abort, steer,
 * follow_up, clear_queue, ui_response, set_model
 *
 * Every session-bound command resolves its target runtime by canonical
 * sessionFile. Unknown sessions return a structured error instead of
 * falling back to a singleton.
 */

import type {
	InitCommand,
	GetModelsCommand,
	GetActiveModelCommand,
	PromptCommand,
	AbortCommand,
	SteerCommand,
	FollowUpCommand,
	ClearQueueCommand,
	UiResponseCommand,
	SetModelCommand,
} from "../types.js";
import { send as sendMsg, log } from "../../protocol.js";
import { runPromptTask } from "../../prompt-runner.js";
import { makeSessionDone, makeSessionError, makeSessionResult } from "../../session-protocol.js";
import { SessionRuntimeError } from "../../session-runtime-manager.js";
import type { HandlerDependencies } from "../handler-registry.js";
import type { SessionRuntime } from "../../session-runtime-manager.js";

// ── helpers ────────────────────────────────────────────────────────────────

function runtimeFor(
	deps: HandlerDependencies,
	cmd: { id: string; sessionFile: string },
): SessionRuntime | undefined {
	try {
		return deps.runtimeManager.require(cmd.sessionFile);
	} catch (error) {
		const runtimeError = error as SessionRuntimeError;
		sendMsg(makeSessionError(cmd.id, cmd.sessionFile, {
			code: runtimeError.code ?? "session_not_loaded",
			message: runtimeError.message,
			retryable: runtimeError.retryable ?? true,
			details: runtimeError.details,
		}));
		return undefined;
	}
}

// ── init ───────────────────────────────────────────────────────────────────

export async function handleInit(
	deps: HandlerDependencies,
	cmd: InitCommand,
): Promise<void> {
	await deps.initAgent(cmd.zosmaDir ?? "", cmd.workspace);
}

// ── get_models ─────────────────────────────────────────────────────────────

export async function handleGetModels(
	deps: HandlerDependencies,
	cmd: GetModelsCommand,
): Promise<void> {
	if (!deps.initialized || !deps.modelRegistry) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	const available = await deps.modelRegistry.getAvailable();
	const models = available.map((m: any) => ({
		id: m.id,
		name: m.name,
		provider: m.provider,
		reasoning: m.reasoning,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		input: Array.isArray(m.input) && m.input.length > 0 ? m.input : ["text"],
	}));
	sendMsg({ type: "result", id: cmd.id, data: { models } });
}

// ── get_active_model ───────────────────────────────────────────────────────

export async function handleGetActiveModel(
	deps: HandlerDependencies,
	cmd: GetActiveModelCommand,
): Promise<void> {
	const runtime = runtimeFor(deps, cmd);
	if (!runtime) return;
	const model = runtime.session.model
		? {
				provider: runtime.session.model.provider,
				id: runtime.session.model.id,
				name: runtime.session.model.name,
			}
		: null;
	sendMsg(makeSessionResult(cmd.id, cmd.sessionFile, { model, thinkingLevel: runtime.session.thinkingLevel ?? null }));
}

// ── prompt ─────────────────────────────────────────────────────────────────

export async function handlePrompt(
	deps: HandlerDependencies,
	cmd: PromptCommand,
): Promise<void> {
	const runtime = runtimeFor(deps, cmd);
	if (!runtime) {
		// runtimeFor already emitted the structured error; now terminate the
		// pending prompt channel so Tauri doesn't hang waiting for done.
		sendMsg(makeSessionDone(cmd.id, cmd.sessionFile));
		return;
	}
	runtime.promptScheduler.schedule(
		() => runPromptTask(cmd, runtime),
		(err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			log("prompt[%s] task error: %s", cmd.sessionFile, msg);
			sendMsg(makeSessionError(cmd.id, cmd.sessionFile, {
				code: "provider_error",
				message: msg,
				retryable: true,
			}));
			sendMsg(makeSessionDone(cmd.id, cmd.sessionFile));
		},
	);
}

// ── abort ──────────────────────────────────────────────────────────────────

export async function handleAbort(
	deps: HandlerDependencies,
	cmd: AbortCommand,
): Promise<void> {
	const runtime = runtimeFor(deps, cmd);
	if (!runtime) return;
	await runtime.session.abort();
	// The scheduler becomes idle only after runPromptTask's finally block
	// emits terminal `done`. Therefore an awaited abort result means no old
	// prompt terminal can race a new prompt or persistence deletion.
	await runtime.promptScheduler.idle();
	sendMsg(makeSessionResult(cmd.id, cmd.sessionFile, { aborted: true }));
}

// ── steer ──────────────────────────────────────────────────────────────────

export async function handleSteer(
	deps: HandlerDependencies,
	cmd: SteerCommand,
): Promise<void> {
	const runtime = runtimeFor(deps, cmd);
	if (!runtime) return;
	try {
		await runtime.session.steer(cmd.text, cmd.images);
		sendMsg(makeSessionResult(cmd.id, cmd.sessionFile, { queued: true }));
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "session_busy",
			message: msg,
			retryable: true,
		}));
	}
}

// ── follow_up ──────────────────────────────────────────────────────────────

export async function handleFollowUp(
	deps: HandlerDependencies,
	cmd: FollowUpCommand,
): Promise<void> {
	const runtime = runtimeFor(deps, cmd);
	if (!runtime) return;
	try {
		await runtime.session.followUp(cmd.text, cmd.images);
		sendMsg(makeSessionResult(cmd.id, cmd.sessionFile, { queued: true }));
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "session_busy",
			message: msg,
			retryable: true,
		}));
	}
}

// ── clear_queue ────────────────────────────────────────────────────────────

export async function handleClearQueue(
	deps: HandlerDependencies,
	cmd: ClearQueueCommand,
): Promise<void> {
	const runtime = runtimeFor(deps, cmd);
	if (!runtime) return;
	try {
		const drained = runtime.session.clearQueue();
		sendMsg(makeSessionResult(cmd.id, cmd.sessionFile, drained));
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "session_busy",
			message: msg,
			retryable: true,
		}));
	}
}

// ── ui_response ────────────────────────────────────────────────────────────

export async function handleUiResponse(
	deps: HandlerDependencies,
	cmd: UiResponseCommand,
): Promise<void> {
	deps.resolveUiResponse(cmd);
}

// ── set_model ──────────────────────────────────────────────────────────────

export async function handleSetModel(
	deps: HandlerDependencies,
	cmd: SetModelCommand,
): Promise<void> {
	const runtime = runtimeFor(deps, cmd);
	if (!runtime) return;
	try {
		const found = deps.modelRegistry.find(cmd.provider, cmd.model);
		if (!found) {
			log("set_model[%s]: NOT FOUND %s/%s", cmd.sessionFile, cmd.provider, cmd.model);
			sendMsg(makeSessionError(cmd.id, cmd.sessionFile, {
				code: "provider_error",
				message: `Model ${cmd.provider}/${cmd.model} not found`,
				retryable: false,
			}));
			return;
		}
		log("set_model[%s]: found %s/%s (id=%s)", cmd.sessionFile, cmd.provider, cmd.model, found.id);
		await runtime.session.setModel(found);
		const currentModel = runtime.session.model;
		log(
			"set_model[%s]: after setModel, session.model = %s/%s",
			cmd.sessionFile,
			currentModel?.provider,
			currentModel?.id,
		);
		sendMsg(makeSessionResult(cmd.id, cmd.sessionFile, { success: true }));
	} catch (err) {
		sendMsg(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "provider_error",
			message: err instanceof Error ? err.message : String(err),
			retryable: true,
		}));
	}
}

