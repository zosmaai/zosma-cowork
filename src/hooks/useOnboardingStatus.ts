/**
 * useOnboardingStatus — non-secret startup classification hook.
 *
 * Queries the sidecar's get_onboarding_status command and exposes:
 * - status: OnboardingStatus | null
 * - loading: boolean
 * - refresh: () => Promise<void>
 *
 * Rules:
 * - Never expose credentials.
 * - Preserve last known status on transient failures.
 * - Avoid duplicate listeners under StrictMode/HMR.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OnboardingStatus } from "@/types/auth";

export interface UseOnboardingStatusResult {
	status: OnboardingStatus | null;
	loading: boolean;
	refresh: () => Promise<void>;
}

export function useOnboardingStatus(): UseOnboardingStatusResult {
	const [status, setStatus] = useState<OnboardingStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const mountedRef = useRef(true);
	const unlistenRef = useRef<(() => void) | null>(null);
	const retryRef = useRef(0);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const fetchStatus = useCallback(async () => {
		if (!mountedRef.current) return;
		try {
			const result = (await invoke<OnboardingStatus>("get_onboarding_status")) as OnboardingStatus;
			if (!mountedRef.current) return;
			setStatus(result);
			setLoading(false);
			retryRef.current = 0;
		} catch {
			// Sidecar may still be booting. Keep retrying with bounded backoff until it
			// resolves (the splash is gated on this status, so giving up strands it).
			if (mountedRef.current) {
				retryRef.current += 1;
				const delay = Math.min(500 * retryRef.current, 3000);
				retryTimerRef.current = setTimeout(fetchStatus, delay);
			}
		}
	}, []);

	// Initial fetch
	useEffect(() => {
		mountedRef.current = true;
		let unlisten: (() => void) | undefined;

		const setup = async () => {
			// Fetch immediately
			retryRef.current = 0;
			await fetchStatus();

			// Re-fetch on sidecar "ready" and "config-reload"
			const u = await listen("ready", () => fetchStatus());
			if (!mountedRef.current) {
				u();
				return;
			}
			unlistenRef.current = u;
			unlisten = u;
		};

		(async () => {
			await setup();
		})().catch(() => {
			// Non-critical: startup hook failed to initialize.
		});

		// Also listen for config-reload (auth changes, providers added/removed)
		const onReload = () => fetchStatus();
		window.addEventListener("config-reload", onReload);

		return () => {
			mountedRef.current = false;
			if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
			unlisten?.();
			unlistenRef.current = null;
			window.removeEventListener("config-reload", onReload);
		};
	}, [fetchStatus]);

	const refresh = useCallback(async () => {
		await fetchStatus();
	}, [fetchStatus]);

	return { status, loading, refresh };
}
