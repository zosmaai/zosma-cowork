/**
 * Auth command handlers: save_auth, validate_provider_key, 
 * start_oauth, cancel_oauth, logout, get_auth_status
 */

import { send as sendMsg, log } from "../../protocol.js";
import type { HandlerDependencies } from "../handler-registry.js";

export async function handleSaveAuth(deps: HandlerDependencies, cmd: any): Promise<void> {
	if (!deps.initialized || !deps.authStorage || !deps.modelRegistry) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	try {
		deps.authStorage.set(cmd.provider, { type: "api_key", key: cmd.key });
		deps.modelRegistry.refresh();
		const models = await deps.modelRegistry.getAvailable();
		sendMsg({
			type: "result",
			id: cmd.id,
			data: {
				success: true,
				provider: cmd.provider,
				modelCount: models.length,
			},
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleValidateProviderKey(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { validateProviderKey } = await import("../../providers/key-validator.js");
		const result = await validateProviderKey(cmd.provider, cmd.key);
		sendMsg({ type: "result", id: cmd.id, data: result });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleStartOAuth(deps: HandlerDependencies, cmd: any): Promise<void> {
	if (!deps.initialized || !deps.authStorage || !deps.modelRegistry) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	try {
		const provider = cmd.provider as string;

		if (provider === "gemini-antigravity") {
			sendMsg({ type: "error", id: cmd.id, message: "Use 'Connect Google' for Gemini access." });
			return;
		}

		if (deps.oauthAbort) {
			deps.oauthAbort.abort();
		}
		const abort = new AbortController();
		deps.setOauthAbort(abort);

		const runOAuth = async () => {
			try {
				const result = await deps.authStorage!.login(provider, {
					signal: abort.signal,
				} as any);
				sendMsg({ type: "event", event: { type: "oauth_result", provider, ...result } });
				deps.modelRegistry!.refresh();
				sendMsg({ type: "event", event: { type: "oauth_complete", provider } });
			} catch (err: unknown) {
				if (abort.signal.aborted) return;
				const message = err instanceof Error ? err.message : String(err);
				sendMsg({ type: "event", event: { type: "oauth_error", provider, message } });
			} finally {
				deps.setOauthInflight(null);
			}
		};
		const inflight = runOAuth();
		deps.setOauthInflight(inflight);

		sendMsg({ type: "result", id: cmd.id, data: { started: true, provider } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleCancelOAuth(deps: HandlerDependencies, cmd: any): Promise<void> {
	if (deps.oauthAbort) {
		deps.oauthAbort.abort();
		deps.setOauthAbort(null);
	}
	sendMsg({ type: "result", id: cmd.id, data: { cancelled: true } });
}

export async function handleLogout(deps: HandlerDependencies, cmd: any): Promise<void> {
	if (!deps.initialized || !deps.authStorage || !deps.modelRegistry || !deps.sessionManager) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	try {
		const provider = cmd.provider as string;

		if (provider === "openai-codex") {
			try {
				const { loginOpenAICodex } = await import("@earendil-works/pi-ai/oauth");
				await (loginOpenAICodex as any).logout();
			} catch {
				// Fallback to standard logout
			}
		}

		deps.authStorage.remove(provider);
		deps.modelRegistry.refresh();
		sendMsg({ type: "result", id: cmd.id, data: { success: true, provider } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleGetAuthStatus(deps: HandlerDependencies, cmd: any): Promise<void> {
	if (!deps.initialized || !deps.authStorage) {
		sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
		return;
	}
	try {
		// Manually build auth status — AuthStorage has no .status() method.
		// Mirrors the original monolithic index.ts logic.
		const providers: Array<{
			id: string;
			type: "api_key" | "oauth" | "unknown";
			expires?: number;
		}> = [];
		for (const providerId of deps.authStorage.list()) {
			const cred = deps.authStorage.get(providerId);
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

		let supported: string[] = [];
		try {
			supported = deps.authStorage.getOAuthProviders().map((p: { id: string }) => p.id);
		} catch {
			// older SDKs may not expose this — fail soft
		}

		let apiKeyProviders: Array<{ id: string; displayName: string }> = [];
		try {
			if (!deps.modelRegistry) throw new Error("model registry not ready");
			const seen = new Set<string>();
			for (const m of deps.modelRegistry.getAll()) {
				if (seen.has(m.provider)) continue;
				seen.add(m.provider);
				apiKeyProviders.push({
					id: m.provider,
					displayName:
						(deps.modelRegistry as any).getProviderDisplayName?.(m.provider) ?? m.provider,
				});
			}
			apiKeyProviders.sort((a, b) => a.displayName.localeCompare(b.displayName));
		} catch {
			// fail soft — UI will fall back to a freeform input
			apiKeyProviders = [];
		}

		sendMsg({
			type: "result",
			id: cmd.id,
			data: { providers, supported, apiKeyProviders },
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}
