import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

	// Re-check credentials when sidecar becomes ready
	// (avoids race where initial check runs before sidecar initializes)
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		(async () => {
			unlisten = await listen("ready", () => {
				refresh();
			});
		})();
		return () => {
			unlisten?.();
		};
	}, [refresh]);

	// Re-check on any provider auth change. ProviderAuthSection dispatches
	// `config-reload` after a successful OAuth sign-in (and on sign-out),
	// and `saveApiKey` dispatches it too. Listening here means a subscription
	// sign-in flips `hasCredentials` immediately without waiting for the
	// post-OAuth `initAgent` reload to emit a fresh `ready` event.
	useEffect(() => {
		function handle() {
			refresh();
		}
		window.addEventListener("config-reload", handle);
		return () => window.removeEventListener("config-reload", handle);
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
