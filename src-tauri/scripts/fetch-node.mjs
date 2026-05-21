// Downloads the current platform's Node.js v24 LTS binary during Tauri build.
// Uses TARGET_TRIPLE env var (set by Cargo/Tauri) or auto-detects platform.
// For macOS universal builds, downloads BOTH arm64 and x64 binaries.
// Places binary in src-tauri/binaries/node (or node-arm64 / node-x64 for universal)
// Always creates stub placeholders for all variants so Tauri resource validation passes.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { platform, arch } from "node:os";

const NODE_VERSION = "v24.15.0"; // Current LTS as of May 2026

// Map Rust target triples to Node.js download targets
const TARGET_MAP = {
	// macOS universal — downloads BOTH arm64 and x64
	"universal-apple-darwin": [
		{
			nodeTarget: "darwin-arm64",
			baseUrl: `https://nodejs.org/dist/${NODE_VERSION}`,
			filename: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
			extractCmd: "tar -xzf",
			binaryPath: `node-${NODE_VERSION}-darwin-arm64/bin/node`,
			destName: "node-arm64",
		},
		{
			nodeTarget: "darwin-x64",
			baseUrl: `https://nodejs.org/dist/${NODE_VERSION}`,
			filename: `node-${NODE_VERSION}-darwin-x64.tar.gz`,
			extractCmd: "tar -xzf",
			binaryPath: `node-${NODE_VERSION}-darwin-x64/bin/node`,
			destName: "node-x64",
		},
	],
	// macOS ARM64 (Apple Silicon)
	"aarch64-apple-darwin": {
		nodeTarget: "darwin-arm64",
		baseUrl: `https://nodejs.org/dist/${NODE_VERSION}`,
		filename: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
		extractCmd: "tar -xzf",
		binaryPath: `node-${NODE_VERSION}-darwin-arm64/bin/node`,
		destName: "node",
	},
	// macOS x64 (Intel)
	"x86_64-apple-darwin": {
		nodeTarget: "darwin-x64",
		baseUrl: `https://nodejs.org/dist/${NODE_VERSION}`,
		filename: `node-${NODE_VERSION}-darwin-x64.tar.gz`,
		extractCmd: "tar -xzf",
		binaryPath: `node-${NODE_VERSION}-darwin-x64/bin/node`,
		destName: "node",
	},
	// Linux x64
	"x86_64-unknown-linux-gnu": {
		nodeTarget: "linux-x64",
		baseUrl: `https://nodejs.org/dist/${NODE_VERSION}`,
		filename: `node-${NODE_VERSION}-linux-x64.tar.xz`,
		extractCmd: "tar -xJf",
		binaryPath: `node-${NODE_VERSION}-linux-x64/bin/node`,
		destName: "node",
	},
	// Windows x64
	"x86_64-pc-windows-msvc": {
		nodeTarget: "win-x64",
		baseUrl: `https://nodejs.org/dist/${NODE_VERSION}`,
		filename: `node-${NODE_VERSION}-win-x64.zip`,
		extractCmd: null, // Use different extraction for Windows
		binaryPath: `node-${NODE_VERSION}-win-x64/node.exe`,
		destName: "node.exe",
	},
};

function detectTarget() {
	// Prefer TARGET_TRIPLE from Cargo/Tauri build env
	const targetTriple = process.env.TARGET_TRIPLE;
	if (targetTriple && TARGET_MAP[targetTriple]) {
		return targetTriple;
	}

	// Auto-detect from current platform
	const plat = platform();
	const a = arch();

	if (plat === "darwin" && a === "arm64") return "aarch64-apple-darwin";
	if (plat === "darwin" && a === "x64") return "x86_64-apple-darwin";
	if (plat === "linux" && a === "x64") return "x86_64-unknown-linux-gnu";
	if (plat === "win32" && a === "x64") return "x86_64-pc-windows-msvc";

	throw new Error(`Cannot detect Node.js target for ${plat}-${a}. Set TARGET_TRIPLE env var.`);
}

