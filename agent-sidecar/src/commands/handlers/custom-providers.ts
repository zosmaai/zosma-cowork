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
		const { saveCustomProvider } = await import("../../custom-providers.js");
		const result = saveCustomProvider(modelsPath(), cmd.provider);
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
		const testKey = (cmd.apiKey as string) || "test-key";

		log("Testing custom provider connection: %s", baseUrl);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10_000);

		try {
			const res = await fetch(`${baseUrl}/models`, {
				headers: { Authorization: `Bearer ${testKey}` },
				signal: controller.signal,
			});
			clearTimeout(timeout);

			if (res.ok) {
				const body: any = await res.json();
				const models = (body.data || body.models || [])
					.slice(0, 20)
					.map((m: { id: string; name?: string }) => ({ id: m.id, name: m.name || m.id }));
				sendMsg({ type: "result", id: cmd.id, data: { reachable: true, models } });
			} else {
				const text = await res.text();
				sendMsg({
					type: "result",
					id: cmd.id,
					data: {
						reachable: true,
						error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
						models: [],
					},
				});
			}
		} catch (fetchErr) {
			clearTimeout(timeout);
			sendMsg({
				type: "result",
				id: cmd.id,
				data: {
					reachable: false,
					error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
					models: [],
				},
			});
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}
