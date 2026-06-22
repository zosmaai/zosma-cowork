/**
 * Disk / package extension loader for the bundled sidecar.
 *
 * ## Why this exists (issue #147)
 *
 * In the shipped Tauri app the agent-sidecar runs as a single esbuild CJS
 * bundle with NO `node_modules` tree beside it. pi's own extension loader
 * (`core/extensions/loader.ts`) uses jiti and, in Node mode
 * (`isBunBinary === false`), resolves an extension's imports
 * (`typebox`, `@earendil-works/pi-*`) via `require.resolve` against a real
 * node_modules tree. With no node_modules that resolution throws, so every
 * disk- and npm-installed extension under `~/.pi/agent` fails to load and the
 * errors are silently collected. Only the two statically-bundled inline
 * factories ever registered tools — which is why `web_search`, `fetch_content`
 * et al. never reached the model.
 *
 * ## The fix
 *
 * We load extensions ourselves, exactly the way pi loads them inside a
 * compiled Bun binary: with our OWN jiti instance configured with
 * `virtualModules` that map the packages extensions import to the copies
 * esbuild already bundled into this sidecar. `DefaultResourceLoader` is then
 * told `noExtensions: true` so it does not also try (and fail), and these
 * factories are handed to it via `extensionFactories`.
 *
 * To find WHICH extensions to load (and where their entry files are) we reuse
 * pi's own `DefaultPackageManager.resolve()` — so npm:, git: and local package
 * sources from `~/.pi/agent/settings.json`, plus loose files dropped into
 * `~/.pi/agent/extensions`, are all resolved with pi's real logic.
 *
 * ## Why this runs in dev too (uniform path)
 *
 * We deliberately use this loader in BOTH dev (`tsx`, node_modules present)
 * and the shipped bundle. `virtualModules` resolves `@earendil-works/pi-*` /
 * `typebox` to the SAME module instances `DefaultResourceLoader` uses (one
 * copy in the bundle; the single node_modules copy in dev), so there is no
 * "two copies" hazard, and what we exercise in dev is exactly what ships.
 * TypeBox v1 stores its schema `Kind` as a string (not a module-local
 * Symbol), so schemas built by the bundled typebox validate correctly under
 * pi's typebox even if two copies ever coexisted.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	DefaultPackageManager,
	type ExtensionAPI,
	type ExtensionFactory,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti/static";

// Static imports so esbuild bundles these into the sidecar. They are the
// modules extensions are allowed to import; `virtualModules` (below) maps the
// bare specifiers to these in-bundle copies. Mirrors the VIRTUAL_MODULES map
// in pi's own core/extensions/loader.ts.
import * as _piAgentCore from "@earendil-works/pi-agent-core";
import * as _piAi from "@earendil-works/pi-ai";
import * as _piAiOauth from "@earendil-works/pi-ai/oauth";
import * as _piCodingAgent from "@earendil-works/pi-coding-agent";
import * as _piTui from "@earendil-works/pi-tui";
import * as _typebox from "typebox";
import * as _typeboxCompile from "typebox/compile";
import * as _typeboxValue from "typebox/value";

const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox: _typebox,
	"typebox/compile": _typeboxCompile,
	"typebox/value": _typeboxValue,
	"@sinclair/typebox": _typebox,
	"@sinclair/typebox/compile": _typeboxCompile,
	"@sinclair/typebox/value": _typeboxValue,
	"@earendil-works/pi-agent-core": _piAgentCore,
	"@earendil-works/pi-tui": _piTui,
	"@earendil-works/pi-ai": _piAi,
	"@earendil-works/pi-ai/oauth": _piAiOauth,
	"@earendil-works/pi-coding-agent": _piCodingAgent,
	// Legacy scope some published extensions still import under.
	"@mariozechner/pi-agent-core": _piAgentCore,
	"@mariozechner/pi-tui": _piTui,
	"@mariozechner/pi-ai": _piAi,
	"@mariozechner/pi-ai/oauth": _piAiOauth,
	"@mariozechner/pi-coding-agent": _piCodingAgent,
};

let _jiti: ReturnType<typeof createJiti> | null = null;
function getJiti(): ReturnType<typeof createJiti> {
	if (!_jiti) {
		_jiti = createJiti(import.meta.url, {
			// Cache transpiled modules for the process: we load extensions once
			// at startup and never hot-reload them, so caching avoids
			// re-transpiling shared dependency trees per extension.
			moduleCache: true,
			// Like pi's Bun-binary path: jiti handles ALL imports so that
			// `virtualModules` always wins for the bundled packages, while the
			// extension's own deps resolve from its on-disk node_modules.
			virtualModules: VIRTUAL_MODULES,
			tryNative: false,
		});
	}
	return _jiti;
}

/** pi's canonical agent directory (~/.pi/agent). */
export function piAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

