/**
 * Zosma Cowork — Extension Manager (pi-native)
 *
 * Cowork is a thin GUI helper over the pi coding agent. pi is the single
 * source of truth for what is installed: extensions live in pi's settings
 * (`~/.pi/agent/settings.json` `packages`, plus project `.pi/settings.json`)
 * and on disk under `~/.pi/agent/npm` / `.pi/npm` / loose `extensions/` dirs.
 *
 * Detection, install and uninstall are delegated to pi's own
 * `DefaultPackageManager` — the exact machinery the pi CLI uses — so the Store
 * UI can never diverge from what actually loads (this killed the stale
 * `cowork-extensions.json` ghosts that reported real packages as
 * `installed: false`, which in turn hid bespoke setup screens like the
 * pi-messenger-bridge Discord config). See issue #147.
 *
 * The ONLY Cowork-specific state is a small enabled-preference overlay
 * (`~/.pi/agent/cowork-extensions.json`, `enabled` flags keyed by pi source id):
 * pi has no simple per-resource on/off, so the Store remembers the user's
 * toggle here. Install truth always comes from pi.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────────────────

export type ExtensionSourceType = "npm" | "git" | "local" | "url";
export type ResourceScope = "user" | "project" | "temporary";

export interface ExtensionSource {
	type: ExtensionSourceType;
	value: string;
	ref?: string;
}

export interface ZemExtension {
	id: string;
	name: string;
	version: string;
	description: string;
	author?: string;
	icon?: string;
	category?: string;
	source: ExtensionSource;
	capabilities: {
		tools?: { name: string; description: string }[];
		skills?: string[];
		commands?: { name: string; description: string }[];
	};
	runtime: "pi" | "dhara" | "native";
	installed: boolean;
	enabled: boolean;
	/** pi install scope this resource was resolved from (status display). */
	scope?: ResourceScope;
	installPath?: string;
	config?: Record<string, unknown>;
	configSchema?: Record<string, unknown>;
}

// ─── Paths ───────────────────────────────────────────────────────────

/** pi's canonical agent directory (~/.pi/agent) — the source of truth. */
function piAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

/**
 * Cowork enabled-preference overlay. Keyed by pi source id ("npm:foo",
 * "../local"). Holds ONLY `enabled` flags (+ optional UI config), never the
 * install list — pi owns that. Legacy install-tracking keys are ignored.
 */
function prefsFile(): string {
	return join(piAgentDir(), "cowork-extensions.json");
}

interface ExtPref {
	enabled?: boolean;
	config?: Record<string, unknown>;
}
interface ExtPrefs {
	extensions: Record<string, ExtPref>;
}

function loadPrefs(): ExtPrefs {
	const fp = prefsFile();
	if (!existsSync(fp)) return { extensions: {} };
	try {
		const parsed = JSON.parse(readFileSync(fp, "utf-8")) as Partial<ExtPrefs>;
		return { extensions: parsed.extensions ?? {} };
	} catch {
		return { extensions: {} };
	}
}

function savePrefs(prefs: ExtPrefs): void {
	writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2), "utf-8");
}

// ─── pi package manager ──────────────────────────────────────────────

/**
 * Build a pi `DefaultPackageManager` bound to a workspace `cwd`, backed by a
 * disk SettingsManager so install/uninstall persist to the real
 * settings.json files (user + project), exactly like the pi CLI.
 */
function makePackageManager(cwd: string): DefaultPackageManager {
	const settingsManager = SettingsManager.create(cwd, piAgentDir());
	return new DefaultPackageManager({ cwd, agentDir: piAgentDir(), settingsManager });
}

function sourceOf(spec: string): ExtensionSource {
	if (spec.startsWith("npm:")) return { type: "npm", value: spec.slice(4) };
	if (
		spec.startsWith("git:") ||
		spec.startsWith("http://") ||
		spec.startsWith("https://") ||
		spec.startsWith("ssh://") ||
		spec.startsWith("git@")
	) {
		return { type: "git", value: spec.replace(/^git:/, "") };
	}
	return { type: "local", value: spec };
}

