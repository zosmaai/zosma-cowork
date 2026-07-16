/**
 * Zosma Cowork — Wallpaper / background control
 *
 * Aurora is the only backdrop. This module exists to clear any stale
 * wallpaper config written by an older app version so the aurora is
 * always restored on start-up.
 */

const STORAGE_KEY = "zosma-wallpaper";

/** Remove any persisted wallpaper override and ensure the aurora is active. */
export function initWallpaper(): void {
	// Clear stale config from older builds that supported solid/image modes.
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Ignore — storage unavailable.
	}

	// Ensure no stale data-wallpaper attribute lingers (e.g. after a hot reload).
	const body = document.body;
	body.removeAttribute("data-wallpaper");
	body.style.removeProperty("--app-wallpaper");
	body.style.removeProperty("--app-wallpaper-blur");
	body.style.removeProperty("--app-wallpaper-dim");
}
