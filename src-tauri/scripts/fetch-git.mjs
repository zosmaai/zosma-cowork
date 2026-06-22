/**
 * fetch-git.mjs — Ensures `git` is available in the bundle at build time.
 *
 * Strategy per platform:
 *   macOS / Linux  — `git` is universally available via Xcode CLI / distro
 *                    packages. We create a thin shell wrapper at
 *                    `binaries/git/git` that dispatches to `<tool> from PATH.
 *                    No binary is downloaded.
 *   Windows        — `git` is rarely pre-installed. We download Git for Windows
 *                    installer (`.exe`) to `binaries/git/`; the agent-sidecar
 *                    will invoke it at first run if `git` is not on PATH.
 *                    7z is NOT required — we download the NSIS installer .exe.
 *
 * At runtime (agent-sidecar), PATH is enriched with `binaries/git/` so the
 * wrapper / binary is found by any subprocess.
 *
 * The wrapper script on macOS/Linux is a triple-fallback:
 *   1. Use system `git` from PATH (most common)
 *   2. Fall back to bundled portable `git` if present
 *   3. Fail with a clear installation hint
 *
 * On Windows, the agent-sidecar runtime PATH check detects missing `git`
 * and offers to run the bundled installer, or opens the download page.
 */

import { execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	copyFileSync,
	rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { platform, arch } from "node:os";

const GIT_VERSION = "2.49.0";

const TARGET_MAP = {
	"universal-apple-darwin": [
		{ osArch: "darwin-arm64", destName: "git-arm64" },
		{ osArch: "darwin-x64", destName: "git-x64" },
	],
	"aarch64-apple-darwin": { osArch: "darwin-arm64", destName: "git" },
	"x86_64-apple-darwin": { osArch: "darwin-x64", destName: "git" },
	"x86_64-unknown-linux-gnu": { osArch: "linux-x64", destName: "git" },
	"x86_64-pc-windows-msvc": { osArch: "win-x64", destName: "git.exe" },
};

function detectTarget() {
	const targetTriple = process.env.TARGET_TRIPLE;
	if (targetTriple && TARGET_MAP[targetTriple]) {
		return targetTriple;
	}
	const plat = platform();
	const a = arch();
	if (plat === "darwin" && a === "arm64") return "aarch64-apple-darwin";
	if (plat === "darwin" && a === "x64") return "x86_64-apple-darwin";
	if (plat === "linux" && a === "x64") return "x86_64-unknown-linux-gnu";
	if (plat === "win32" && a === "x64") return "x86_64-pc-windows-msvc";
	throw new Error(`Cannot detect git target for ${plat}-${a}. Set TARGET_TRIPLE env var.`);
}

function getGitBinariesDir() {
	const rootDir = resolve(import.meta.dirname, "..", "..");
	return join(rootDir, "src-tauri", "binaries", "git");
}

function hasSystemGit() {
	try {
		execSync("command -v git", { stdio: "pipe", encoding: "utf-8" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Write a shell wrapper for macOS/Linux that resolves `git` from PATH.
 * This is a thin script -- the real git binary is never bundled on these
 * platforms because git is universally available via OS developer tools.
 */
function writeUnixWrapper(destPath) {
	const content = `#!/bin/sh
# Zosma Cowork — bundled git wrapper
# Tries system git FIRST (by skipping our own directory), then falls back
# to a bundled portable binary in sibling paths.
DIR="$(cd "$(dirname "$0")" && pwd)"

# Remove this script's own directory from PATH to prevent infinite recursion.
# Then try to find system git.
CLEAN_PATH=$(echo ":$PATH:" | sed "s|:$DIR:|:|g" | sed 's/^://' | sed 's/:$//')
if [ -n "$CLEAN_PATH" ]; then
  SYS_GIT=$(PATH="$CLEAN_PATH" command -v git 2>/dev/null)
  if [ -n "$SYS_GIT" ] && [ "$SYS_GIT" != "$0" ]; then
    exec "$SYS_GIT" "$@"
  fi
fi

# Fallback: portable binary in sibling or arch-specific paths
for candidate in "$DIR/git-portable" "$DIR/../git-arm64" "$DIR/../git-x64" "$DIR/git.bin"; do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$@"
  fi
done

echo "ERROR: git not found. Install Git (https://git-scm.com/downloads) or ensure it is on PATH." >&2
exit 1
`;
	writeFileSync(destPath, content, "utf-8");
	execSync(`chmod +x "${destPath}"`, { stdio: "inherit" });
	console.log(`[fetch-git]   ✅ ${destPath} (system-git wrapper)`);
}

/**
 * On Windows, download the Git for Windows installer (.exe).
 * This is a standalone NSIS executable that can be run silently.
 * At runtime, if git is not on PATH, Cowork runs this installer.
 */
function downloadWindowsInstaller(binariesDir) {
	const url = `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.1/Git-${GIT_VERSION}-64-bit.exe`;
	const destPath = join(binariesDir, "Git-Installer.exe");

	if (existsSync(destPath)) {
		console.log(`[fetch-git]   ✅ Git installer already cached at ${destPath}`);
		return destPath;
	}

	console.log(`[fetch-git]   Downloading Git for Windows ${GIT_VERSION} installer...`);
	try {
		execSync(`curl -fSL "${url}" -o "${destPath}"`, { stdio: "inherit", timeout: 120_000 });
		console.log(`[fetch-git]   ✅ ${destPath} (${(existsSync(destPath) ? readFileSync(destPath).length : 0) / 1024 / 1024} MB)`);
	} catch (err) {
		console.error(`[fetch-git]   ⚠️  Failed to download Git installer: ${err.message}`);
		console.error(`[fetch-git]   Windows users will be prompted to install Git at first launch.`);
		return null;
	}

	// Also write a .cmd wrapper that checks PATH then falls back to installer
	const cmdWrapperPath = join(binariesDir, "git.cmd");
	const cmdContent = `@echo off
REM Zosma Cowork -- bundled git wrapper (Windows)
REM First try git from PATH
where git >nul 2>nul
if %ERRORLEVEL% equ 0 (
    git %*
    exit /b %ERRORLEVEL%
)
REM Check for Git in common install locations
for %%p in (
    "%ProgramFiles%\\Git\\bin\\git.exe"
    "%ProgramFiles(x86)%\\Git\\bin\\git.exe"
    "%LOCALAPPDATA%\\Programs\\Git\\bin\\git.exe"
    "%~dp0Git\\bin\\git.exe"
) do (
    if exist %%p (
        %%p %*
        exit /b %ERRORLEVEL%
    )
)
echo Git is not installed. Run "%~dp0Git-Installer.exe" to install Git for Windows.
exit /b 1
`;
	writeFileSync(cmdWrapperPath, cmdContent, "utf-8");
	console.log(`[fetch-git]   ✅ ${cmdWrapperPath} (PATH-resolving wrapper)`);

	// Also write the .cmd as "git" (no extension) for Tauri resource consistency
	const noExtWrapper = join(binariesDir, "git");
	if (!existsSync(noExtWrapper)) {
		writeFileSync(noExtWrapper, cmdContent, "utf-8");
		console.log(`[fetch-git]   ✅ ${noExtWrapper} (extensionless copy for resource bundling)`);
	}

	return destPath;
}

function createStubs(binariesDir, isWin) {
	const allVariants = ["git", "git-arm64", "git-x64"];
	for (const v of allVariants) {
		const p = join(binariesDir, v);
		if (!existsSync(p)) {
			if (isWin) {
				writeFileSync(
					p,
					`@echo off\r\necho Git variant '${v}' not available for this build. >&2\r\nexit /b 1\r\n`,
				);
			} else {
				writeFileSync(
					p,
					`#!/bin/bash\necho "Git variant '${v}' not available for this build." >&2\nexit 1\n`,
				);
				try {
					execSync(`chmod +x "${p}"`, { stdio: "inherit" });
				} catch {}
			}
			console.log(`[fetch-git]   ⚠️ Created stub for ${v}`);
		}
	}
}

function downloadAndSetup(targetTriple) {
	const config = TARGET_MAP[targetTriple];
	if (!config) {
		throw new Error(`No git config for target: ${targetTriple}`);
	}

	const binariesDir = getGitBinariesDir();
	mkdirSync(binariesDir, { recursive: true });

	const isWin = targetTriple === "x86_64-pc-windows-msvc";
	const isUnix = !isWin;

	console.log(`[fetch-git] Target: ${targetTriple}`);
	console.log(`[fetch-git] Platform: ${isWin ? "Windows" : "Unix"}`);

	if (isUnix) {
		// macOS / Linux: create a shell wrapper that uses system git
		const systemGit = hasSystemGit();
		if (systemGit) {
			console.log(`[fetch-git]   System git found at: ${
				execSync("command -v git", { encoding: "utf-8" }).trim()
			}`);
		} else {
			console.log(`[fetch-git]   ⚠️  System git not found on build machine`);
		}

		// Handle universal macOS (array of configs)
		if (Array.isArray(config)) {
			for (const c of config) {
				const destPath = join(binariesDir, c.destName);
				if (!existsSync(destPath)) {
					writeUnixWrapper(destPath);
				}
			}
			// Also write the default "git" wrapper
			const defaultPath = join(binariesDir, "git");
			if (!existsSync(defaultPath)) {
				writeUnixWrapper(defaultPath);
			}
		} else {
			const destPath = join(binariesDir, config.destName);
			if (!existsSync(destPath) || !readFileSync(destPath, "utf-8").startsWith("#!/")) {
				writeUnixWrapper(destPath);
			}

			// Mirror to arch-specific name
			const builtArch = process.arch;
			const matchingName =
				builtArch === "arm64" ? "git-arm64" : builtArch === "x64" ? "git-x64" : null;
			if (matchingName) {
				const matchingPath = join(binariesDir, matchingName);
				if (!existsSync(matchingPath)) {
					copyFileSync(destPath, matchingPath);
					console.log(`[fetch-git]   ✅ Mirrored wrapper → ${matchingName}`);
				}
			}
		}
	} else {
		// Windows: download the Git installer
		downloadWindowsInstaller(binariesDir);
	}

	// Stubs for any missing variants
	createStubs(binariesDir, isWin);

	console.log(`[fetch-git] ✅ Done — git ${isWin ? "installer" : "wrapper"} bundled`);
}

const target = detectTarget();
downloadAndSetup(target);
