/**
 * Zosma Cowork — Background wallpaper control
 *
 * Lets users replace the default animated brand aurora that sits behind the
 * floating glass panels with their own backdrop: a custom solid color or a
 * local image — plus blur/dim controls so panels stay legible over an image.
 *
 * Drives the CSS hook shipped in App.css:
 *   - `body[data-wallpaper]` swaps the aurora for `var(--app-wallpaper)`.
 *   - `--app-wallpaper-blur` / `--app-wallpaper-dim` tune readability.
 * Absence of `data-wallpaper` restores the animated aurora.
 *
 * Persisted in localStorage (an appearance preference, like theme/font-scale)
 * so it applies before React renders — no flash. Local images are copied into
 * `~/.zosmaai/cowork/wallpapers/` by the Rust side and read back as bytes at
 * apply time (the webview can't read arbitrary paths directly).
 */

import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "zosma-wallpaper";

export type WallpaperMode = "aurora" | "solid" | "image";

export interface WallpaperConfig {
	mode: WallpaperMode;
	/** Hex color for `solid` mode, e.g. "#0b1220". */
	solidColor?: string;
	/** Filename inside the wallpapers/ dir for `image` mode. */
	imageFile?: string;
	/** Backdrop blur in px (0–24). */
	blur: number;
	/** Dim overlay darkness (0–0.7). */
	dim: number;
}

export const DEFAULT_WALLPAPER: WallpaperConfig = { mode: "aurora", blur: 0, dim: 0 };

export const BLUR_MAX = 24;
export const DIM_MAX = 0.7;
export const DEFAULT_SOLID_COLOR = "#0b1220";

/** Read the persisted wallpaper config, falling back to the default. */
export function getWallpaper(): WallpaperConfig {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<WallpaperConfig>;
			if (parsed && typeof parsed.mode === "string") {
				return {
					...DEFAULT_WALLPAPER,
					...parsed,
					blur: clamp(parsed.blur ?? 0, 0, BLUR_MAX),
					dim: clamp(parsed.dim ?? 0, 0, DIM_MAX),
				};
			}
		}
	} catch {
		// Ignore corrupt/unavailable storage — fall back to default.
	}
	return { ...DEFAULT_WALLPAPER };
}

/** Persist and apply a wallpaper config. */
export function setWallpaper(cfg: WallpaperConfig): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
	} catch {
		// Ignore — still apply for the current session.
	}
	void applyWallpaper(cfg);
}

// Track the active object URL so we can revoke it when the image changes.
let currentObjectUrl: string | null = null;

/** Apply a wallpaper config to the DOM (sets data-wallpaper + CSS vars on body). */
export async function applyWallpaper(cfg: WallpaperConfig): Promise<void> {
	const body = document.body;
	body.style.setProperty("--app-wallpaper-blur", `${clamp(cfg.blur, 0, BLUR_MAX)}px`);
	body.style.setProperty("--app-wallpaper-dim", String(clamp(cfg.dim, 0, DIM_MAX)));

	if (cfg.mode === "aurora") {
		// Restore the animated aurora: drop the override entirely.
		body.removeAttribute("data-wallpaper");
		body.style.removeProperty("--app-wallpaper");
		releaseObjectUrl();
		return;
	}

	body.setAttribute("data-wallpaper", cfg.mode);

	switch (cfg.mode) {
		case "solid": {
			const color = cfg.solidColor || DEFAULT_SOLID_COLOR;
			// background-image needs an image value, so paint the color as a flat gradient.
			body.style.setProperty("--app-wallpaper", `linear-gradient(${color}, ${color})`);
			releaseObjectUrl();
			break;
		}
		case "image": {
			if (!cfg.imageFile) {
				body.style.setProperty("--app-wallpaper", "none");
				break;
			}
			const url = await readWallpaperImageUrl(cfg.imageFile);
			releaseObjectUrl();
			if (url) {
				currentObjectUrl = url;
				body.style.setProperty("--app-wallpaper", `url("${url}")`);
			} else {
				// Image missing/unreadable — show the plain background rather than the aurora.
				body.style.setProperty("--app-wallpaper", "none");
			}
			break;
		}
	}
}

/** Copy a picked image into the wallpapers dir; returns the stored filename. */
export async function importWallpaperImage(srcPath: string): Promise<string> {
	return invoke<string>("import_wallpaper", { srcPath });
}

/**
 * Read a stored wallpaper image and return a fresh object URL for it, or null
 * if it can't be read. The caller owns the URL and must revoke it when done.
 */
export async function readWallpaperImageUrl(filename: string): Promise<string | null> {
	try {
		const bytes = await invoke<number[]>("read_wallpaper", { filename });
		const blob = new Blob([new Uint8Array(bytes)], { type: mimeForFile(filename) });
		return URL.createObjectURL(blob);
	} catch {
		return null;
	}
}

/** Apply the saved wallpaper on app load. */
export function initWallpaper(): void {
	void applyWallpaper(getWallpaper());
}

function releaseObjectUrl(): void {
	if (currentObjectUrl) {
		URL.revokeObjectURL(currentObjectUrl);
		currentObjectUrl = null;
	}
}

function clamp(n: number, lo: number, hi: number): number {
	if (Number.isNaN(n)) return lo;
	return Math.min(hi, Math.max(lo, n));
}

function mimeForFile(filename: string): string {
	const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
	switch (ext) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		case "gif":
			return "image/gif";
		default:
			return "application/octet-stream";
	}
}
