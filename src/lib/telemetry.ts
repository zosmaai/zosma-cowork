/**
 * Zosma Cowork — Telemetry service
 *
 * Anonymous usage analytics via our in-house analytics IPC
 * (replaces the buggy tauri-plugin-aptabase) and Sentry crash reporting.
 * All calls are no-ops unless consent has been explicitly given via
 * initTelemetry() / setTelemetryEnabled().
 *
 * Sentry is loaded lazily (dynamic import) so its bundle is only fetched
 * when the user opts in. The Sentry DSN is configured via the SENTRY_DSN
 * build-time constant, or via setSentryDsn() at runtime.
 *
 * This module must never throw — telemetry failures must not break the app.
 */

import { invoke } from "@tauri-apps/api/core";

let enabled = false;
let sentryInitialized = false;
let sentryDsn = "";

/**
 * Set the Sentry DSN at runtime. Called early in app startup.
 * In production builds, this is set from VITE_SENTRY_DSN env var.
 */
export function setSentryDsn(dsn: string): void {
	sentryDsn = dsn;
}

/**
 * Reset telemetry state (primarily for testing).
 * Clears the Sentry-initialized flag so tests start clean.
 */
export function resetTelemetry(): void {
	sentryInitialized = false;
	enabled = false;
}

export async function initTelemetry(isEnabled: boolean): Promise<void> {
	enabled = isEnabled;

	if (isEnabled) {
		await initSentry();
	}
}

export function setTelemetryEnabled(isEnabled: boolean): void {
	enabled = isEnabled;
	// Sync the enabled state to the Rust backend
	void invoke("set_analytics_enabled", { enabled: isEnabled }).catch(() => {});
}

export function trackEvent(name: string, props?: Record<string, string | number>): void {
	if (!enabled) return;

	// Fire-and-forget via our in-house analytics IPC.
	void invoke("track_analytics_event", {
		name,
		props: props ?? null,
	}).catch(() => {});
}

/**
 * Initialize Sentry for crash reporting.
 * Only initializes once regardless of how many times called.
 *
 * Note: The `reactErrorHandler` in main.tsx is set up eagerly so React 19
 * errors are captured from the start. This init call enables the actual
 * data transmission. The `@sentry/react` module is shared via Vite's
 * module cache (static import in main.tsx + dynamic import here).
 */
async function initSentry(): Promise<void> {
	if (sentryInitialized) return;

	try {
		if (!sentryDsn) return;

		const Sentry = await import("@sentry/react");

		Sentry.init({
			dsn: sentryDsn,
			// Anonymous-by-design — no PII, no user IDs, no cookies
			sendDefaultPii: false,
			// Minimal footprint — crash reporting only
			replaysSessionSampleRate: 0,
			replaysOnErrorSampleRate: 0,
			tracesSampleRate: 0,
		});

		sentryInitialized = true;
	} catch {
		// Sentry init failure must never break the app
	}
}
