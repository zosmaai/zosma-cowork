// Cross-platform prebuild script for Tauri beforeBuildCommand
// Bundles the agent-sidecar into a single self-contained CJS file
// with all dependencies inlined, so no node_modules/ needed at runtime.
//
// The vendored pi-anthropic-messages bridge is managed by
// `agent-sidecar/scripts/fetch-vendor.mjs`, which the sidecar's
// `postinstall` hook runs automatically before tsc/esbuild see the
// source. We don't duplicate that logic here — the `npm ci` below
// triggers it.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Inject the Antigravity OAuth client secret. It is NOT committed to source
// (GitHub secret-scanning would block it, and it shouldn't live in the repo) —
// constants.ts ships a placeholder. Sourced here from $ANTIGRAVITY_CLIENT_SECRET
// or the gitignored agent-sidecar/antigravity-client-secret file, and baked into
// the bundle. If unavailable, the placeholder stays and Gemini (Google) sign-in
// fails with a clear message instead of breaking the build.
console.log("[prebuild] Injecting Antigravity client secret...");
const secretFile = join(sidecarDir, "antigravity-client-secret");
const antigravitySecret =
	(process.env.ANTIGRAVITY_CLIENT_SECRET || "").trim() ||
	(existsSync(secretFile) ? readFileSync(secretFile, "utf-8").trim() : "");
if (antigravitySecret) {
	code = code.split("__ANTIGRAVITY_CLIENT_SECRET__").join(antigravitySecret);
	writeFileSync(bundlePath, code, "utf-8");
	console.log("[prebuild]   client secret injected");
} else {
	console.warn("[prebuild]   no ANTIGRAVITY_CLIENT_SECRET — Gemini (Google) sign-in disabled");
}

// Inject the Zosma Google OAuth config. These are PUBLIC values (the Web
// client_id and the broker's HTTPS URL) — NO secret is ever baked, because the
// secret lives only in the backend broker. Source ships STAGING defaults, so a
// build with neither env var set still works against staging; a prod release
// sets ZOSMA_GOOGLE_CLIENT_ID / ZOSMA_OAUTH_BROKER_URL to override.
console.log("[prebuild] Injecting Zosma Google OAuth config (public)...");
for (const [token, envName] of [
	["__ZOSMA_GOOGLE_CLIENT_ID__", "ZOSMA_GOOGLE_CLIENT_ID"],
	["__ZOSMA_OAUTH_BROKER_URL__", "ZOSMA_OAUTH_BROKER_URL"],
]) {
	const val = (process.env[envName] || "").trim();
	if (val) {
		code = code.split(token).join(val);
		console.log(`[prebuild]   baked ${envName}`);
	} else {
		console.log(`[prebuild]   ${envName} unset — using committed staging default`);
	}
}

// OPT-IN: bake the Zosma Google client SECRET ("Option A"). Off by default —
// when ZOSMA_GOOGLE_CLIENT_SECRET is unset, the placeholder stays unreplaced and
// the brokered secretless flow remains in effect. When set, the secret is baked
// so the upstream pi-google-workspace + @e9n/pi-gmail extensions can self-refresh
// directly with Google. Only do this for a Desktop/Installed OAuth client type.
const zosmaGoogleSecret = (process.env.ZOSMA_GOOGLE_CLIENT_SECRET || "").trim();
if (zosmaGoogleSecret) {
	code = code.split("__ZOSMA_GOOGLE_CLIENT_SECRET__").join(zosmaGoogleSecret);
	console.log("[prebuild]   baked ZOSMA_GOOGLE_CLIENT_SECRET (direct-refresh enabled)");
} else {
	console.log("[prebuild]   ZOSMA_GOOGLE_CLIENT_SECRET unset — brokered secretless flow (default)");
}
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
