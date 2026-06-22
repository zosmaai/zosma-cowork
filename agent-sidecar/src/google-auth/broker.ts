/**
 * google-auth/broker — Cowork's single Google OAuth broker (epic #180 / B2 #186).
 *
 * Cowork owns ONE Zosma-embedded OAuth client and runs ONE consent for the
 * UNION of scopes the curated Google packages need. After consent it fans the
 * resulting credentials out to the two real config locations each package reads
 * (the "config-routing layer"), so a single "Connect Google" provisions Gmail,
 * Calendar, Drive, Docs, Sheets and Slides — and the same files also work from
 * the `pi` CLI.
 *
 *   Destination 1 — ~/.pi/agent/google-workspace/oauth.json
 *     Shape: AuthConfig { clientId, clientSecret, redirectUri, tokens }
 *     Read by: pi-google-workspace AND the owned google_calendar extension
 *     (they deliberately SHARE this one file — see google-calendar/auth.ts).
 *
 *   Destination 2 — ~/.pi/agent/settings.json["pi-gmail"] + ~/.pi/agent/db/gmail-tokens.json
 *     Shape: GmailSettings { clientId, clientSecret } + OAuthTokens
 *            { access_token, refresh_token, expires_at, scope, email }
 *     Read by: @e9n/pi-gmail
 *
 * Extensions read + self-refresh these files at tool-call time; Cowork only
 * brokers consent / disconnect. NOTE the two expiry field names differ on
 * purpose to match each package: workspace uses `expiry_date`, gmail uses
 * `expires_at` (both ms epoch).
 *
 * The actual consent (loopback redirect + PKCE) lives in `consent.ts`; this
 * module owns the credential FAN-OUT, STATUS probe, DISCONNECT and one-time
 * legacy MIGRATION — all pure / filesystem-only so they are unit-testable
 * without touching the network.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	grantedCapabilities,
	PRODUCTS,
	type ScopePrefs,
	type ScopeTier,
	tierOf,
} from "./scopes.js";
import {
	clearGooglePrefs,
	type CoworkGooglePaths,
	readByoClient,
	readScopePrefs,
} from "./prefs-store.js";

// ── Union scopes requested at consent ───────────────────────────
// gmail.modify + calendar + drive + documents + spreadsheets + presentations,
// plus openid/email/profile so we can resolve the connected account email.
export const GOOGLE_SCOPES = {
	gmail: "https://www.googleapis.com/auth/gmail.modify",
	calendar: "https://www.googleapis.com/auth/calendar",
	drive: "https://www.googleapis.com/auth/drive",
	docs: "https://www.googleapis.com/auth/documents",
	sheets: "https://www.googleapis.com/auth/spreadsheets",
	slides: "https://www.googleapis.com/auth/presentations",
} as const;

export type GoogleProduct = keyof typeof GOOGLE_SCOPES;

export const IDENTITY_SCOPES = ["openid", "email", "profile"] as const;

/** Full union scope list (products + identity). */
export const UNION_SCOPES: string[] = [...Object.values(GOOGLE_SCOPES), ...IDENTITY_SCOPES];

// ── Embedded Zosma OAuth client + token broker ──────────────────
// The device ships ONLY the PUBLIC client_id and the broker URL — never a
// secret (anything in a desktop bundle is extractable). The Web-application
// client SECRET lives only in the backend broker (Secret Manager); consent code
// exchange and token refresh are done by POSTing to the broker, which adds the
// secret server-side. See services/oauth-broker/.
//
// `clientSecret` remains here only for BACKWARD COMPAT with any legacy on-disk
// config that still carries one (direct-refresh fallback); new connects leave
// it empty and route everything through the broker.

// Both of these are PUBLIC by design (the client_id is visible in every consent
// URL; the broker URL is a public HTTPS endpoint). They are safe to commit and
// to ship in the desktop bundle. The SECRET never lives here — it stays in the
// broker (Secret Manager). Defaults point at STAGING; a prod release overrides
// them via the build-time bake below (scripts/prebuild.mjs) or env.
/** Default deployed staging broker. Override with ZOSMA_OAUTH_BROKER_URL. */
export const DEFAULT_BROKER_URL = "https://broker-uoux53xara-uc.a.run.app";
/** Default (staging) public Web client id. Override with ZOSMA_GOOGLE_CLIENT_ID. */
export const DEFAULT_CLIENT_ID =
	"830231223031-pukjd742a01uau7oekvrs231fb737eo0.apps.googleusercontent.com";

