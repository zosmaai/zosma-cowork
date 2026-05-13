// Cross-platform prebuild script for Tauri beforeBuildCommand
// Bundles the agent-sidecar into a single self-contained CJS file
// with all dependencies inlined, so no node_modules/ needed at runtime.

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sidecarDir = join(root, "agent-sidecar");

console.log("[prebuild] Building agent-sidecar bundle...");
execSync("npm ci && npm run bundle", {
	cwd: sidecarDir,
	shell: true,
	stdio: "inherit",
});

// Patch import_meta.url for CJS compatibility
// esbuild outputs var import_meta = {}; but needs import_meta.url for CJS
console.log("[prebuild] Patching import_meta.url...");
const bundlePath = join(sidecarDir, "dist", "bundle.cjs");
let code = readFileSync(bundlePath, "utf-8");
code = code.replace(
	/var (import_meta\d*) = \{\};/g,
	'var $1 = { url: require("url").pathToFileURL(__filename).href };',
);
writeFileSync(bundlePath, code, "utf-8");

// Inline pi-coding-agent's package.json into the bundle to avoid
// needing the file at runtime (the bundled code reads its own
// package.json for name, version, piConfig.configDir, etc.).
console.log("[prebuild] Inlining pi-coding-agent package.json...");
const piPkgPath = join(sidecarDir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
const piPkg = JSON.parse(readFileSync(piPkgPath, "utf-8"));
const inlinedPkg = JSON.stringify({ name: piPkg.name, version: piPkg.version, piConfig: piPkg.piConfig });
code = code.replace(
	'var pkg = JSON.parse((0, import_fs.readFileSync)(getPackageJsonPath(), "utf-8"));',
	`var pkg = ${inlinedPkg};`,
);
writeFileSync(bundlePath, code, "utf-8");

// Copy bundled file into src-tauri/ for Tauri resource bundling
const targetDir = join(root, "src-tauri", "agent-sidecar");
mkdirSync(targetDir, { recursive: true });
// Clean stale files from previous builds
console.log("[prebuild] Cleaning stale artifacts...");
for (const f of ["index.cjs", "index.d.ts", "index.js", "index.js.map", "index.d.ts.map"]) {
	try { rmSync(join(targetDir, f)); } catch { /* ignore */ }
}
console.log("[prebuild] Copying bundle...");
cpSync(bundlePath, join(targetDir, "index.cjs"));

console.log(`[prebuild] Done (${(code.length / 1024 / 1024).toFixed(1)} MB)`);
