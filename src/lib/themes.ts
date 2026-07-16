/**
 * Zosma Cowork — Simple dark/light theme toggle
 *
 * Uses a `data-theme` attribute on <html> to override prefers-color-scheme.
 * App.css handles both the media query and the data-theme selector.
 */

const STORAGE_KEY = "zosma-theme-mode";

export type ThemeMode = "dark" | "light";

/** Get the current effective theme mode */
export function getThemeMode(): ThemeMode {
	// Check localStorage first
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === "dark" || saved === "light") return saved;
	} catch {
		// Ignore
	}
	// Fall back to OS preference
	if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
		return "dark";
	}
	return "light";
}

/** Apply a theme mode by setting data-theme on <html> */
export function applyTheme(mode: ThemeMode): void {
	document.documentElement.setAttribute("data-theme", mode);
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// Ignore
	}
}

/** Toggle between dark and light */
export function toggleTheme(): ThemeMode {
	const next = getThemeMode() === "dark" ? "light" : "dark";
	applyTheme(next);
	return next;
}

/** Initialize theme from saved preference on app load */
export function initTheme(): void {
	applyTheme(getThemeMode());
}
