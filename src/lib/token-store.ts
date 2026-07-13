import { invoke } from "@tauri-apps/api/core";

/**
 * Bearer-token storage with a two-tier persistence strategy.
 *
 * Primary  : OS keychain (via Rust `save_token` / `load_token` / `clear_token`)
 * Fallback : localStorage (key `zosma:bearer-token`)
 *
 * Why two tiers?
 *   Properly code-signed production builds always hit the keychain — it's
 *   stable and secure. Ad-hoc-signed dev builds (unsigned `cp -R` from the
 *   Rust target dir) can have their keychain reads denied by macOS on relaunch
 *   because each rebuild changes the binary's ad-hoc identity. In that case we
 *   fall back to localStorage so the session still restores.
 *
 * localStorage is scoped to the Tauri WebView and not readable by other user
 * apps, but any process running as the same user could grep the WKWebView
 * data dir. That's an acceptable tradeoff for a desktop dev tool and matches
 * what other Electron/Tauri apps do (VS Code, Slack, Discord).
 */

const LS_KEY = "zosma:bearer-token";
let _memToken: string | null = null;

const log = (msg: string, extra?: unknown) => {
	// Prefixed so it's easy to grep in DevTools.
	console.log(`[ZosmaAuth/token-store] ${msg}`, extra ?? "");
};

const lsSet = (token: string) => {
	try {
		localStorage.setItem(LS_KEY, token);
	} catch (e) {
		log("localStorage set failed", e);
	}
};

const lsGet = (): string | null => {
	try {
		return localStorage.getItem(LS_KEY);
	} catch {
		return null;
	}
};

const lsClear = () => {
	try {
		localStorage.removeItem(LS_KEY);
	} catch {
		// ignore
	}
};

export const tokenStore = {
	async save(token: string): Promise<void> {
		_memToken = token;
		lsSet(token);
		try {
			await invoke<void>("save_token", { token });
			log("saved to keychain + localStorage");
		} catch (e) {
			// Keychain write failed — localStorage fallback still holds the token.
			log("keychain save FAILED, localStorage fallback active", e);
		}
	},

	async load(): Promise<string | null> {
		// Try keychain first
		try {
			const t = await invoke<string | null>("load_token");
			if (t) {
				_memToken = t;
				// Sync localStorage in case it was missing (defensive).
				lsSet(t);
				log("loaded from keychain");
				return t;
			}
			log("keychain has no token — checking localStorage");
		} catch (e) {
			log("keychain load THREW — falling back to localStorage", e);
		}

		// Fall back to localStorage
		const fallback = lsGet();
		if (fallback) {
			_memToken = fallback;
			log("loaded from localStorage fallback — attempting to restore to keychain");
			// Best-effort restore to keychain for next launch.
			invoke<void>("save_token", { token: fallback }).catch((e) =>
				log("keychain restore failed (non-fatal)", e),
			);
			return fallback;
		}

		log("no token in either store");
		_memToken = null;
		return null;
	},

	async clear(): Promise<void> {
		_memToken = null;
		lsClear();
		try {
			await invoke<void>("clear_token");
			log("cleared from keychain + localStorage");
		} catch (e) {
			log("keychain clear failed (non-fatal)", e);
		}
	},

	/** Synchronous read of the in-memory copy — no IPC round-trip. */
	getInMemory(): string | null {
		return _memToken;
	},
};
