/**
 * OfficeCLI Binary Resolver
 *
 * Handles discovery, download, and caching of the OfficeCLI binary.
 * Priority resolution:
 *   1. ~/.zosmaai/cowork/bin/officecli (bundled/downloaded)
 *   2. PATH (which officecli)
 *   3. Auto-download from GitHub releases on first use
 *
 * All operations are synchronous (no async needed for binary ops).
 * The resolver caches the resolved path after first successful look-up
 * to avoid repetitive stat/which calls during a session.
 */

import { execFileSync, execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Constants ───────────────────────────────────────────────────────

const OFFICECLI_RELEASES = "https://github.com/iOfficeAI/OfficeCLI/releases";

/**
 * Platform-specific download URLs for the latest OfficeCLI release.
 * Maps Node `process.platform-process.arch` to the GitHub release asset name.
 *
 * IMPORTANT: these must match the ACTUAL asset names on
 * github.com/iOfficeAI/OfficeCLI/releases. Upstream ships a single
 * self-contained binary per platform (NOT an archive), and uses `win`/`mac`
 * (not `windows`/`macos`). The previous names (`officecli-windows-x64.zip`,
 * `officecli-macos-x64.tar.gz`, `officecli-linux-x64.tar.gz`) 404'd on every
 * platform, so auto-download always failed and the "create document" tool was
 * broken everywhere — e.g. "the native tool had a dependency issue".
 */
export const DOWNLOAD_URLS: Record<string, string> = {
	"linux-x64": `${OFFICECLI_RELEASES}/latest/download/officecli-linux-x64`,
	"linux-arm64": `${OFFICECLI_RELEASES}/latest/download/officecli-linux-arm64`,
	"darwin-x64": `${OFFICECLI_RELEASES}/latest/download/officecli-mac-x64`,
	"darwin-arm64": `${OFFICECLI_RELEASES}/latest/download/officecli-mac-arm64`,
	"win32-x64": `${OFFICECLI_RELEASES}/latest/download/officecli-win-x64.exe`,
	"win32-arm64": `${OFFICECLI_RELEASES}/latest/download/officecli-win-arm64.exe`,
};

const RESOLVER_VERSION = 1; // Bump to invalidate all cached binaries

// ─── Types ───────────────────────────────────────────────────────────

export interface OfficeCLIInfo {
	/** Resolved absolute path to the officecli binary */
	readonly binaryPath: string;
	/** Version string from `officecli version` */
	readonly version: string;
	/** Whether the binary was just auto-downloaded this session */
	readonly autoDownloaded: boolean;
}

export interface ResolverOptions {
	/** Zosma data directory. Defaults to ~/.zosmaai */
	zosmaDir?: string;
	/** Whether to allow auto-download on first use. Defaults to true */
	autoDownload?: boolean;
}

export class OfficeCLIResolver {
	private cachedInfo: OfficeCLIInfo | null = null;
	private readonly zosmaDir: string;
	private readonly autoDownload: boolean;

	constructor(options: ResolverOptions = {}) {
		this.zosmaDir = options.zosmaDir ?? join(homedir(), ".zosmaai");
		this.autoDownload = options.autoDownload ?? true;
	}

	// ─── Public API ───────────────────────────────────────────────

	/**
	 * Resolve the OfficeCLI binary path.
	 * Returns cached result if already resolved this session.
	 * Throws a descriptive error if the binary cannot be found or downloaded.
	 */
	resolve(): OfficeCLIInfo {
		if (this.cachedInfo) return this.cachedInfo;

		// 1. Check the zosma bin directory
		const bundledPath = this.bundledPath();
		if (bundledPath && existsSync(bundledPath)) {
			const version = this.readVersion(bundledPath);
			this.cachedInfo = { binaryPath: bundledPath, version, autoDownloaded: false };
			return this.cachedInfo;
		}

		// 2. Check PATH
		const whichPath = this.findOnPath();
		if (whichPath) {
			const version = this.readVersion(whichPath);
			this.cachedInfo = { binaryPath: whichPath, version, autoDownloaded: false };
			return this.cachedInfo;
		}

		// 3. Auto-download if allowed
		if (this.autoDownload) {
			const downloaded = this.download();
			const version = this.readVersion(downloaded);
			this.cachedInfo = { binaryPath: downloaded, version, autoDownloaded: true };
			return this.cachedInfo;
		}

		throw new OfficeCLINotFoundError(
			"OfficeCLI binary not found. Install it manually via:\n" +
				"  curl -fsSL https://officecli.ai | bash\n" +
				"Or enable auto-download by omitting `autoDownload: false`.",
		);
	}

	/**
	 * Check if OfficeCLI is available without triggering auto-download.
	 * Returns info if found, null if not available.
	 */
	tryResolve(): OfficeCLIInfo | null {
		if (this.cachedInfo) return this.cachedInfo;

		const bundledPath = this.bundledPath();
		if (bundledPath && existsSync(bundledPath)) {
			const version = this.readVersion(bundledPath);
			this.cachedInfo = { binaryPath: bundledPath, version, autoDownloaded: false };
			return this.cachedInfo;
		}

		const whichPath = this.findOnPath();
		if (whichPath) {
			const version = this.readVersion(whichPath);
			this.cachedInfo = { binaryPath: whichPath, version, autoDownloaded: false };
			return this.cachedInfo;
		}

		return null;
	}

	/**
	 * Get the expected bundled path without checking existence.
	 * Useful for UI that wants to show where the binary WILL be.
	 */
	bundledPath(): string {
		const binDir = join(this.zosmaDir, "cowork", "bin");
		const binaryName = process.platform === "win32" ? "officecli.exe" : "officecli";
		return join(binDir, binaryName);
	}

	/**
	 * Invalidate the cached resolution, forcing re-discovery on next call.
	 * Useful if the binary is updated between tool invocations.
	 */
	invalidateCache(): void {
		this.cachedInfo = null;
	}

	// ─── Private ──────────────────────────────────────────────────

	/**
	 * Read version string from the binary.
	 * Falls back to "unknown" if the command fails.
	 */
	private readVersion(binaryPath: string): string {
		try {
			const output = execSync(`"${binaryPath}" --version 2>&1`, {
				encoding: "utf-8",
				timeout: 5_000,
			});
			return output.trim().split("\n")[0] || "unknown";
		} catch {
			return "unknown";
		}
	}

	/**
	 * Search PATH for officecli.
	 */
	private findOnPath(): string | null {
		try {
			const result = execSync(
				process.platform === "win32" ? "where officecli 2>nul" : "which officecli 2>/dev/null",
				{ encoding: "utf-8", timeout: 3_000 },
			);
			const path = result.trim().split("\n")[0];
			return path || null;
		} catch {
			return null;
		}
	}

	/**
	 * Auto-download OfficeCLI for the current platform.
	 * Returns the path to the downloaded binary.
	 * Throws if the platform is unsupported or download fails.
	 */
	private download(): string {
		const platformKey = `${process.platform}-${process.arch}`;
		const downloadUrl = DOWNLOAD_URLS[platformKey];

		if (!downloadUrl) {
			throw new OfficeCLINotFoundError(
				`Unsupported platform: ${platformKey}. OfficeCLI supports: ${Object.keys(DOWNLOAD_URLS).join(", ")}.\nInstall manually: curl -fsSL https://officecli.ai | bash`,
			);
		}

		const binDir = join(this.zosmaDir, "cowork", "bin");
		mkdirSync(binDir, { recursive: true });

		// Upstream ships a single self-contained binary per platform (no archive),
		// so download it straight to the destination — no unzip/tar step. Write to
		// a temp path first and rename into place, so a partial/failed download can
		// never leave a truncated binary that later "resolves" and then crashes.
		const binaryPath = this.bundledPath();
		const tmpPath = `${binaryPath}.download`;

		try {
			console.error(`[office-docs] Downloading OfficeCLI for ${platformKey}...`);
			this.downloadFile(downloadUrl, tmpPath);

			if (!existsSync(tmpPath) || statSync(tmpPath).size === 0) {
				throw new Error("downloaded file is empty");
			}

			if (existsSync(binaryPath)) rmSync(binaryPath, { force: true });
			renameSync(tmpPath, binaryPath);
			// chmod is a no-op on Windows; needed so the raw binary is executable.
			if (process.platform !== "win32") chmodSync(binaryPath, 0o755);

			console.error(`[office-docs] Installed OfficeCLI to ${binaryPath}`);
			return binaryPath;
		} catch (err) {
			try {
				if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
			} catch {
				// ignore cleanup failure
			}
			throw new OfficeCLINotFoundError(
				`Failed to download OfficeCLI: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/**
	 * Download a file using curl or fetch, whichever is available.
	 */
	private downloadFile(url: string, dest: string): void {
		// Prefer curl for progress visibility, fall back to Node fetch
		try {
			execSync(`curl -fsSL "${url}" -o "${dest}"`, {
				stdio: "pipe",
				timeout: 60_000,
			});
			return;
		} catch {
			// curl failed, try Node fetch
		}

		// Use a minimal inline script for fetch
		const script = `
			const https = require("https");
			const fs = require("fs");
			const file = fs.createWriteStream(${JSON.stringify(dest)});
			https.get(${JSON.stringify(url)}, res => {
				if (res.statusCode >= 300 && res.headers.location) {
					https.get(res.headers.location, r => r.pipe(file));
				} else {
					res.pipe(file);
				}
			}).on("error", () => process.exit(1));
			file.on("finish", () => file.close());
			file.on("error", () => { fs.unlinkSync(${JSON.stringify(dest)}); process.exit(1); });
		`;
		execFileSync(process.execPath, ["-e", script], {
			timeout: 60_000,
		});
	}
}

// ─── Custom Error ────────────────────────────────────────────────────

export class OfficeCLINotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OfficeCLINotFoundError";
	}
}

// ─── Singleton ───────────────────────────────────────────────────────
// Global resolver instance reused across tool invocations.
// Ensures consistent binary path within a session.

let _globalResolver: OfficeCLIResolver | null = null;

/**
 * Get or create the global OfficeCLI resolver.
 * Call with options on first invocation to configure.
 */
export function getOfficeCLIResolver(options?: ResolverOptions): OfficeCLIResolver {
	if (!_globalResolver) {
		_globalResolver = new OfficeCLIResolver(options);
	}
	return _globalResolver;
}

/**
 * Reset the global resolver (useful for testing or reconfiguration).
 */
export function resetOfficeCLIResolver(): void {
	_globalResolver = null;
}
