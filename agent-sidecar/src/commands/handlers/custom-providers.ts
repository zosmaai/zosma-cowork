/**
 * Custom provider command handlers: list_custom_providers, save_custom_provider,
 * delete_custom_provider, test_custom_provider_connection
 */

import { join } from "node:path";
import { send as sendMsg, log } from "../../protocol.js";
import { piAgentDir } from "../../agent-init.js";
import type { HandlerDependencies } from "../handler-registry.js";

function modelsPath(): string {
	return join(piAgentDir(), "models.json");
}

export async function handleListCustomProviders(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { listCustomProviders } = await import("../../custom-providers.js");
		const providers = listCustomProviders(modelsPath());
		sendMsg({ type: "result", id: cmd.id, data: { providers } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleSaveCustomProvider(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { saveCustomProvider, discoverModels } = await import("../../custom-providers.js");
		let provider = { ...cmd.provider };

		// Empty models array = contract with the frontend: "auto-discover from server".
		// Call discoverModels() before validating, then inject the discovered ids.
		if (!Array.isArray(provider.models) || provider.models.length === 0) {
			const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
			const apiKey = typeof provider.apiKey === "string" && provider.apiKey.trim() ? provider.apiKey.trim() : undefined;

			if (baseUrl.length > 0) {
				const result = await discoverModels(baseUrl, apiKey, { timeoutMs: 10000 });
				if (result.models.length > 0) {
					// Inject discovered capability metadata into model entries
					const caps = result.modelCapabilities ?? {};
					provider.models = result.models.map((id: string) => ({
						id,
						...(caps[id] ? { input: caps[id] } : {}),
					}));
				} else {
					// Frontend expects NO_MODELS_DISCOVERED prefix so it can show manual entry
					const parts = ["NO_MODELS_DISCOVERED"];
					parts.push(result.reachable ? "reachable" : "unreachable");
					if (result.status !== undefined) parts.push(String(result.status));
					sendMsg({ type: "error", id: cmd.id, message: parts.join(":") });
					return;
				}
			}
		}

		const result = saveCustomProvider(modelsPath(), provider);
		sendMsg({ type: "result", id: cmd.id, data: result });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleDeleteCustomProvider(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { deleteCustomProvider } = await import("../../custom-providers.js");
		deleteCustomProvider(modelsPath(), cmd.providerId);
		sendMsg({ type: "result", id: cmd.id, data: { deleted: true } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleTestCustomProviderConnection(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const baseUrl = (cmd.baseUrl as string)?.replace(/\/+$/, "");
		const apiKey = (cmd.apiKey as string)?.trim();
		const hasRealKey = apiKey != null && apiKey.length > 0;

		log("Testing custom provider connection: %s", baseUrl);

		// Reuse the same discovery logic as the Save path so Test and Save
		// agree on endpoints and behavior. Use a short timeout so it feels
		// like a quick connectivity check.
		const { discoverModels } = await import("../../custom-providers.js");
		const result = await discoverModels(baseUrl, apiKey || undefined, { timeoutMs: 8000 });

		if (!result.reachable) {
			sendMsg({
				type: "result",
				id: cmd.id,
				data: {
					reachable: false,
					message: "Could not connect to that endpoint.",
					models: [],
				},
			});
			return;
		}

		if (result.models.length > 0) {
			// Happy path: server returned models
			const models = result.models.slice(0, 20).map((id) => ({ id }));
			sendMsg({
				type: "result",
				id: cmd.id,
				data: {
					reachable: true,
					ok: true,
					message: `Connected. Found ${result.models.length} model(s).`,
					models,
				},
			});
			return;
		}

		// Reachable but no models. Differentiate auth vs "no /models".
		if (result.status === 401 && !hasRealKey) {
			sendMsg({
				type: "result",
				id: cmd.id,
				data: {
					reachable: true,
					ok: true,
					message: "Connected, but models require an API key.",
					models: [],
				},
			});
			return;
		}

		if (result.status === 401 && hasRealKey) {
			sendMsg({
				type: "result",
				id: cmd.id,
				data: {
					reachable: true,
					ok: false,
					message: "Connected, but your API key was rejected (401).",
					models: [],
				},
			});
			return;
		}

		// Other non-200 or no models endpoint
		const hint = result.status
			? ` (HTTP ${result.status})`
			: "";
		sendMsg({
			type: "result",
			id: cmd.id,
			data: {
				reachable: true,
				ok: true,
				message: `Endpoint is reachable, but no models were discovered${hint}. You can still try saving it.`,
				models: [],
			},
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}
