import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ExtensionToolInfo {
	id: string;
	tools: string[];
	path: string;
}

interface SidecarExtensionsPayload {
	extensions: ExtensionToolInfo[];
}

/**
 * Hook that queries the sidecar for all loaded extensions and their tools.
 *
 * Automatically refreshes on mount and provides a refresh function.
 */
export function useExtensionTools() {
	const [tools, setTools] = useState<ExtensionToolInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [sidecarRunning, setSidecarRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			// Check if sidecar is running
			const running = await invoke<boolean>("sidecar_status");
			setSidecarRunning(running);

			if (running) {
				const result =
					await invoke<SidecarExtensionsPayload>("list_extension_tools");
				setTools(result.extensions ?? []);
			} else {
				setTools([]);
			}
		} catch (err) {
			console.error("[cowork] Failed to load extension tools:", err);
			setError(String(err));
			setTools([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;

	return {
		tools,
		loading,
		sidecarRunning,
		error,
		refresh,
	};
}
