/**
 * Settings / Instructions command handlers: get_settings, save_settings,
 * get_instructions, save_instructions
 */

import { send, log } from "../../protocol.js";
import type { HandlerDependencies } from "../handler-registry.js";
import { zosmaAgentDir, loadSettings, saveSettingsAtDir } from "../../agent-init.js";
import { loadInstructions, saveInstructions } from "../../instructions-store.js";

export async function handleGetSettings(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const settings = loadSettings(deps.zosmaDir);
		send({ type: "result", id: cmd.id, data: { settings } });
	} catch (err) {
		send({
			type: "error",
			id: cmd.id,
			message: err instanceof Error ? err.message : String(err),
		});
	}
}

export async function handleSaveSettings(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { id: _sid, type: _t, ...rest } = cmd as Record<string, unknown>;
		saveSettingsAtDir(deps.zosmaDir, rest);
		send({ type: "result", id: cmd.id, data: { success: true } });
	} catch (err) {
		send({
			type: "error",
			id: cmd.id,
			message: err instanceof Error ? err.message : String(err),
		});
	}
}

export async function handleGetInstructions(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const content = loadInstructions(zosmaAgentDir(deps.zosmaDir));
		send({ type: "result", id: cmd.id, data: { content } });
	} catch (err) {
		send({
			type: "error",
			id: cmd.id,
			message: err instanceof Error ? err.message : String(err),
		});
	}
}

export async function handleSaveInstructions(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		saveInstructions(zosmaAgentDir(deps.zosmaDir), cmd.content ?? "");
		try {
			if (deps.session) await deps.session.reload();
		} catch (reloadErr) {
			log(
				"save_instructions: session.reload() failed (applies on next new chat): %s",
				reloadErr instanceof Error ? reloadErr.message : String(reloadErr),
			);
		}
		send({ type: "result", id: cmd.id, data: { success: true } });
	} catch (err) {
		send({
			type: "error",
			id: cmd.id,
			message: err instanceof Error ? err.message : String(err),
		});
	}
}
