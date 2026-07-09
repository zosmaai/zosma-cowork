import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guards for the Windows bundled-Node.js `.exe` packaging bug.
 *
 * Symptom: on Windows the Extensions tab (and any npm-backed resource
 * resolution) failed with `spawn …\binaries\node ENOENT`, so extension
 * install was broken for every Windows user.
 *
 * Root cause: three places must agree on the Windows binary name, and they
 * didn't. `fetch-node.mjs` downloads the real Node as `binaries/node.exe`
 * and the Rust launcher spawns `binaries/node.exe`, but `tauri.conf.json`
 * only bundled `binaries/node` (no `.exe`) — so the real `node.exe` was
 * never shipped and the launcher fell back to an unspawnable file. Windows
 * requires the `.exe` extension for `spawnSync` to launch a binary.
 *
 * These assertions keep the three in sync so the bug can't silently return.
 */
const root = resolve(__dirname, "..", "..");
const tauriConf = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const fetchNode = readFileSync(resolve(root, "src-tauri/scripts/fetch-node.mjs"), "utf8");
const libRs = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");

describe("Windows bundled Node.js (.exe) packaging", () => {
	const resources: string[] = tauriConf.bundle.resources;

	it("bundles a Node resource pattern that ships node.exe on Windows", () => {
		// `binaries/node*` (glob) matches node, node.exe, node-arm64, node-x64.
		// An explicit `binaries/node.exe` would also satisfy this. A bare
		// `binaries/node` (no glob, no .exe) does NOT and is the regression.
		const shipsNodeExe = resources.some(
			(r) => r === "binaries/node*" || r === "binaries/node.exe" || r === "binaries/node**",
		);
		expect(shipsNodeExe).toBe(true);
	});

	it("does not rely on the bare extensionless `binaries/node` entry alone", () => {
		const onlyBareNode =
			resources.includes("binaries/node") &&
			!resources.some((r) => r.includes("node*") || r.includes("node.exe"));
		expect(onlyBareNode).toBe(false);
	});

	it("fetch-node.mjs writes the Windows binary as node.exe", () => {
		// The win-x64 target block must use destName "node.exe".
		expect(fetchNode).toMatch(/x86_64-pc-windows-msvc[\s\S]*?destName:\s*"node\.exe"/);
	});

	it("the Rust launcher prefers binaries/node.exe on Windows", () => {
		expect(libRs).toMatch(/binaries_dir\.join\("node\.exe"\)/);
	});
});
