import type { ModelInfo } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export function useProviders() {
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const result: ModelInfo[] = await invoke("get_models");
			setModels(Array.isArray(result) ? result : []);
		} catch (err) {
			console.error("Failed to load models:", err);
			setModels([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;

	useEffect(() => {
		function handleReload() {
			refreshRef.current();
		}
		window.addEventListener("config-reload", handleReload);
		return () => window.removeEventListener("config-reload", handleReload);
	}, []);

	const setModel = useCallback(async (provider: string, modelId: string) => {
		await invoke("set_active_model", { provider, model: modelId });
	}, []);

	const modelsForProvider = useCallback(
		(providerId: string): ModelInfo[] => {
			return models.filter((m) => m.provider === providerId);
		},
		[models],
	);

	const providers = Array.from(new Set(models.map((m) => m.provider))).map((id) => ({
		id,
		name: id.charAt(0).toUpperCase() + id.slice(1),
		api: "",
		modelCount: models.filter((m) => m.provider === id).length,
	}));

	return {
		models,
		providers,
		loading,
		refresh,
		setModel,
		modelsForProvider,
	};
}