/**
 * Read the `packages` array from pi's settings.json. These are the npm:/git:/
 * local extension+skill sources the pi CLI has installed. Returning them lets
 * us (and the resource loader) resolve pi's shared packages, not just loose
 * files. Returns [] if the file is absent or malformed.
 */
export function readPiPackages(agentDir: string = piAgentDir()): string[] {
	const file = join(agentDir, "settings.json");
	if (!existsSync(file)) return [];
	try {
		const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
			packages?: unknown;
		};
		if (!Array.isArray(parsed.packages)) return [];
		// pi package sources are strings ("npm:foo", "git:...", "../local").
		return parsed.packages.filter((p): p is string => typeof p === "string");
	} catch {
		return [];
	}
}

/**
 * Resolve the entry-file paths of all enabled extensions using pi's own
 * package manager (handles npm/git/local sources + loose files in
 * agentDir/extensions). Missing sources are skipped rather than installed —
 * startup must never block on the network.
 */
export async function resolveEnabledExtensionPaths(opts: {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	/**
	 * npm package names whose disk extension must NOT be loaded because an owned,
	 * in-sidecar extension supersedes it (e.g. "pi-google-workspace" is replaced
	 * by the broker-aware google-workspace/ extension). Prevents duplicate
	 * tool-name registration when a user still has the upstream package installed.
	 */
	excludePackages?: string[];
}): Promise<string[]> {
	const pm = new DefaultPackageManager({
		cwd: opts.cwd,
		agentDir: opts.agentDir,
		settingsManager: opts.settingsManager,
	});
	const resolved = await pm.resolve(async () => "skip");
	const excluded = opts.excludePackages ?? [];
	const isExcluded = (p: string): boolean =>
		excluded.some((pkg) => p.includes(`node_modules/${pkg}/`) || p.includes(`/${pkg}/`));
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const res of resolved.extensions) {
		if (!res.enabled) continue;
		if (seen.has(res.path)) continue;
		if (isExcluded(res.path)) continue;
		seen.add(res.path);
		paths.push(res.path);
	}
	return paths;
}

/**
 * Wrap an extension entry path as an ExtensionFactory that loads the module
 * through our virtualModules-backed jiti and invokes its default-exported
 * factory. Errors are rethrown with the real path (the resource loader only
 * knows these as `<inline:N>`).
 */
export function makeExtensionFactory(entryPath: string): ExtensionFactory {
	return async (pi: ExtensionAPI) => {
		let factory: unknown;
		try {
			// `{ default: true }` returns the module's default export directly,
			// matching pi's own loadExtensionModule().
			factory = await getJiti().import(entryPath, { default: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`failed to load extension ${entryPath}: ${message}`);
		}
		if (typeof factory !== "function") {
			throw new Error(`extension ${entryPath} has no default-exported factory function`);
		}
		await (factory as ExtensionFactory)(pi);
	};
}

/**
 * Build extension factories for every enabled pi extension. Returns the
 * factories (to pass to DefaultResourceLoader.extensionFactories alongside the
 * vendored inline ones) and the resolved entry paths (for logging).
 */
export async function buildExtensionFactories(opts: {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	/** Packages superseded by an owned in-sidecar extension; see resolveEnabledExtensionPaths. */
	excludePackages?: string[];
}): Promise<{ factories: ExtensionFactory[]; paths: string[] }> {
	const paths = await resolveEnabledExtensionPaths(opts);
	return { factories: paths.map(makeExtensionFactory), paths };
}