// Build-time bake slots. scripts/prebuild.mjs replaces these literals with the
// matching env var's value at `tauri build` time when set (so a packaged app
// launched from its icon — which has no shell env — still gets the right values).
// Left unreplaced (still starting with "__ZOSMA_") they are ignored.
const BAKED_CLIENT_ID = "__ZOSMA_GOOGLE_CLIENT_ID__";
const BAKED_BROKER_URL = "__ZOSMA_OAUTH_BROKER_URL__";
// OPT-IN direct-secret slot ("Option A"). Unset by default → the brokered,
// secretless flow stays the default and NOTHING is baked. When a build/dev env
// supplies ZOSMA_GOOGLE_CLIENT_SECRET (or prebuild bakes this slot), the secret
// is written into the package config files so the upstream pi-google-workspace
// and @e9n/pi-gmail extensions — which self-refresh DIRECTLY with Google and
// require a client_secret — work without a broker round-trip. Trade-off: a baked
// secret is extractable from the bundle; only acceptable for a Desktop/Installed
// OAuth client type (where Google does not treat the secret as confidential).
const BAKED_CLIENT_SECRET = "__ZOSMA_GOOGLE_CLIENT_SECRET__";
const unbaked = (v: string): string => (v.startsWith("__ZOSMA_") ? "" : v.trim());

/** Resolved broker base URL (env → baked → staging default; slashes trimmed). */
export function brokerUrl(): string {
	const raw =
		process.env.ZOSMA_OAUTH_BROKER_URL?.trim() || unbaked(BAKED_BROKER_URL) || DEFAULT_BROKER_URL;
	return raw.replace(/\/+$/, "");
}

/** Resolved public client id (env → baked → staging default). */
export function resolveClientId(): string {
	return process.env.ZOSMA_GOOGLE_CLIENT_ID?.trim() || unbaked(BAKED_CLIENT_ID) || DEFAULT_CLIENT_ID;
}

/**
 * Resolved Zosma client secret (env → baked → ""). Empty by default, which
 * keeps the brokered secretless flow. When non-empty, fan-out writes it so the
 * upstream Google extensions can self-refresh directly. See BAKED_CLIENT_SECRET.
 */
export function resolveClientSecret(): string {
	return process.env.ZOSMA_GOOGLE_CLIENT_SECRET?.trim() || unbaked(BAKED_CLIENT_SECRET) || "";
}

export interface EmbeddedClient {
	clientId: string;
	/** Empty for broker-based connects; only set for legacy direct flows. */
	clientSecret: string;
	/** Backend broker base URL that custodies the secret. */
	brokerUrl: string;
}

/** A user-supplied OAuth client (bring-your-own). */
export interface ByoClientInput {
	clientId: string;
	clientSecret: string;
}

/**
 * Resolve the OAuth client to use, in precedence order:
 *   1. bring-your-own client (id+secret) — the device holds the secret, so
 *      refresh/exchange go DIRECT to Google (brokerUrl cleared, no Zosma broker).
 *   2. env `ZOSMA_GOOGLE_CLIENT_ID`/`_SECRET` + the resolved broker URL.
 *   3. build-baked Zosma public client + broker (the default brokered flow).
 */
export function embeddedClient(byo?: ByoClientInput | null): EmbeddedClient {
	if (byo?.clientId && byo?.clientSecret) {
		return { clientId: byo.clientId, clientSecret: byo.clientSecret, brokerUrl: "" };
	}
	// Keep the broker URL for the INITIAL code exchange (the Zosma Web client's
	// only registered redirect_uri is the broker /callback; the ephemeral
	// loopback port is not registered, so direct code exchange would fail). When
	// a direct secret is present (Option A), ALSO write it so the upstream
	// pi-google-workspace + @e9n/pi-gmail extensions can self-refresh directly
	// with Google (token refresh needs no redirect_uri). The owned calendar
	// extension then also refreshes directly (clientSecret present → useBroker
	// false), so all tools behave consistently.
	return {
		clientId: resolveClientId(),
		clientSecret: resolveClientSecret(),
		brokerUrl: brokerUrl(),
	};
}

/** Ready to connect when we have the public client_id + a broker URL. */
export function hasEmbeddedClient(): boolean {
	const c = embeddedClient();
	return Boolean(c.clientId && c.brokerUrl);
}