// Download and extract a single Node.js config
function downloadOne(config, binariesDir) {
	const tmpDir = join(binariesDir, ".tmp-node-extract");
	mkdirSync(tmpDir, { recursive: true });

	const url = `${config.baseUrl}/${config.filename}`;
	const archivePath = join(tmpDir, config.filename);

	console.log(`[fetch-node]   Downloading ${config.nodeTarget}...`);
	execSync(`curl -fSL "${url}" -o "${archivePath}"`, { stdio: "inherit" });

	// Extract
	try {
		if (config.extractCmd) {
			execSync(`${config.extractCmd} "${archivePath}"`, {
				cwd: tmpDir,
				stdio: "inherit",
			});
		} else {
			const isWin = platform() === "win32";
			if (isWin) {
				execSync(
					`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force"`,
					{ stdio: "inherit" }
				);
			} else {
				execSync(`unzip -o "${archivePath}" -d "${tmpDir}"`, { stdio: "inherit" });
			}
		}
	} catch (err) {
		console.error(`[fetch-node] Extraction failed: ${err.message}`);
		process.exit(1);
	}

	// Copy binary to final location
	const srcBinary = join(tmpDir, config.binaryPath);
	const destPath = join(binariesDir, config.destName);

	copyFileSync(srcBinary, destPath);

	// Make executable (Unix only)
	if (platform() !== "win32") {
		execSync(`chmod +x "${destPath}"`, { stdio: "inherit" });
	}

	// Clean up temp files
	try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}

	console.log(`[fetch-node]   ✅ ${config.destName}`);
}

function downloadAndExtract(targetTriple) {
	const config = TARGET_MAP[targetTriple];
	if (!config) {
		throw new Error(`No Node.js download config for target: ${targetTriple}`);
	}

	const rootDir = resolve(import.meta.dirname, "..", "..");
	const srcTauriDir = join(rootDir, "src-tauri");
	const binariesDir = join(srcTauriDir, "binaries");

	// Ensure directories exist
	mkdirSync(binariesDir, { recursive: true });

	console.log(`[fetch-node] Target: ${targetTriple}`);
	console.log(`[fetch-node] Node.js version: ${NODE_VERSION}`);

	// Handle universal macOS (array of configs) vs single target
	if (Array.isArray(config)) {
		console.log(`[fetch-node] Universal build — downloading ${config.length} architectures`);
		for (const c of config) {
			downloadOne(c, binariesDir);
		}
	} else {
		downloadOne(config, binariesDir);
	}

	console.log(`[fetch-node] ✅ Done — Node.js ${NODE_VERSION} bundled`);

	// For single-arch (auto-detected) builds, fetch-node.mjs only places a real
	// binary at `binaries/node`. The Rust runtime's `find_node` looks at the
	// arch-specific variants first, which would hit the shim placeholder
	// created below. To prevent that EPIPE trap, also copy the real binary
	// into the matching arch-specific name so any code path that prefers
	// arch-specific names gets a working binary.
	const isWin = platform() === "win32";
	if (!Array.isArray(config) && !isWin) {
		const arch = process.arch;
		const matchingName =
			arch === "arm64" ? "node-arm64" : arch === "x64" ? "node-x64" : null;
		if (matchingName) {
			const realNode = join(binariesDir, "node");
			const matchingPath = join(binariesDir, matchingName);
			// Overwrite unconditionally — the repo tracks `#!`-shebang shim
			// placeholders for both arch variants so Tauri resource validation
			// passes when checked out fresh; without this we'd leave a stale
			// shim in place that find_node would have to skip.
			if (existsSync(realNode)) {
				copyFileSync(realNode, matchingPath);
				execSync(`chmod +x "${matchingPath}"`, { stdio: "inherit" });
				console.log(`[fetch-node]   ✅ Mirrored node → ${matchingName}`);
			}
		}
	}

	// Create stub placeholders for any STILL-missing variants so Tauri
	// resource validation passes. Real binaries created above take precedence.
	// On Windows, use .cmd stubs because bash scripts won't execute.
	const allVariants = ["node", "node-arm64", "node-x64"];
	for (const v of allVariants) {
		const p = join(binariesDir, v);
		if (!existsSync(p)) {
			if (isWin) {
				// Windows .cmd stub — echoes an error and exits
				writeFileSync(p, `@echo off\r\necho Node.js variant '${v}' not available for this build. >&2\r\nexit /b 1\r\n`);
			} else {
				writeFileSync(p, `#!/bin/bash\necho "Node.js variant '${v}' not available for this build." >&2\nexit 1\n`);
			}
		}
	}

	// On Windows, Tauri resources list "binaries/node" as a resource entry.
	// Since the downloaded binary is "node.exe", we create a copy named "node"
	// so Tauri can bundle it. This makes the resource listing platform-agnostic.
	if (isWin) {
		const nodeExe = join(binariesDir, "node.exe");
		const nodeCopy = join(binariesDir, "node");
		if (existsSync(nodeExe) && !existsSync(nodeCopy)) {
			copyFileSync(nodeExe, nodeCopy);
			console.log(`[fetch-node]   ✅ Copied node.exe → node for Tauri resource bundling`);
		}
	}
}

// Run
const target = detectTarget();
downloadAndExtract(target);
