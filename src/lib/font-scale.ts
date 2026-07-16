/**
 * Zosma Cowork — Font size / zoom control
 *
 * Uses CSS `zoom` on the root app container to scale the entire UI
 * proportionally. Stored in localStorage so it persists across sessions.
 */

const STORAGE_KEY = "zosma-font-scale";

export type FontScale = 0.85 | 1 | 1.15 | 1.3;

/** All available font scale presets. */
export const FONT_SCALE_PRESETS: FontScale[] = [0.85, 1, 1.15, 1.3];

/** Human-readable labels for each preset. */
export const FONT_SCALE_LABELS: Record<FontScale, string> = {
	0.85: "Small",
	1: "Normal",
	1.15: "Large",
	1.3: "Extra Large",
};

/** Icons for each preset. */
export const FONT_SCALE_ICONS: Record<FontScale, string> = {
	0.85: "A",
	1: "A",
	1.15: "A",
	1.3: "A",
};

/**
 * Root-container utility classes per preset: the `zoom` scale plus a viewport
 * height that COMPENSATES for that zoom.
 *
 * CSS `zoom` multiplies the *painted* size, so a bare `h-screen` (100vh) becomes
 * `scale * 100vh` tall at Large/Extra-Large — taller than the viewport. That makes
 * <body> scrollable, and any focus-into-view (chat input, active session) scrolls
 * it down, clipping the fixed sidebar top-chrome (the New-chat button) off the
 * top. A zoom-compensated height (100vh divided by the scale) cancels the zoom
 * so the painted height is always exactly one viewport — no overflow, nothing to
 * clip.
 *
 * These are complete literal class strings so Tailwind's source scanner emits
 * the arbitrary `zoom`/height utilities at build time.
 */
export const FONT_SCALE_CLASSES: Record<FontScale, string> = {
	0.85: "[zoom:0.85] h-[calc(100vh/0.85)]",
	1: "[zoom:1] h-screen",
	1.15: "[zoom:1.15] h-[calc(100vh/1.15)]",
	1.3: "[zoom:1.3] h-[calc(100vh/1.3)]",
};

/**
 * Resolve the root-container class for a (possibly non-preset) scale, falling
 * back to the unscaled 1× classes for any unexpected value.
 */
export function fontScaleClass(scale: number): string {
	return FONT_SCALE_CLASSES[scale as FontScale] ?? FONT_SCALE_CLASSES[1];
}

/** Get the persisted font scale, falling back to 1 (Normal). */
export function getFontScale(): FontScale {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			const n = Number(saved);
			if (FONT_SCALE_PRESETS.includes(n as FontScale)) return n as FontScale;
		}
	} catch {
		// localStorage unavailable — use default
	}
	return 1;
}

/** Persist a font scale choice. */
export function setFontScale(scale: FontScale): void {
	try {
		localStorage.setItem(STORAGE_KEY, String(scale));
	} catch {
		// Ignore
	}
}

/** Initialize font scale from saved preference (call once on app load). */
export function initFontScale(): void {
	// Just reading sets no side effects — actual zoom is applied in App.tsx
	const scale = getFontScale();
	if (scale !== 1) {
		// We don't do the zoom here because React needs the DOM to be ready.
		// App.tsx handles it by reading the saved value on mount.
	}
}