// ── Config destinations (path-injectable for tests) ─────────────
export interface GooglePaths {
	/** pi agent dir, e.g. ~/.pi/agent */
	agentDir: string;
	/** ~/.pi/agent/google-workspace/oauth.json */
	workspaceOAuth: string;
	/** ~/.pi/agent/settings.json (pi global settings — holds "pi-gmail") */
	piSettings: string;
	/** ~/.pi/agent/db/gmail-tokens.json */
	gmailTokens: string;
	/** legacy single-config path from the original plan (~/.pi/agent/google/oauth.json) */
	legacyOAuth: string;
}

export function defaultGooglePaths(agentDir = join(homedir(), ".pi", "agent")): GooglePaths {
	return {
		agentDir,
		workspaceOAuth: join(agentDir, "google-workspace", "oauth.json"),
		piSettings: join(agentDir, "settings.json"),
		gmailTokens: join(agentDir, "db", "gmail-tokens.json"),
		legacyOAuth: join(agentDir, "google", "oauth.json"),
	};
}

// ── Shapes the curated packages read ────────────────────────────
export interface OAuthTokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
}

interface WorkspaceTokens {
	access_token: string;
	refresh_token?: string;
	token_type?: string;
	scope?: string;
	expiry_date?: number;
}

interface WorkspaceConfig {
	clientId: string;
	/** Empty when refresh is delegated to the broker (preferred). */
	clientSecret: string;
	/** Broker base URL used to refresh without a local secret. */
	brokerUrl?: string;
	redirectUri?: string;
	tokens: WorkspaceTokens;
}

interface GmailTokens {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	scope: string;
	email: string;
}

