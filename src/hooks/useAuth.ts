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

	// Retry credentials check a few times if the initial check fails.
	// Handles the race where has_credentials fires before the sidecar's
	// init confirms auth storage is fully loaded.
	useEffect(() => {
		let retries = 0;
		const maxRetries = 5;
		let cancelled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		const retry = () => {
			if (cancelled) return;
			invoke<boolean>("has_credentials")
				.then((r) => {
					if (cancelled) return;
					if (r) {
						setHasCredentials(true);
					} else if (++retries < maxRetries) {
						timeout = setTimeout(retry, 1000);
					}
				})
				.catch(() => {
					if (cancelled) return;
					if (++retries < maxRetries) {
						timeout = setTimeout(retry, 2000);
					}
				});
		};

		// Also re-check on the "ready" event from the sidecar
		let unlisten: (() => void) | undefined;
		(async () => {
			const u = await listen("ready", () => retry());
			if (!cancelled) unlisten = u;
			else u();
		})();

		// Retry after a short delay if initial check was false
		timeout = setTimeout(retry, 500);

		return () => {
			cancelled = true;
			clearTimeout(timeout);
			unlisten?.();
		};
	}, []);

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

	/**
	 * Save an API key under the supplied pi-mono provider id.
	 *
	 * Caller MUST pass the provider the key belongs to (e.g. `openrouter`,
	 * `anthropic`, `openai`). Previously this hardcoded `opencode-go`, which
	 * mis-routed every key the user pasted (issue #150).
	 */
	const saveApiKey = useCallback(
		async (provider: string, apiKey: string) => {
			const providerId = provider.trim();
			if (!providerId) {
				throw new Error("provider is required");
			}
			await invoke("save_auth_key", { provider: providerId, key: apiKey });
			await refresh();
			// Notify providers hook to reload models
			window.dispatchEvent(new CustomEvent("config-reload"));
		},
		[refresh],
	);

	return { hasCredentials, loading, saveApiKey };
}
