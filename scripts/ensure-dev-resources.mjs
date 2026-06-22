// Ensures the files declared in `src-tauri/tauri.conf.json` → `bundle.resources`
// exist so `tauri dev` (and a bare `cargo build`) can compile.
//
// WHY THIS EXISTS
// ---------------
// Tauri's `build.rs` validates at COMPILE TIME that every `bundle.resources`
// entry exists on disk — regardless of dev vs release. Two of those resources
// are generated build artifacts and are gitignored:
//
//   - src-tauri/agent-sidecar/index.cjs   (produced by scripts/prebuild.mjs)
//   - src-tauri/binaries/node             (fetched by src-tauri/scripts/fetch-node.mjs)
//
// Those generators run from `beforeBuildCommand` (production `tauri build`), but
// NOT from `beforeDevCommand`. So a fresh checkout running `npm run dev` fails
// with `resource path 'agent-sidecar/index.cjs' doesn't exist` before any code
// runs. This script bridges that gap for the dev workflow.
//
// In DEV the sidecar is executed from TypeScript source (`agent-sidecar/src/index.ts`)
// via `tsx`, and the system `node` runs it — so neither the esbuild bundle nor the
// bundled `binaries/node` is ever loaded. They only need to EXIST for the resource
// check. This script therefore writes lightweight STUB placeholders instead of
// running the slow esbuild bundle (~11 MB) and ~50 MB Node download.
//
// Production builds always OVERWRITE these stubs with the real artifacts via
// `beforeBuildCommand`, so a `tauri build` after a `tauri dev` is unaffected.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const srcTauri = join(root, "src-tauri");
const isWin = process.platform === "win32";

let created = 0;

/** Write `contents` to `src-tauri/<relPath>` only if it doesn't already exist. */
function ensure(relPath, contents, { executable = false } = {}) {
	const abs = join(srcTauri, relPath);
	if (existsSync(abs)) return;
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, contents);
	if (executable && !isWin) chmodSync(abs, 0o755);
	console.log(`[ensure-dev-resources] created dev stub: src-tauri/${relPath}`);
	created++;
}

// 1. Sidecar bundle. Never loaded in dev (the sidecar runs from src/index.ts via
//    tsx). The real bundle is produced by scripts/prebuild.mjs during `tauri build`.
ensure(
	join("agent-sidecar", "index.cjs"),
	[
		"// DEV STUB — not used in `tauri dev` (the sidecar runs from",
		"// agent-sidecar/src/index.ts via tsx). The real bundle is produced by",
		"// scripts/prebuild.mjs during a production `tauri build`.",
		'throw new Error("agent-sidecar/index.cjs is a dev stub — run `npm run build` to generate the real bundle.");',
		"",
	].join("\n"),
);

// 2. Bundled Node.js binaries. Never spawned in dev (the system node/tsx runs the
//    sidecar). Use the same shell-stub format fetch-node.mjs writes for unavailable
//    variants — Rust's lib.rs sniffs the first bytes and skips stub placeholders.
//    `node-arm64` / `node-x64` are committed stubs and already exist; only the
//    gitignored `node` is created here on a fresh checkout.
for (const variant of ["node", "node-arm64", "node-x64"]) {
	ensure(
		join("binaries", variant),
		isWin
			? `@echo off\r\necho Node.js stub '${variant}' is a dev placeholder, not for execution. 1>&2\r\nexit /b 1\r\n`
			: `#!/bin/bash\necho "Node.js stub '${variant}' is a dev placeholder, not for execution." >&2\nexit 1\n`,
		{ executable: true },
	);
}

// 3. Bundled gh and git binaries. The fetch-gh.mjs / fetch-git.mjs scripts
//    download these during beforeDevCommand, but cargo build starts in
//    parallel and needs the directories to EXIST (glob patterns in
//    bundle.resources). Create stub placeholders if the fetch hasn't
//    finished yet; the real download overwrites them.
for (const tool of ["gh", "git"]) {
	// Create the directory with a stub that explains what happened.
	const stubContent = isWin
		? `@echo off\r\necho ${tool} stub is a dev placeholder — the fetch script hasn't completed yet. 1>&2\r\nexit /b 1\r\n`
		: `#!/bin/bash\necho "${tool} stub is a dev placeholder — the fetch script hasn't completed yet." >&2\nexit 1\n`;

	for (const variant of [tool, `${tool}-arm64`, `${tool}-x64`]) {
		ensure(join("binaries", tool, variant), stubContent, { executable: true });
	}
}

if (created === 0) {
	console.log("[ensure-dev-resources] all bundle resources present — nothing to do.");
} else {
	console.log(
		`[ensure-dev-resources] ${created} dev stub(s) created. Run \`npm run build\` for a real production bundle.`,
	);
}