// ── Small fs helpers ────────────────────────────────────────────
function readJson<T = Record<string, unknown>>(path: string): T | null {
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

// ── Fan-out ─────────────────────────────────────────────────────
export interface FanOutInput {
	client: EmbeddedClient;
	tokens: OAuthTokenResponse;
	/** account email resolved from the userinfo endpoint */
	email: string;
	/** the loopback redirect URI used during consent */
	redirectUri: string;
	/** clock injection for deterministic tests */
	now?: number;
	/**
	 * The capability selection this consent was for. Drives WHICH destinations
	 * get written: a product that is "off" has its destination skipped (and any
	 * stale prior file removed). Omitted ⇒ all products selected (legacy/full).
	 */
	prefs?: ScopePrefs;
}

/** Workspace oauth.json is shared by pi-google-workspace + google_calendar. */
const WORKSPACE_PRODUCTS = PRODUCTS.filter((p) => p !== "gmail");

function gmailSelected(prefs?: ScopePrefs): boolean {
	return !prefs || prefs.gmail !== "off";
}

function workspaceSelected(prefs?: ScopePrefs): boolean {
	return !prefs || WORKSPACE_PRODUCTS.some((p) => prefs[p] !== "off");
}

/**
 * Write the brokered credentials into BOTH real destinations in the exact
 * formats each package reads. Idempotent: re-running merges over existing files
 * (e.g. preserves a Gmail refresh_token / maxResults if Google omits them on a
 * re-consent without `prompt=consent`).
 */
export function fanOutCredentials(paths: GooglePaths, input: FanOutInput): void {
	const now = input.now ?? Date.now();
	const expiresInMs = (input.tokens.expires_in ?? 3600) * 1000;
	const scope = input.tokens.scope ?? UNION_SCOPES.join(" ");

	// Destination 1 — shared workspace + calendar oauth.json (AuthConfig shape).
	// Written only when at least one workspace product (calendar/drive/docs/
	// sheets/slides) is selected; otherwise removed so granted state matches.
	if (!workspaceSelected(input.prefs)) {
		removeIfExists(paths.workspaceOAuth);
	} else {
	const prevWs = readJson<WorkspaceConfig>(paths.workspaceOAuth);
	const wsConfig: WorkspaceConfig = {
		clientId: input.client.clientId,
		// Broker connects ship NO secret to disk; refresh goes via brokerUrl.
		clientSecret: input.client.clientSecret,
		brokerUrl: input.client.brokerUrl,
		redirectUri: input.redirectUri,
		tokens: {
			access_token: input.tokens.access_token,
			// Google omits refresh_token when re-consenting without prompt=consent;
			// keep the prior one so self-refresh keeps working.
			refresh_token: input.tokens.refresh_token ?? prevWs?.tokens?.refresh_token,
			token_type: input.tokens.token_type ?? "Bearer",
			scope,
			expiry_date: now + expiresInMs,
		},
	};
	writeJson(paths.workspaceOAuth, wsConfig);
	}

	// Destination 2 — pi-gmail (settings creds + token file). Written only when
	// Gmail is selected; otherwise both are removed (the gmail token file is
	// cleared; pi-gmail's non-credential settings keys are preserved).
	if (!gmailSelected(input.prefs)) {
		removeIfExists(paths.gmailTokens);
		const settings = readJson<Record<string, unknown>>(paths.piSettings);
		if (settings && settings["pi-gmail"] && typeof settings["pi-gmail"] === "object") {
			const gmail = { ...(settings["pi-gmail"] as Record<string, unknown>) };
			delete gmail.clientId;
			delete gmail.clientSecret;
			settings["pi-gmail"] = gmail;
			writeJson(paths.piSettings, settings);
		}
		return;
	}

	// Destination 2a — pi-gmail client creds in pi's global settings.json.
	// Merge so we never clobber unrelated settings keys or pi-gmail's own
	// maxResults / notifications config.
	const settings = readJson<Record<string, unknown>>(paths.piSettings) ?? {};
	const prevGmail =
		settings["pi-gmail"] && typeof settings["pi-gmail"] === "object"
			? (settings["pi-gmail"] as Record<string, unknown>)
			: {};
	settings["pi-gmail"] = {
		...prevGmail,
		clientId: input.client.clientId,
		clientSecret: input.client.clientSecret,
	};
	writeJson(paths.piSettings, settings);

	// Destination 2b — gmail-tokens.json (OAuthTokens shape, `expires_at`).
	const prevGmailTokens = readJson<GmailTokens>(paths.gmailTokens);
	const gmailTokens: GmailTokens = {
		access_token: input.tokens.access_token,
		refresh_token: input.tokens.refresh_token ?? prevGmailTokens?.refresh_token ?? "",
		expires_at: now + expiresInMs,
		scope,
		email: input.email,
	};
	writeJson(paths.gmailTokens, gmailTokens);
}

// ── Status ──────────────────────────────────────────────────────
export interface GoogleStatus {
	connected: boolean;
	email: string | null;
	scopes: string[];
	/** per-product: is ANY scope for it granted (legacy boolean view). */
	products: Record<GoogleProduct, boolean>;
	/** per-product GRANTED capability id (off|read|…) — the diff target. */
	granted: Record<GoogleProduct, string>;
	/** the saved selection the user REQUESTED (from Cowork prefs), if available. */
	requested?: ScopePrefs;
	/** most severe tier of the requested selection (UI warning), if available. */
	requestedTier?: ScopeTier | null;
	/** true when connected via a bring-your-own OAuth client. */
	byo: boolean;
	destinations: {
		workspaceOAuth: { present: boolean; path: string };
		gmailSettings: { present: boolean };
		gmailTokens: { present: boolean; path: string };
	};
}

function productsFromScope(scope: string): Record<GoogleProduct, boolean> {
	const out = {} as Record<GoogleProduct, boolean>;
	for (const [product, scopeUrl] of Object.entries(GOOGLE_SCOPES) as [GoogleProduct, string][]) {
		out[product] = scope.includes(scopeUrl);
	}
	return out;
}

/**
 * Read all destinations and report connected state + granted/requested scopes.
 * When `cowork` paths are supplied we also surface the saved REQUESTED selection
 * and whether a bring-your-own client is configured (for the granted-vs-
 * requested status UI).
 */
export function googleStatus(paths: GooglePaths, cowork?: CoworkGooglePaths): GoogleStatus {
	const ws = readJson<WorkspaceConfig>(paths.workspaceOAuth);
	const gmailTokens = readJson<GmailTokens>(paths.gmailTokens);
	const settings = readJson<Record<string, unknown>>(paths.piSettings) ?? {};
	const gmailSettings = settings["pi-gmail"] as Record<string, unknown> | undefined;

	// Connected if EITHER destination carries an access token (gmail-only connects
	// skip the workspace oauth.json, and vice versa).
	const connected = Boolean(
		(ws?.clientId && ws?.tokens?.access_token) || gmailTokens?.access_token,
	);
	const scopeStr = ws?.tokens?.scope ?? gmailTokens?.scope ?? "";
	const scopes = scopeStr ? scopeStr.split(/\s+/).filter(Boolean) : [];

	const requested = cowork ? readScopePrefs(cowork) : undefined;
	const byo = cowork ? Boolean(readByoClient(cowork)) : false;

	return {
		connected,
		email: gmailTokens?.email ?? null,
		scopes,
		products: productsFromScope(scopeStr),
		granted: grantedCapabilities(scopeStr),
		requested,
		requestedTier: requested ? tierOf(requested) : undefined,
		byo,
		destinations: {
			workspaceOAuth: { present: Boolean(ws), path: paths.workspaceOAuth },
			gmailSettings: { present: Boolean(gmailSettings?.clientId) },
			gmailTokens: { present: Boolean(gmailTokens), path: paths.gmailTokens },
		},
	};
}

// ── Disconnect ──────────────────────────────────────────────────
export interface DisconnectResult {
	revoked: boolean;
	removed: string[];
}

/**
 * Revoke the refresh token at Google (best-effort) then delete BOTH token
 * files. Leaves the embedded clientId/secret in settings.json (harmless — it's
 * Zosma's own client, not user-entered) so a reconnect needs only consent.
 */
export async function disconnectGoogle(
	paths: GooglePaths,
	revoke: (refreshToken: string) => Promise<void> = revokeAtGoogle,
	cowork?: CoworkGooglePaths,
): Promise<DisconnectResult> {
	const ws = readJson<WorkspaceConfig>(paths.workspaceOAuth);
	const gmailTokens = readJson<GmailTokens>(paths.gmailTokens);
	const refreshToken = ws?.tokens?.refresh_token ?? gmailTokens?.refresh_token;

	let revoked = false;
	if (refreshToken) {
		try {
			await revoke(refreshToken);
			revoked = true;
		} catch {
			// best-effort — continue with local cleanup even if revoke fails
		}
	}

	const removed: string[] = [];
	if (removeIfExists(paths.workspaceOAuth)) removed.push(paths.workspaceOAuth);
	if (removeIfExists(paths.gmailTokens)) removed.push(paths.gmailTokens);
	// Clear the Cowork-local consent inputs too (scope prefs + BYO client).
	if (cowork) removed.push(...clearGooglePrefs(cowork));

	return { revoked, removed };
}

/** Best-effort token revocation against Google's revoke endpoint. */
export async function revokeAtGoogle(refreshToken: string): Promise<void> {
	await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
	});
}

