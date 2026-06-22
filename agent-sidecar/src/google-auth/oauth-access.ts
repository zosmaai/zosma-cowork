/**
 * Shared Google OAuth/token access — broker-aware.
 *
 * Every owned Google tool (Calendar, Drive/Docs/Sheets/Slides, Gmail) reads the
 * SAME credential file Cowork's broker writes:
 *   `~/.pi/agent/google-workspace/oauth.json`
 *
 * Cowork brokers ONE consent (union of scopes) and writes ONE oauth.json with
 * NO client secret on disk — token refresh is delegated to the Zosma broker
 * (`${brokerUrl}/refresh`). A legacy / bring-your-own connect instead carries a
 * real `clientSecret` and refreshes directly with Google. This module supports
 * both and persists the refreshed token back to the same file.
 *
 * This is the generic core extracted from google-calendar/auth.ts so the
 * vendored workspace + gmail tools share a single, secret-free refresh path.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".pi", "agent", "google-workspace");
const CONFIG_PATH = join(CONFIG_DIR, "oauth.json");

export const GOOGLE_OAUTH_CONFIG_PATH = CONFIG_PATH;

export type OAuthTokens = {
	access_token: string;
	refresh_token?: string;
	token_type?: string;
	scope?: string;
	expiry_date?: number;
};

export type AuthConfig = {
	clientId: string;
	/** Empty when refresh is delegated to the Zosma broker (no local secret). */
	clientSecret?: string;
	/** Backend broker base URL; when present (and no secret), refresh goes through it. */
	brokerUrl?: string;
	redirectUri?: string;
	tokens: OAuthTokens;
};

async function ensureConfigDir(): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
}

export async function readConfig(): Promise<AuthConfig | null> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(raw) as AuthConfig;
		// Broker connect → no clientSecret (refresh via brokerUrl); legacy/BYO →
		// has clientSecret. Require clientId + access_token + one refresh path.
		if (!parsed?.clientId || !parsed?.tokens?.access_token) return null;
		if (!parsed.clientSecret && !parsed.brokerUrl) return null;
		return parsed;
	} catch {
		return null;
	}
}

async function saveConfig(config: AuthConfig): Promise<void> {
	await ensureConfigDir();
	await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function isExpired(tokens: OAuthTokens): boolean {
	if (!tokens.expiry_date) return false;
	return Date.now() >= tokens.expiry_date - 60_000;
}

function parseJson(text: string): Record<string, unknown> {
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/**
 * Refresh + persist the access token. Broker path (no secret) is preferred;
 * direct Google refresh is the legacy/BYO fallback.
 */
export async function refreshToken(config: AuthConfig, signal?: AbortSignal): Promise<AuthConfig> {
	if (!config.tokens.refresh_token) {
		throw new Error(
			"No refresh_token in oauth.json. Reconnect Google from Cowork Settings → Apps → Google.",
		);
	}

	const useBroker = Boolean(config.brokerUrl) && !config.clientSecret;
	const brokerBase = (config.brokerUrl ?? "").replace(/\/+$/, "");
	const res = useBroker
		? await fetch(`${brokerBase}/refresh`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ refresh_token: config.tokens.refresh_token }),
				signal,
			})
		: await fetch("https://oauth2.googleapis.com/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: config.clientId,
					client_secret: config.clientSecret ?? "",
					refresh_token: config.tokens.refresh_token,
					grant_type: "refresh_token",
				}),
				signal,
			});

	const text = await res.text();
	const data = parseJson(text);

	if (!res.ok || typeof data.access_token !== "string") {
		const message =
			typeof data.error_description === "string" ? data.error_description : "Token refresh failed";
		throw new Error(message);
	}

	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
	const nextConfig: AuthConfig = {
		...config,
		tokens: {
			...config.tokens,
			access_token: data.access_token,
			token_type: typeof data.token_type === "string" ? data.token_type : config.tokens.token_type,
			scope: typeof data.scope === "string" ? data.scope : config.tokens.scope,
			expiry_date: Date.now() + expiresIn * 1000,
		},
	};

	await saveConfig(nextConfig);
	return nextConfig;
}

/**
 * Returns a config with a non-expired access token, refreshing + persisting if
 * needed. Throws a friendly error when Google is not connected.
 */
export async function getValidConfig(signal?: AbortSignal): Promise<AuthConfig> {
	const config = await readConfig();
	if (!config) {
		throw new Error(
			`Google not connected. Open Cowork Settings → Apps → Google and connect. (${CONFIG_PATH})`,
		);
	}
	if (isExpired(config.tokens)) return refreshToken(config, signal);
	return config;
}

/** Returns a valid access token string (refreshing if needed). */
export async function getAccessToken(signal?: AbortSignal): Promise<string> {
	const config = await getValidConfig(signal);
	return config.tokens.access_token;
}

/** True when at least one of `wanted` scopes is present on the granted token. */
export function hasAnyScope(config: AuthConfig | null, wanted: string[]): boolean {
	const granted = (config?.tokens.scope ?? "").split(/\s+/).filter(Boolean);
	return wanted.some((w) => granted.includes(w));
}

/** Lightweight connection probe shared by status tools + the settings UI. */
export async function connectionStatus(): Promise<{
	connected: boolean;
	scopes: string[];
	configPath: string;
}> {
	const config = await readConfig();
	const scope = config?.tokens.scope ?? "";
	return {
		connected: Boolean(config),
		scopes: scope ? scope.split(/\s+/).filter(Boolean) : [],
		configPath: CONFIG_PATH,
	};
}
