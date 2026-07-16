/**
 * settings-store — persistence for Zosma Cowork user settings.
 *
 * Settings live in a single `settings.json` under the Zosma agent dir. The
 * frontend saves *partial* updates (e.g. just `{ defaultModel }` or just
 * `{ telemetry }`), so writes MUST merge into the existing file rather than
 * overwrite it. The previous implementation overwrote the whole file, which
 * meant saving a model wiped the telemetry-consent key (and vice-versa) —
 * causing the consent popup to reappear on every launch (#169 follow-up).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function settingsFilePath(settingsDir: string): string {
	return join(settingsDir, "settings.json");
}

/** Read the full settings object. Returns `{}` if absent or corrupt. */
export function loadSettings(settingsDir: string): Record<string, unknown> {
	const fp = settingsFilePath(settingsDir);
	if (!existsSync(fp)) return {};
	try {
		const parsed = JSON.parse(readFileSync(fp, "utf-8"));
		// Guard against a non-object payload (e.g. a bare array or string).
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

/**
 * Merge `partial` into the existing settings and persist the result.
 *
 * Shallow merge: top-level keys in `partial` replace existing ones, and any
 * key NOT present in `partial` is preserved. This is what keeps independent
 * settings (model, persona, telemetry consent, …) from clobbering each other.
 */
export function saveSettings(settingsDir: string, partial: Record<string, unknown>): Record<string, unknown> {
	mkdirSync(settingsDir, { recursive: true });
	const existing = loadSettings(settingsDir);
	const merged = { ...existing, ...partial };
	writeFileSync(settingsFilePath(settingsDir), JSON.stringify(merged, null, 2), "utf-8");
	return merged;
}
