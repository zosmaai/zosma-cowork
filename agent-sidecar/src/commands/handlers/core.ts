/**
 * Zosma Content CoWork — Core Command Handlers
 *
 * Handles: init, get_models, get_active_model, prompt, abort, steer,
 * follow_up, clear_queue, ui_response, set_model
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
import type { HandlerDependencies } from "../handler-registry.js";

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
	}));
	sendMsg({ type: "result", id: cmd.id, data: { models } });
}

// ── get_active_model ───────────────────────────────────────────────────────

export async function handleGetActiveModel(
	deps: HandlerDependencies,
	cmd: GetActiveModelCommand,
): Promise<void> {
	if (!deps.initialized || !deps.session) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	const model = deps.session.model
		? {
				provider: deps.session.model.provider,
				id: deps.session.model.id,
				name: deps.session.model.name,
			}
		: null;
	sendMsg({
		type: "result",
		id: cmd.id,
		data: { model, thinkingLevel: deps.session.thinkingLevel ?? null },
	});
}

// ── prompt ─────────────────────────────────────────────────────────────────

export async function handlePrompt(
	deps: HandlerDependencies,
	cmd: PromptCommand,
): Promise<void> {
	if (!deps.initialized || !deps.session) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	deps.promptScheduler.schedule(
		() => runPromptTask(cmd, deps.session, deps.zosmaDir, deps.workspaceCwd),
		(err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			log("prompt task error: %s", msg);
			sendMsg({ type: "error", id: cmd.id, message: msg });
			sendMsg({ type: "done", id: cmd.id });
		},
	);
}

// ── abort ──────────────────────────────────────────────────────────────────

export async function handleAbort(
	deps: HandlerDependencies,
	cmd: AbortCommand,
): Promise<void> {
	if (deps.session) {
		deps.session.abort();
	}
	sendMsg({ type: "result", id: cmd.id, data: { aborted: true } });
}

// ── steer ──────────────────────────────────────────────────────────────────

export async function handleSteer(
	deps: HandlerDependencies,
	cmd: SteerCommand,
): Promise<void> {
	if (!deps.initialized || !deps.session) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	try {
		await deps.session.steer(cmd.text, cmd.images);
		sendMsg({ type: "result", id: cmd.id, data: { queued: true } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

// ── follow_up ──────────────────────────────────────────────────────────────

export async function handleFollowUp(
	deps: HandlerDependencies,
	cmd: FollowUpCommand,
): Promise<void> {
	if (!deps.initialized || !deps.session) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	try {
		await deps.session.followUp(cmd.text, cmd.images);
		sendMsg({ type: "result", id: cmd.id, data: { queued: true } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

// ── clear_queue ────────────────────────────────────────────────────────────

export async function handleClearQueue(
	deps: HandlerDependencies,
	cmd: ClearQueueCommand,
): Promise<void> {
	if (!deps.initialized || !deps.session) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	try {
		const drained = deps.session.clearQueue();
		sendMsg({ type: "result", id: cmd.id, data: { drained } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
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
	if (!deps.initialized || !deps.session || !deps.modelRegistry) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	try {
		const found = deps.modelRegistry.find(cmd.provider, cmd.model);
		if (!found) {
			log("set_model: NOT FOUND %s/%s", cmd.provider, cmd.model);
			sendMsg({
				type: "error",
				id: cmd.id,
				message: `Model ${cmd.provider}/${cmd.model} not found`,
			});
			return;
		}
		log("set_model: found %s/%s (id=%s)", cmd.provider, cmd.model, found.id);
		await (deps.session as any).setModel(found);
		const currentModel = deps.session.model;
		log(
			"set_model: after setModel, session.model = %s/%s",
			currentModel?.provider,
			currentModel?.id,
		);
		sendMsg({ type: "result", id: cmd.id, data: { success: true } });
	} catch (err) {
		sendMsg({
			type: "error",
			id: cmd.id,
			message: err instanceof Error ? err.message : String(err),
		});
	}
}

