import { type InstallContext, type UpdatePolicy, resolveUpdatePolicy } from "@/lib/updateChannel";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * In-app auto-update orchestration (issue #271).
 *
 * Wraps the Tauri v2 updater (`@tauri-apps/plugin-updater`) and process
 * (`@tauri-apps/plugin-process`) plugins behind a small state machine so the UI
 * (launch banner + Settings → About) can drive the whole flow without touching
 * plugin internals.
 *
 * Channel policy (Homebrew / AUR / Winget / .deb installs) is enforced via
 * `resolveUpdatePolicy` — managed builds surface a notice instead of
 * self-updating.
 */

export type UpdateStatus =
	| "idle"
	| "checking"
	| "available"
	| "managed"
	| "uptodate"
	| "downloading"
	| "restarting"
	| "error";

export interface UpdateInfo {
	version: string;
	currentVersion: string;
	notes?: string;
}

export interface UseAppUpdateOptions {
	/** When false, never checks (used to disable in dev). Defaults to prod-only. */
	enabled?: boolean;
	/** Delay before the automatic launch check fires. Defaults to 10s. */
	autoCheckDelayMs?: number;
}

export interface UseAppUpdate {
	status: UpdateStatus;
	info: UpdateInfo | null;
	progress: number;
	policy: UpdatePolicy | null;
	error: string | null;
	checkNow: () => Promise<void>;
	installAndRestart: () => Promise<void>;
	dismiss: () => void;
}

interface UpdateHandle {
	version: string;
	currentVersion: string;
	body?: string;
	downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void>;
}

interface DownloadEvent {
	event: "Started" | "Progress" | "Finished";
	data?: { contentLength?: number; chunkLength?: number };
}

const DEFAULT_DELAY_MS = 10_000;

async function loadInstallContext(): Promise<InstallContext> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<InstallContext>("get_install_context");
}

export function useAppUpdate(options: UseAppUpdateOptions = {}): UseAppUpdate {
	const enabled = options.enabled ?? !import.meta.env.DEV;
	const delayMs = options.autoCheckDelayMs ?? DEFAULT_DELAY_MS;

	const [status, setStatus] = useState<UpdateStatus>("idle");
	const [info, setInfo] = useState<UpdateInfo | null>(null);
	const [progress, setProgress] = useState(0);
	const [policy, setPolicy] = useState<UpdatePolicy | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Hold the live Update handle so installAndRestart can act on the same
	// instance returned by check().
	const updateRef = useRef<UpdateHandle | null>(null);

	const runCheck = useCallback(async () => {
		setStatus("checking");
		setError(null);
		try {
			const ctx = await loadInstallContext();
			const resolved = resolveUpdatePolicy(ctx);
			setPolicy(resolved);

			const { check } = await import("@tauri-apps/plugin-updater");
			const update = (await check()) as UpdateHandle | null;

			if (!update) {
				updateRef.current = null;
				setInfo(null);
				setStatus("uptodate");
				return;
			}

			updateRef.current = update;
			setInfo({
				version: update.version,
				currentVersion: update.currentVersion,
				notes: update.body,
			});
			setStatus(resolved.canSelfUpdate ? "available" : "managed");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}, []);

	const installAndRestart = useCallback(async () => {
		const update = updateRef.current;
		if (!update) return;
		setStatus("downloading");
		setProgress(0);
		setError(null);
		try {
			let total = 0;
			let downloaded = 0;
			await update.downloadAndInstall((event) => {
				if (event.event === "Started") {
					total = event.data?.contentLength ?? 0;
				} else if (event.event === "Progress") {
					downloaded += event.data?.chunkLength ?? 0;
					if (total > 0) {
						setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
					}
				} else if (event.event === "Finished") {
					setProgress(100);
				}
			});
			setStatus("restarting");
			const { relaunch } = await import("@tauri-apps/plugin-process");
			await relaunch();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}, []);

	const dismiss = useCallback(() => {
		setStatus("idle");
	}, []);

	// Automatic launch check, off the critical path.
	useEffect(() => {
		if (!enabled) return;
		const timer = setTimeout(() => {
			void runCheck();
		}, delayMs);
		return () => clearTimeout(timer);
	}, [enabled, delayMs, runCheck]);

	return {
		status,
		info,
		progress,
		policy,
		error,
		checkNow: runCheck,
		installAndRestart,
		dismiss,
	};
}
