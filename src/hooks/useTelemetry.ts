/**
 * Zosma Cowork — useTelemetry hook
 *
 * Manages telemetry consent state, synchronized with:
 * 1. Rust-side TelemetryState (via set_telemetry_enabled IPC)
 * 2. Settings persistence (via save_settings IPC)
 * 3. Frontend telemetry service gating (Aptabase + Sentry)
 */

import {
	initTelemetry as initTelemetryService,
	trackEvent as serviceTrackEvent,
	setSentryDsn,
	setTelemetryEnabled as setServiceTelemetryEnabled,
} from "@/lib/telemetry";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseTelemetryReturn {
	isEnabled: boolean;
	enable: () => Promise<void>;
	disable: () => Promise<void>;
	trackEvent: (name: string, props?: Record<string, string | number>) => void;
}

export function useTelemetry(): UseTelemetryReturn {
	const [isEnabled, setIsEnabled] = useState(false);
	// Track whether the user has made an explicit choice via enable()/disable().
	// Prevents the async settings-load response from overriding the user's
	// choice when it arrives after they've already clicked enable/disable.
	const userMadeChoice = useRef(false);

	// Load initial state from settings on mount
	useEffect(() => {
		let cancelled = false;

		// Configure Sentry DSN from env (set in CI or .env)
		const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
		if (dsn) {
			setSentryDsn(dsn);
		}

		invoke<{ telemetry?: { enabled?: boolean } }>("get_settings")
			.then(async (settings) => {
				if (cancelled) return;
				// Determine the effective enabled state from settings
				const enabledFromSettings = settings?.telemetry?.enabled ?? false;
				// Don't override if the user already made an explicit choice
				// (e.g., clicked Enable Telemetry on the consent dialog before
				// the async get_settings call returned).
				if (!userMadeChoice.current) {
					setIsEnabled(enabledFromSettings);
					await initTelemetryService(enabledFromSettings);
				}
				// If userMadeChoice is true, enable()/disable() already called
				// setServiceTelemetryEnabled() and initTelemetryService().
				// Do NOT call them again here — a stale closure would use the
				// wrong (initial) isEnabled value and override the user's choice.
			})
			.catch(async () => {
				// Settings not available yet — default to disabled
				if (!cancelled && !userMadeChoice.current) {
					setIsEnabled(false);
					await initTelemetryService(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const enable = useCallback(async () => {
		userMadeChoice.current = true;
		setIsEnabled(true);
		setServiceTelemetryEnabled(true);
		try {
			await invoke("set_telemetry_enabled", { enabled: true });
			await invoke("save_settings", { settings: { telemetry: { enabled: true } } });
		} catch {
			// Silently fail — telemetry should not block the app
		}
	}, []);

	const disable = useCallback(async () => {
		userMadeChoice.current = true;
		setIsEnabled(false);
		setServiceTelemetryEnabled(false);
		try {
			await invoke("set_telemetry_enabled", { enabled: false });
			await invoke("save_settings", { settings: { telemetry: { enabled: false } } });
		} catch {
			// Silently fail
		}
	}, []);

	const trackEvent = useCallback((name: string, props?: Record<string, string | number>) => {
		serviceTrackEvent(name, props);
	}, []);

	return {
		isEnabled,
		enable,
		disable,
		trackEvent,
	};
}
