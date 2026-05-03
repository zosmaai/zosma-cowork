import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

/** A built-in provider available for API key authentication. */
export interface AuthProviderPreset {
	id: string;
	name: string;
	recommended?: boolean;
	description: string;
	apiKeyHint: string;
	signupUrl?: string;
}

/** Well-known providers with API key auth, ordered by recommendation. */
export const AUTH_PROVIDERS: AuthProviderPreset[] = [
	{
		id: "crofai",
		name: "Crof AI",
		recommended: true,
		description: "All-in-one AI gateway — access top models through one API key",
		apiKeyHint: "nahcrof_...",
		signupUrl: "https://crof.ai",
	},
	{
		id: "opencode-go",
		name: "OpenCode Go",
		recommended: true,
		description: "Budget-friendly aggregator — $5 first month, then $10/mo",
		apiKeyHint: "sk-...",
		signupUrl: "https://opencode.go",
	},
	{
		id: "openai",
		name: "OpenAI",
		description: "GPT-4o, o3, o4-mini and more",
		apiKeyHint: "sk-...",
		signupUrl: "https://platform.openai.com/api-keys",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Claude Sonnet 4, Haiku 3.5, Opus 4",
		apiKeyHint: "sk-ant-...",
		signupUrl: "https://console.anthropic.com/settings/keys",
	},
	{
		id: "google",
		name: "Google Gemini",
		description: "Gemini 2.5 Pro, Flash, and more",
		apiKeyHint: "AIza...",
		signupUrl: "https://aistudio.google.com/apikey",
	},
	{
		id: "groq",
		name: "Groq",
		description: "Ultra-fast inference for Llama, Mixtral, Gemma",
		apiKeyHint: "gsk_...",
		signupUrl: "https://console.groq.com/keys",
	},
	{
		id: "together",
		name: "Together AI",
		description: "DeepSeek, Qwen, Llama hosted models",
		apiKeyHint: "tgpv...",
		signupUrl: "https://api.together.xyz/settings/api-keys",
	},
	{
		id: "xai",
		name: "xAI",
		description: "Grok 3, Grok 3 Mini",
		apiKeyHint: "xai-...",
		signupUrl: "https://console.x.ai/",
	},
];

/** Hook to manage provider API key authentication. */
export function useAuth() {
	const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
	const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const [hasKeys, providers] = await Promise.all([
				invoke<boolean>("has_any_credentials"),
				invoke<string[]>("list_auth_providers"),
			]);
			setHasCredentials(hasKeys);
			setConfiguredProviders(providers);
		} catch (err) {
			console.error("[cowork] Failed to load auth status:", err);
			setHasCredentials(false);
			setConfiguredProviders([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const saveApiKey = useCallback(
		async (providerId: string, apiKey: string) => {
			await invoke("save_auth_key", { providerId, apiKey });

			// Refresh auth status and notify providers to reload config
			await refresh();
			window.dispatchEvent(new Event("config-reload"));
		},
		[refresh],
	);

	return {
		hasCredentials,
		configuredProviders,
		loading,
		refresh,
		saveApiKey,
	};
}