/** Walk up from a resolved entry path to its owning package.json directory. */
function nearestPackageDir(entryPath: string): string {
	let dir = existsSync(entryPath) && !isDirectory(entryPath) ? dirname(entryPath) : entryPath;
	for (let i = 0; i < 8; i++) {
		if (existsSync(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return existsSync(entryPath) && !isDirectory(entryPath) ? dirname(entryPath) : entryPath;
}

function isDirectory(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

// ─── Discover (pi-native) ────────────────────────────────────────────

/**
 * List installed extensions exactly as pi resolves them for `cwd` — merging
 * user (`~/.pi/agent`) and project (`<cwd>/.pi`) scopes, with project winning
 * on dedupe. Every entry is genuinely installed; `enabled` reflects the Cowork
 * overlay (default on); `scope` reports where pi found it.
 *
 * `zosmaDir` is kept for call-site compatibility but unused — resources are
 * pi's, not cowork's.
 */
export async function discoverExtensions(
	_zosmaDir: string,
	cwd: string = homedir(),
): Promise<ZemExtension[]> {
	const pm = makePackageManager(cwd);
	const resolved = await pm.resolve(async () => "skip");
	const prefs = loadPrefs();
	const out: ZemExtension[] = [];
	const seen = new Set<string>();

	for (const res of resolved.extensions) {
		const id = res.metadata.source;
		if (seen.has(id)) continue;
		seen.add(id);

		const installDir = res.metadata.baseDir ?? nearestPackageDir(res.path);
		const meta = readExtensionMeta(installDir) ?? readExtensionMeta(res.path);
		const pref = prefs.extensions[id];

		out.push({
			id,
			name: meta?.name || basename(installDir) || id,
			version: meta?.version || "0.0.0",
			description: meta?.description || "",
			author: meta?.author,
			icon: meta?.icon,
			category: meta?.category,
			source: sourceOf(id),
			capabilities: meta?.capabilities || {},
			runtime: "pi",
			installed: true,
			enabled: pref?.enabled !== false && res.enabled,
			scope: res.metadata.scope,
			installPath: installDir,
			config: pref?.config,
			configSchema: meta?.configSchema,
		});
	}

	return out;
}

// ─── Read metadata from a package directory ──────────────────────────

function readExtensionMeta(installPath: string): {
	name?: string;
	version?: string;
	description?: string;
	author?: string;
	icon?: string;
	category?: string;
	capabilities?: ZemExtension["capabilities"];
	config?: Record<string, unknown>;
	configSchema?: Record<string, unknown>;
} | null {
	try {
		const pkgPath = join(installPath, "package.json");
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			const piExt = pkg.pi?.extensions?.[0];
			return {
				name: pkg.name || basename(installPath),
				version: pkg.version || "0.0.0",
				description: pkg.description || "",
				author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name,
				icon: pkg.pi?.icon,
				category: pkg.pi?.category,
				capabilities: {
					tools: piExt?.tools?.map((t: { name: string; description: string }) => ({
						name: t.name,
						description: t.description,
					})),
					skills: pkg.pi?.skills,
					commands: piExt?.commands?.map((c: { name: string; description: string }) => ({
						name: c.name,
						description: c.description,
					})),
				},
				configSchema: piExt?.configSchema,
			};
		}

		// Single .ts/.js entry file — minimal metadata from the file name.
		if ((installPath.endsWith(".ts") || installPath.endsWith(".js")) && existsSync(installPath)) {
			return {
				name: basename(installPath).replace(/\.(ts|js)$/, ""),
				version: "0.0.0",
				description: `Pi extension: ${basename(installPath)}`,
			};
		}
	} catch {
		// Ignore read errors — fall through to null.
	}
	return null;
}

// ─── Install / uninstall (pi-native) ─────────────────────────────────

/**
 * Install via pi's package manager and persist to settings — identical to
 * `pi install` (global) / `pi install -l` (project). pi owns placement, so the
 * old `npm pack` drop-in (and its duplicate-tool "conflicts" hazard) is gone.
 */
export async function installExtension(
	zosmaDir: string,
	source: string,
	ref?: string,
	cwd: string = homedir(),
	local = false,
): Promise<ZemExtension> {
	const spec = ref && source.startsWith("npm:") ? `${source}@${ref}` : source;
	const pm = makePackageManager(cwd);
	await pm.installAndPersist(spec, { local });

	const list = await discoverExtensions(zosmaDir, cwd);
	const bare = source.replace(/^npm:/, "");
	const match =
		list.find((e) => e.id === source || e.id === spec) ??
		list.find((e) => e.source.value === bare || e.id.includes(bare));
	if (match) return match;

	// Fallback: report success even if re-resolution missed it (rare).
	return {
		id: source,
		name: bare,
		version: "0.0.0",
		description: "",
		source: sourceOf(source),
		capabilities: {},
		runtime: "pi",
		installed: true,
		enabled: true,
		scope: local ? "project" : "user",
	};
}

/** Uninstall via pi's package manager (removes from settings + disk). */
export async function uninstallExtension(
	_zosmaDir: string,
	extensionId: string,
	cwd: string = homedir(),
	local = false,
): Promise<void> {
	const pm = makePackageManager(cwd);
	await pm.removeAndPersist(extensionId, { local });
	// Drop any stale enabled-pref for this id.
	const prefs = loadPrefs();
	if (prefs.extensions[extensionId]) {
		delete prefs.extensions[extensionId];
		savePrefs(prefs);
	}
}

// ─── Enable / disable + config (Cowork preference overlay) ───────────

export function setExtensionEnabled(
	_zosmaDir: string,
	extensionId: string,
	enabled: boolean,
): void {
	const prefs = loadPrefs();
	prefs.extensions[extensionId] = { ...prefs.extensions[extensionId], enabled };
	savePrefs(prefs);
}

export function setExtensionConfig(
	_zosmaDir: string,
	extensionId: string,
	config: Record<string, unknown>,
): void {
	const prefs = loadPrefs();
	prefs.extensions[extensionId] = { ...prefs.extensions[extensionId], config };
	savePrefs(prefs);
}

// ─── NPM Registry Search ────────────────────────────────────────────

const NPM_REGISTRY = "https://registry.npmjs.org";

const DEFAULT_SEARCHES = [
	"keywords:pi-package",
	"keywords:pi-extension",
	"@earendil-works/pi-",
];
void DEFAULT_SEARCHES;

export function buildSearchQuery(query: string): string {
	const lower = query.toLowerCase().trim();
	if (
		lower === "pi" ||
		lower === "pi extensions" ||
		lower === "pi packages" ||
		lower === "keywords:pi"
	) {
		return "keywords:pi-package";
	}
	if (lower.startsWith("scope:") || lower.startsWith("keywords:") || lower.startsWith("@")) {
		return query;
	}
	if (lower.startsWith("@zosmaai")) {
		return "scope:@zosmaai keywords:pi";
	}
	return `${query} keywords:pi-package`;
}

export async function searchNpmRegistry(query: string): Promise<
	{
		name: string;
		description: string;
		version: string;
		score: number;
	}[]
> {
	const searchQuery = buildSearchQuery(query);
	const url = `${NPM_REGISTRY}/-/v1/search?text=${encodeURIComponent(searchQuery)}&size=20`;

	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) throw new Error(`npm search returned ${response.status}`);
		const data = (await response.json()) as {
			objects: Array<{
				package: { name: string; description: string; version: string; keywords?: string[] };
				score: { detail: { quality: number; popularity: number; maintenance: number } };
			}>;
		};
		return data.objects.map((obj) => ({
			name: obj.package.name,
			description: obj.package.description || "",
			version: obj.package.version,
			score: Math.round(
				((obj.score.detail.quality +
					obj.score.detail.popularity +
					obj.score.detail.maintenance) /
					3) *
					100,
			),
		}));
	} catch (err) {
		log("npm search failed: %s", err instanceof Error ? err.message : String(err));
		return [];
	}
}

export async function getPackageDetails(pkgName: string): Promise<{
	name: string;
	description: string;
	version: string;
	isPiPackage: boolean;
	piConfig?: Record<string, unknown>;
} | null> {
	const url = `${NPM_REGISTRY}/${encodeURIComponent(pkgName).replace(/^%40/, "@")}`;
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) return null;
		const data = (await response.json()) as {
			name: string;
			description: string;
			version: string;
			keywords?: string[];
		};
		const isPiPackage =
			data.keywords?.includes("pi") ||
			data.keywords?.includes("pi-extension") ||
			data.keywords?.includes("zosma") ||
			data.name?.startsWith("@zosmaai/") ||
			data.name?.startsWith("@earendil-works/pi-") ||
			false;
		return {
			name: data.name,
			description: data.description || "",
			version: data.version,
			isPiPackage,
		};
	} catch {
		return null;
	}
}

// ─── Logging ─────────────────────────────────────────────────────────

function log(...args: unknown[]) {
	process.stderr.write(`[ext-manager] ${args.join(" ")}\n`);
}
