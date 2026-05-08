import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export function useAuth() {
	const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const result = await invoke<boolean>("has_credentials");
			setHasCredentials(result);
		} catch {
			setHasCredentials(false);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const saveApiKey = useCallback(
		async (apiKey: string) => {
			await invoke("save_auth_key", { provider: "opencode-go", key: apiKey });
			await refresh();
			// Notify providers hook to reload models
			window.dispatchEvent(new CustomEvent("config-reload"));
		},
		[refresh],
	);

	return { hasCredentials, loading, saveApiKey };
}
