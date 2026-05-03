import type { ConfigPayload, ModelInfo } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

/** Custom event fired when config should be reloaded (e.g., after saving an API key). */
const CONFIG_RELOAD_EVENT = "config-reload";

export function useProviders() {
	const [config, setConfig] = useState<ConfigPayload | null>(null);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const payload = await invoke<ConfigPayload>("list_providers");
			setConfig(payload);
		} catch (err) {
			console.error("Failed to load providers:", err);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Listen for config reload events (e.g., after saving an API key)
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;

	useEffect(() => {
		function handleConfigReload() {
			refreshRef.current();
		}
		window.addEventListener(CONFIG_RELOAD_EVENT, handleConfigReload);
		return () => window.removeEventListener(CONFIG_RELOAD_EVENT, handleConfigReload);
	}, []);

	const setModel = useCallback(
		async (sessionId: string, provider: string, modelId: string) => {
			await invoke("set_active_model", {
				payload: { sessionId, provider, modelId },
			});
			await refresh();
		},
		[refresh],
	);

	const modelsForProvider = useCallback(
		(providerId: string): ModelInfo[] => {
			if (!config) return [];
			return config.models.filter((m) => m.provider === providerId);
		},
		[config],
	);

	return {
		config,
		providers: config?.providers ?? [],
		loading,
		refresh,
		setModel,
		modelsForProvider,
	};
}
