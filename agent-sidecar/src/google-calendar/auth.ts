/**
 * Google Calendar — shared OAuth/token access.
 *
 * This package intentionally reads the SAME credential file that
 * `pi-google-workspace` uses: `~/.pi/agent/google-workspace/oauth.json`.
 *
 * Rationale (see zosma-cowork epic #180 / B2 #186): Cowork brokers a single
 * Google OAuth consent (union of scopes incl. calendar) and writes ONE
 * `oauth.json`. Both pi-google-workspace and this Calendar package read and
 * refresh that one file, so a single "Connect Google" provisions all tools.
 *
 * The access token must already carry the calendar scope
 * (`https://www.googleapis.com/auth/calendar`); the Cowork setup handler is
 * responsible for requesting it during consent.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const CONFIG_DIR = join(homedir(), ".pi", "agent", "google-workspace");
const CONFIG_PATH = join(CONFIG_DIR, "oauth.json");

/** Scope this package needs. Added to the union requested by the setup handler. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export type OAuthTokens = {
	access_token: string;
	refresh_token?: string;
	token_type?: string;
	scope?: string;
	expiry_date?: number;
};

export type AuthConfig = {
	clientId: string;
	clientSecret: string;
	redirectUri?: string;
	tokens: OAuthTokens;
};

export const CALENDAR_CONFIG_PATH = CONFIG_PATH;

async function ensureConfigDir(): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
}

export async function readConfig(): Promise<AuthConfig | null> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(raw) as AuthConfig;
		if (!parsed?.clientId || !parsed?.clientSecret || !parsed?.tokens?.access_token) {
			return null;
		}
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

async function refreshToken(config: AuthConfig, signal?: AbortSignal): Promise<AuthConfig> {
	if (!config.tokens.refresh_token) {
		throw new Error(
			"No refresh_token found in oauth.json. Reconnect Google from Cowork settings.",
		);
	}

	const body = new URLSearchParams({
		client_id: config.clientId,
		client_secret: config.clientSecret,
		refresh_token: config.tokens.refresh_token,
		grant_type: "refresh_token",
	});

	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
		signal,
	});

	const text = await res.text();
	const data = parseJson(text);

	if (!res.ok || typeof data.access_token !== "string") {
		const message =
			typeof data.error_description === "string"
				? data.error_description
				: "Token refresh failed";
		throw new Error(message);
	}

	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
	const nextConfig: AuthConfig = {
		...config,
		tokens: {
			...config.tokens,
			access_token: data.access_token,
			token_type:
				typeof data.token_type === "string" ? data.token_type : config.tokens.token_type,
			scope: typeof data.scope === "string" ? data.scope : config.tokens.scope,
			expiry_date: Date.now() + expiresIn * 1000,
		},
	};

	await saveConfig(nextConfig);
	return nextConfig;
}

/**
 * Returns a config with a non-expired access token, refreshing+persisting if
 * needed. Throws a friendly error when Google is not yet connected.
 */
export async function getValidConfig(signal?: AbortSignal): Promise<AuthConfig> {
	const config = await readConfig();
	if (!config) {
		throw new Error(
			`Google not connected. Open Cowork Settings → Integrations → Google and connect. (${CONFIG_PATH})`,
		);
	}
	if (isExpired(config.tokens)) return refreshToken(config, signal);
	return config;
}

/** Lightweight status probe for `google_calendar_status` and the settings UI. */
export async function calendarConnectionStatus(): Promise<{
	connected: boolean;
	hasCalendarScope: boolean;
	configPath: string;
}> {
	const config = await readConfig();
	const scope = config?.tokens.scope ?? "";
	// Space-delimited scope string from Google's token endpoint.
	// Split + exact match avoids substring-injection false positives
	// (e.g. an attacker-controlled URL containing the scope as a substring).
	const scopes = scope ? scope.split(/\s+/) : [];
	return {
		connected: Boolean(config),
		hasCalendarScope: scopes.some((s) => s === CALENDAR_SCOPE),
		configPath: CONFIG_PATH,
	};
}
