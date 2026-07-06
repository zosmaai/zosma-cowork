/**
 * Ensure @zosmaai/pi-blog is installed in the Pi sidecar.
 *
 * Runs once when the sidecar becomes ready. If the extension is absent from
 * the installed list it is installed automatically from npm — no user action
 * required. Errors are logged but never surfaced to the UI (non-blocking).
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";

const EXTENSION_ID = "@zosmaai/pi-blog";
const EXTENSION_SOURCE = "npm:@zosmaai/pi-blog";

interface ExtensionEntry {
	id: string;
	enabled: boolean;
}

export function useBlogExtension(sidecarReady: boolean): void {
	useEffect(() => {
		if (!sidecarReady || !isTauri()) return;

		async function ensureInstalled() {
			try {
				const extensions = await invoke<ExtensionEntry[]>("list_extensions");
				const found = extensions.some((e) => e.id === EXTENSION_ID);

				if (found) {
					console.log("[blog] @zosmaai/pi-blog already installed ✓");
					return;
				}

				console.log("[blog] @zosmaai/pi-blog not found — installing from npm...");
				await invoke("install_extension", { source: EXTENSION_SOURCE, refName: null });
				console.log("[blog] @zosmaai/pi-blog installed successfully ✓");
			} catch (err) {
				// Non-fatal: blog commands still work if the extension is already
				// installed via `pi install` outside of Cowork.
				console.warn("[blog] Could not auto-install @zosmaai/pi-blog:", err);
			}
		}

		void ensureInstalled();
	}, [sidecarReady]);
}
