/**
 * google-auth/prefs-store — Cowork-owned Google Workspace app config (#281).
 *
 * Two pieces of state that are PURELY a Cowork-broker concern and that pi has
 * NO concept of, so per the pi-native principle they live under
 * `~/.zosmaai/cowork/google-workspace/` (NOT a pi dir):
 *
 *   • scope-prefs.json — the per-product capability selection to REQUEST at
 *     consent (what the user wants the OAuth client to be allowed to do).
 *   • byo-client.json  — an advanced user's OWN Google OAuth client id+secret,
 *     used instead of the Zosma-embedded client. Holds a secret → 0600.
 *
 * The resulting OAuth TOKENS still fan out to pi's dirs (broker.ts) unchanged —
 * pi owns those. Only these two consent INPUTS are Cowork-local.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_PREFS, PRODUCTS, type ScopePrefs } from "./scopes.js";

export interface CoworkGooglePaths {
	/** base ~/.zosmaai dir */
	zosmaDir: string;
	/** ~/.zosmaai/cowork/google-workspace/scope-prefs.json */
	scopePrefs: string;
	/** ~/.zosmaai/cowork/google-workspace/byo-client.json */
	byoClient: string;
}

export function defaultCoworkGooglePaths(
	zosmaDir = join(homedir(), ".zosmaai"),
): CoworkGooglePaths {
	const base = join(zosmaDir, "cowork", "google-workspace");
	return {
		zosmaDir,
		scopePrefs: join(base, "scope-prefs.json"),
		byoClient: join(base, "byo-client.json"),
	};
}

export interface ByoClient {
	clientId: string;
	clientSecret: string;
}

// ── fs helpers (mirror broker.ts conventions; 0600 for secret-bearing files) ──
function readJson<T>(path: string): T | null {
	try {
		if (!existsSync(path)) return null;
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return parsed && typeof parsed === "object" ? (parsed as T) : null;
	} catch {
		return null;
	}
}

function writeJson(path: string, value: unknown): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function removeIfExists(path: string): boolean {
	try {
		if (!existsSync(path)) return false;
		rmSync(path, { force: true });
		return true;
	} catch {
		return false;
	}
}

/** Normalize an arbitrary object into a full ScopePrefs (Off for anything
 * missing/unknown). Keeps stored prefs forward/backward compatible as the
 * product list evolves. */
function normalizePrefs(raw: Partial<Record<string, string>> | null): ScopePrefs {
	const out = {} as ScopePrefs;
	for (const p of PRODUCTS) {
		const v = raw?.[p];
		out[p] = typeof v === "string" && v ? v : "off";
	}
	return out;
}

/** Read the saved scope selection, or DEFAULT_PREFS ("Full access") if unset. */
export function readScopePrefs(paths: CoworkGooglePaths): ScopePrefs {
	const raw = readJson<Record<string, string>>(paths.scopePrefs);
	if (!raw) return { ...DEFAULT_PREFS };
	return normalizePrefs(raw);
}

export function writeScopePrefs(paths: CoworkGooglePaths, prefs: ScopePrefs): void {
	writeJson(paths.scopePrefs, normalizePrefs(prefs));
}

/** Read the user's own OAuth client, or null when using the Zosma client. */
export function readByoClient(paths: CoworkGooglePaths): ByoClient | null {
	const raw = readJson<Partial<ByoClient>>(paths.byoClient);
	if (!raw?.clientId || !raw?.clientSecret) return null;
	return { clientId: raw.clientId, clientSecret: raw.clientSecret };
}

export function writeByoClient(paths: CoworkGooglePaths, byo: ByoClient): void {
	if (!byo.clientId?.trim()) throw new Error("BYO client id is required");
	if (!byo.clientSecret?.trim()) throw new Error("BYO client secret is required");
	writeJson(paths.byoClient, { clientId: byo.clientId.trim(), clientSecret: byo.clientSecret.trim() });
}

/** Delete both Cowork-local Google files; returns the paths actually removed. */
export function clearGooglePrefs(paths: CoworkGooglePaths): string[] {
	const removed: string[] = [];
	if (removeIfExists(paths.scopePrefs)) removed.push(paths.scopePrefs);
	if (removeIfExists(paths.byoClient)) removed.push(paths.byoClient);
	return removed;
}

/** Clear only the BYO client (revert to the Zosma client); keep scope prefs. */
export function clearByoOnly(paths: CoworkGooglePaths): boolean {
	return removeIfExists(paths.byoClient);
}
