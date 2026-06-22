/**
 * bundled-binaries.ts — Discovers and activates binaries bundled with Cowork.
 *
 * Cowork ships portable binaries in `src-tauri/binaries/` at build time.
 * At runtime they live inside the app bundle (Tauri resources directory).
 * This module finds them, validates they work, and injects their parent
 * directories into `process.env.PATH` so any subprocess (including the pi
 * session) can find them transparently.
 *
 * Probe order for each tool:
 *   1. Check system PATH first (most common on macOS/Linux)
 *   2. Fall back to the bundled binary in the app resources
 *
 * Supported bundled tools:
 *   - git   (system on macOS/Linux; Git for Windows on Windows)
 *   - gh    (GitHub CLI — bundled on all platforms)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { execSync } from "node:child_process";

export type ToolAvailability = "system" | "bundled" | "missing";

export interface ToolInfo {
	name: string;
	status: ToolAvailability;
	version: string | null;
	path: string | null;
}

/**
 * Resolve the directory where bundled binaries live at runtime.
 *
 * Dev mode:       <repo>/src-tauri/binaries/
 * Packaged app:   <Tauri resource dir>/binaries/
 *
 * The sidecar's `import.meta.url` resolves to its own location.
 * In dev: agent-sidecar/dist/bundle.cjs → agent-sidecar/ → .. → src-tauri/binaries/
 * In prod: <bundle>/agent-sidecar/index.cjs → .. → binaries/
 */
function bundledDir(): string | null {
	try {
		// Resolve from the sidecar's own directory
		const sidecarDir = new URL(".", import.meta.url).pathname;
		// Walk up to find the binaries directory
		const candidates = [
			// Dev layout: <repo>/src-tauri/binaries/
			join(sidecarDir, "..", "..", "..", "src-tauri", "binaries"),
			// Packaged layout: <bundle>/binaries/
			join(sidecarDir, "..", "binaries"),
			// Alternative packaged layout (Tauri app dir)
			join(sidecarDir, "..", "Resources", "binaries"),
		];
		for (const dir of candidates) {
			const resolved = join(dir);
			if (existsSync(resolved)) {
				return resolved;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Probe a tool (git, gh, etc.) — first on system PATH, then in the bundle.
 */
function probeTool(name: string, binaryName?: string): ToolInfo {
	const binName = binaryName ?? name;

	// 1. Try system PATH
	try {
		const result = execSync(`command -v "${binName}" 2>/dev/null`, {
			encoding: "utf-8",
			timeout: 2000,
		});
		const systemPath = result.trim();
		if (systemPath) {
			const version = execSync(`"${systemPath}" --version 2>&1`, {
				encoding: "utf-8",
				timeout: 2000,
			}).trim();
			return { name, status: "system", version: version.split("\n")[0], path: systemPath };
		}
	} catch {
		// Not on PATH — continue to bundled check
	}

	// 2. Try bundled binary
	const bundle = bundledDir();
	if (bundle) {
		const isWin = platform() === "win32";
		const candidate = join(bundle, name, isWin ? `${binName}.exe` : binName);
		if (existsSync(candidate)) {
			try {
				const version = execSync(`"${candidate}" --version 2>&1`, {
					encoding: "utf-8",
					timeout: 2000,
				}).trim();
				return { name, status: "bundled", version: version.split("\n")[0], path: candidate };
			} catch {
				return { name, status: "bundled", version: null, path: candidate };
			}
		}

		// Also check the variant names (gh/gh-x64, git/git-x64, gh-arm64 etc.)
		for (const variant of [`${binName}`, `${binName}-x64`, `${binName}-arm64`]) {
			const vPath = join(bundle, name, variant);
			if (existsSync(vPath)) {
				try {
					const version = execSync(`"${vPath}" --version 2>&1`, {
						encoding: "utf-8",
						timeout: 2000,
					}).trim();
					return { name, status: "bundled", version: version.split("\n")[0], path: vPath };
				} catch {
					// Not executable — continue
				}
			}
		}
	}

	return { name, status: "missing", version: null, path: null };
}

/**
 * Build a PATH string that includes bundled binary directories (prepended).
 * Also checks for Windows Git for Windows installer scenario.
 */
function buildBundledPath(existingPath: string): string {
	const bundle = bundledDir();
	if (!bundle) return existingPath;

	const isWin = platform() === "win32";
	const pathParts: string[] = [];

	// Add bundled tool directories
	for (const toolName of ["gh", "git"]) {
		const toolDir = join(bundle, toolName);
		if (existsSync(toolDir)) {
			pathParts.push(toolDir);
		}
	}

	if (pathParts.length === 0) return existingPath;
	return [...pathParts, existingPath].join(isWin ? ";" : ":");
}

/**
 * Activate bundled binaries — probes tools, enriches PATH, returns status.
 * Call once during app initialization before any pi session starts.
 */
export function activateBundledBinaries(): { git: ToolInfo; gh: ToolInfo } {
	const ghInfo = probeTool("gh");
	const gitInfo = probeTool("git");

	console.log(`[bundled-binaries] gh: ${ghInfo.status}${ghInfo.version ? ` (${ghInfo.version})` : ""}`);
	console.log(`[bundled-binaries] git: ${gitInfo.status}${gitInfo.version ? ` (${gitInfo.version})` : ""}`);

	// Enrich PATH
	const currentPath = process.env.PATH || "";
	const newPath = buildBundledPath(currentPath);
	if (newPath !== currentPath) {
		process.env.PATH = newPath;
		console.log(`[bundled-binaries] PATH enriched with bundled binary directories`);
	}

	// On Windows, also check if Git-for-Windows installer should be offered
	if (gitInfo.status === "missing") {
		console.log(`[bundled-binaries] ⚠️  git not found — user will be prompted to install`);
	}

	return { git: gitInfo, gh: ghInfo };
}

/**
 * Check if git is usable (on PATH after enrichment).
 * Returns helpful error for Windows if not found.
 */
export function checkGitAvailable(): { ok: boolean; message?: string } {
	try {
		execSync("git --version", { stdio: "pipe", encoding: "utf-8", timeout: 3000 });
		return { ok: true };
	} catch {
		const isWin = platform() === "win32";
		if (isWin) {
			return {
				ok: false,
				message:
					"Git for Windows is required. Open Settings → Apps → GitHub to install it, or download from https://git-scm.com/download/win",
			};
		}
		return {
			ok: false,
			message:
				"Git is required. Install it via your package manager (apt, brew, pacman) or from https://git-scm.com/downloads",
		};
	}
}
