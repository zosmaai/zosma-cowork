import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { invoke } from "@tauri-apps/api/core";

/**
 * Tauri sidecar oneshot receiver returns `"closed"` (case-insensitive) when
 * the sender is dropped without a response — typically because the sidecar
 * hasn't finished initializing yet.
 *
 * See: `scmd_r` in lib.rs mapping `RecvError::Closed` → `"closed"`
 */
const CLOSED_ERROR_PATTERN = /closed/i;

/**
 * Check if an error is a Tauri sidecar "closed" error (IPC channel dropped).
 */
export function isClosedIpcError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return CLOSED_ERROR_PATTERN.test(msg);
}

/**
 * Retry an async operation up to `maxRetries` times when it fails with a
 * "closed" IPC error (sidecar not ready yet). Uses exponential backoff.
 *
 * Non-"closed" errors (timeout, actual failures) are thrown immediately.
 */
export async function retryOnClosed<T>(
	fn: () => Promise<T>,
	maxRetries = 3,
	initialDelay = 500,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			// Only retry on "closed" (sidecar not ready yet)
			if (isClosedIpcError(err) && attempt < maxRetries) {
				await new Promise((r) => setTimeout(r, initialDelay * 2 ** attempt));
				continue;
			}
			throw err;
		}
	}
	throw lastError;
}

/**
 * Whether a URL should be opened in the external system browser.
 *
 * Uses an ALLOWLIST of known-safe navigable schemes rather than a
 * blocklist of dangerous ones. This is deliberately strict: anything
 * that is not plainly http(s)/mailto/tel/protocol-relative (including
 * in-page `#anchors` and dangerous schemes like `javascript:`,
 * `vbscript:`, `data:`, `blob:`) returns false and is never force-opened.
 */
export function isExternalUrl(href: string | null | undefined): boolean {
	if (!href) return false;
	const trimmed = href.trim();
	if (trimmed.startsWith("//")) return true; // protocol-relative
	return /^(https?|mailto|tel):/i.test(trimmed);
}

/**
 * Open a URL in the system browser via the Tauri backend.
 * Falls back to window.open if the IPC call fails.
 */
export async function openExternalUrl(url: string): Promise<void> {
	try {
		await invoke("open_url", { url });
	} catch {
		// fallback for non-Tauri environments (browser dev mode)
		const win = window.open(url, "_blank");
		if (win) {
			win.focus();
		} else {
			// popup blocked — navigate in current window
			window.location.href = url;
		}
	}
}

export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const n = bytes / 1024 ** i;
	return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
