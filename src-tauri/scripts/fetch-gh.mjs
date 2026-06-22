/**
 * fetch-gh.mjs — Downloads the GitHub CLI (`gh`) binary for the build target.
 *
 * Follows the exact pattern of fetch-node.mjs. Runs during `tauri build`.
 * Downloads the official gh release archive, extracts the single binary,
 * and places it in src-tauri/binaries/gh/.
 *
 * At runtime, the agent-sidecar checks PATH first, then falls back to
 * this bundled binary.
 *
 * Supported targets:
 *   - universal-apple-darwin  (macOS universal: arm64 + x64)
 *   - aarch64-apple-darwin     (macOS Apple Silicon)
 *   - x86_64-apple-darwin      (macOS Intel)
 *   - x86_64-unknown-linux-gnu (Linux x64)
 *   - x86_64-pc-windows-msvc   (Windows x64)
 */

import { execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	copyFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { platform, arch } from "node:os";

const GH_VERSION = "2.92.0";

// Map Rust target triples to GitHub CLI download configs.
// gh releases use `gh_VERSION_OS_ARCH` naming, where OS = Linux/macOS/Windows
// and ARCH = amd64/arm64.
const TARGET_MAP = {
	// macOS universal — download BOTH arm64 and x64
	"universal-apple-darwin": [
		{
			osArch: "macOS_arm64",
			baseUrl: `https://github.com/cli/cli/releases/download/v${GH_VERSION}`,
			filename: `gh_${GH_VERSION}_macOS_arm64.tar.gz`,
			extractCmd: "tar -xzf",
			binaryInArchive: `gh_${GH_VERSION}_macOS_arm64/bin/gh`,
			destName: "gh-arm64",
		},
		{
			osArch: "macOS_amd64",
			baseUrl: `https://github.com/cli/cli/releases/download/v${GH_VERSION}`,
			filename: `gh_${GH_VERSION}_macOS_amd64.tar.gz`,
			extractCmd: "tar -xzf",
			binaryInArchive: `gh_${GH_VERSION}_macOS_amd64/bin/gh`,
			destName: "gh-x64",
		},
	],
	// macOS ARM64 (Apple Silicon)
	"aarch64-apple-darwin": {
		osArch: "macOS_arm64",
		baseUrl: `https://github.com/cli/cli/releases/download/v${GH_VERSION}`,
		filename: `gh_${GH_VERSION}_macOS_arm64.tar.gz`,
		extractCmd: "tar -xzf",
		binaryInArchive: `gh_${GH_VERSION}_macOS_arm64/bin/gh`,
		destName: "gh",
	},
	// macOS x64 (Intel)
	"x86_64-apple-darwin": {
		osArch: "macOS_amd64",
		baseUrl: `https://github.com/cli/cli/releases/download/v${GH_VERSION}`,
		filename: `gh_${GH_VERSION}_macOS_amd64.tar.gz`,
		extractCmd: "tar -xzf",
		binaryInArchive: `gh_${GH_VERSION}_macOS_amd64/bin/gh`,
		destName: "gh",
	},
	// Linux x64
	"x86_64-unknown-linux-gnu": {
		osArch: "linux_amd64",
		baseUrl: `https://github.com/cli/cli/releases/download/v${GH_VERSION}`,
		filename: `gh_${GH_VERSION}_linux_amd64.tar.gz`,
		extractCmd: "tar -xzf",
		binaryInArchive: `gh_${GH_VERSION}_linux_amd64/bin/gh`,
		destName: "gh",
	},
	// Windows x64
	"x86_64-pc-windows-msvc": {
		osArch: "windows_amd64",
		baseUrl: `https://github.com/cli/cli/releases/download/v${GH_VERSION}`,
		filename: `gh_${GH_VERSION}_windows_amd64.zip`,
		extractCmd: null, // use unzip or powershell
		binaryInArchive: `bin/gh.exe`,
		destName: "gh.exe",
	},
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

	throw new Error(
		`Cannot detect gh target for ${plat}-${a}. Set TARGET_TRIPLE env var.`,
	);
}

function getBinariesDir() {
	const rootDir = resolve(import.meta.dirname, "..", "..");
	const srcTauriDir = join(rootDir, "src-tauri");
	return join(srcTauriDir, "binaries", "gh");
}

function downloadOne(config, binariesDir) {
	const tmpDir = join(binariesDir, ".tmp-gh-extract");
	mkdirSync(tmpDir, { recursive: true });

	const url = `${config.baseUrl}/${config.filename}`;
	const archivePath = join(tmpDir, config.filename);

	console.log(`[fetch-gh]   Downloading ${config.osArch}...`);
	execSync(`curl -fSL "${url}" -o "${archivePath}"`, { stdio: "inherit" });

	// Extract
	try {
		if (config.extractCmd) {
			execSync(`${config.extractCmd} "${archivePath}"`, {
				cwd: tmpDir,
				stdio: "inherit",
			});
		} else {
			// Windows zip
			const isWin = platform() === "win32";
			if (isWin) {
				execSync(
					`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force"`,
					{ stdio: "inherit" },
				);
			} else {
				execSync(`unzip -o "${archivePath}" -d "${tmpDir}"`, {
					stdio: "inherit",
				});
			}
		}
	} catch (err) {
		console.error(`[fetch-gh] Extraction failed: ${err.message}`);
		process.exit(1);
	}

	// Copy the gh binary to the final location
	const srcBinary = join(tmpDir, config.binaryInArchive);
	const destPath = join(binariesDir, config.destName);

	if (!existsSync(srcBinary)) {
		console.error(
			`[fetch-gh] Expected binary not found: ${srcBinary}`,
		);
		// Try to find it
		const findResult = execSync(`find "${tmpDir}" -name "gh" -o -name "gh.exe" 2>/dev/null`, {
			encoding: "utf-8",
		}).trim();
		console.error(`[fetch-gh]   Files found: ${findResult || "(none)"}`);
		process.exit(1);
	}

	copyFileSync(srcBinary, destPath);

	// Make executable (Unix)
	if (platform() !== "win32") {
		execSync(`chmod +x "${destPath}"`, { stdio: "inherit" });
	}

	// Cleanup
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {}

	console.log(`[fetch-gh]   ✅ ${config.destName}`);
}

function downloadAndExtract(targetTriple) {
	const config = TARGET_MAP[targetTriple];
	if (!config) {
		throw new Error(`No gh download config for target: ${targetTriple}`);
	}

	const binariesDir = getBinariesDir();
	mkdirSync(binariesDir, { recursive: true });

	console.log(`[fetch-gh] Target: ${targetTriple}`);
	console.log(`[fetch-gh] gh version: v${GH_VERSION}`);

	if (Array.isArray(config)) {
		for (const c of config) {
			downloadOne(c, binariesDir);
		}
	} else {
		downloadOne(config, binariesDir);
	}

	// On single-arch Unix builds, mirror the binary to arch-specific name too
	const isWin = platform() === "win32";
	if (!Array.isArray(config) && !isWin) {
		const builtArch = process.arch;
		const matchingName =
			builtArch === "arm64"
				? "gh-arm64"
				: builtArch === "x64"
					? "gh-x64"
					: null;
		if (matchingName) {
			const realGh = join(binariesDir, "gh");
			const matchingPath = join(binariesDir, matchingName);
			if (existsSync(realGh)) {
				copyFileSync(realGh, matchingPath);
				execSync(`chmod +x "${matchingPath}"`, { stdio: "inherit" });
				console.log(`[fetch-gh]   ✅ Mirrored gh → ${matchingName}`);
			}
		}
	}

	// On Windows, copy gh.exe → gh for Tauri resource consistency
	if (isWin) {
		const ghExe = join(binariesDir, "gh.exe");
		const ghCopy = join(binariesDir, "gh");
		if (existsSync(ghExe) && !existsSync(ghCopy)) {
			copyFileSync(ghExe, ghCopy);
			console.log(`[fetch-gh]   ✅ Copied gh.exe → gh for resource bundling`);
		}
	}

	// Create stub placeholders for any STILL-missing variants
	const allVariants = ["gh", "gh-arm64", "gh-x64"];
	for (const v of allVariants) {
		const p = join(binariesDir, v);
		if (!existsSync(p)) {
			if (isWin) {
				writeFileSync(
					p,
					`@echo off\r\necho GitHub CLI variant '${v}' not available for this build. >&2\r\nexit /b 1\r\n`,
				);
			} else {
				writeFileSync(
					p,
					`#!/bin/bash\necho "GitHub CLI variant '${v}' not available for this build." >&2\nexit 1\n`,
				);
			}
			// Make stub executable on Unix
			if (!isWin) {
				try {
					execSync(`chmod +x "${p}"`, { stdio: "inherit" });
				} catch {}
			}
			console.log(`[fetch-gh]   ⚠️ Created stub for ${v}`);
		}
	}

	console.log(`[fetch-gh] ✅ Done — gh v${GH_VERSION} bundled`);
}

// Run
const target = detectTarget();
downloadAndExtract(target);