// ── One-time legacy migration ───────────────────────────────────
export interface MigrationResult {
	migrated: boolean;
	from?: string;
}

/**
 * Import a pre-existing legacy single-config token file
 * (~/.pi/agent/google/oauth.json — the path from the original unified-config
 * plan) into the current shared destinations. No-op when the legacy file is
 * absent or the workspace destination already exists (we never clobber a live
 * connection). Safe to call on every startup.
 */
export function migrateLegacyTokens(paths: GooglePaths): MigrationResult {
	if (existsSync(paths.workspaceOAuth)) return { migrated: false };
	const legacy = readJson<WorkspaceConfig>(paths.legacyOAuth);
	if (!legacy?.clientId || !legacy?.tokens?.access_token) return { migrated: false };

	const email = readJson<GmailTokens>(paths.gmailTokens)?.email ?? "";
	const expiry = legacy.tokens.expiry_date ?? Date.now() + 3600_000;

	fanOutCredentials(paths, {
		// Legacy configs carry a real secret + no broker → keep direct refresh.
		client: { clientId: legacy.clientId, clientSecret: legacy.clientSecret, brokerUrl: "" },
		tokens: {
			access_token: legacy.tokens.access_token,
			refresh_token: legacy.tokens.refresh_token,
			token_type: legacy.tokens.token_type ?? "Bearer",
			scope: legacy.tokens.scope ?? UNION_SCOPES.join(" "),
			// fanOut recomputes expiry from expires_in; preserve the original
			// absolute expiry by deriving a remaining-seconds value (min 60s).
			expires_in: Math.max(60, Math.floor((expiry - Date.now()) / 1000)),
		},
		email,
		redirectUri: legacy.redirectUri ?? "",
	});

	return { migrated: true, from: paths.legacyOAuth };
}
