/**
 * Broker-aware auth shim for the vendored Gmail tool.
 *
 * Drop-in replacement for @e9n/pi-gmail's src/auth.ts. The upstream stored its
 * own tokens in ~/.pi/agent/db/gmail-tokens.json and refreshed DIRECTLY with
 * Google using a clientId/clientSecret from settings.json["pi-gmail"]. That is
 * exactly what broke on a brokered Cowork connect (the secret is intentionally
 * never written to disk), and it caused a SECOND, drifting account store
 * separate from the rest of Google.
 *
 * Here we delegate to the shared broker-aware core (../google-auth/oauth-access)
 * so Gmail reads + refreshes the SAME ~/.pi/agent/google-workspace/oauth.json
 * as Calendar/Drive/Docs/Sheets/Slides — one consent, one token file, no secret.
 * The account email is resolved live from the Gmail profile endpoint rather than
 * a stored field, so the displayed identity is always the real authenticated
 * account (fixes the stale "wrong account" bug).
 *
 * The exported signatures keep the upstream's `(settings, agentDir)` shape so
 * the vendored client.ts/tool.ts need no call-site churn; those args are unused.
 */

import { existsSync, readFileSync } from "node:fs";
import {
	GOOGLE_OAUTH_CONFIG_PATH,
	getAccessToken as brokerAccessToken,
} from "../google-auth/oauth-access.js";

// Gmail data scope. `gmail.modify` covers read + send + drafts + labels +
// archive + trash (everything the tool does short of permanent delete).
const GMAIL_SCOPE_HINT = "gmail";

/** Access token for the brokered Google account (auto-refreshes via broker). */
export async function getAccessToken(_settings?: unknown, _agentDir?: unknown): Promise<string> {
	return brokerAccessToken();
}

/**
 * Synchronous connectivity check used by the tool before doing work. Reads the
 * shared oauth.json and confirms it is a usable broker/BYO config with a Gmail
 * scope present. Kept sync to match the upstream call shape.
 */
export function isAuthenticated(_agentDir?: unknown): boolean {
	try {
		if (!existsSync(GOOGLE_OAUTH_CONFIG_PATH)) return false;
		const c = JSON.parse(readFileSync(GOOGLE_OAUTH_CONFIG_PATH, "utf8"));
		const usable = Boolean(
			c?.clientId && c?.tokens?.access_token && (c?.clientSecret || c?.brokerUrl),
		);
		const scope: string = c?.tokens?.scope ?? "";
		return usable && scope.includes(GMAIL_SCOPE_HINT);
	} catch {
		return false;
	}
}

// Resolve the authenticated address once, from the live Gmail profile — never a
// stored field — and cache it for the process. This is the source of truth for
// the "from" header and self-address filtering on reply_all.
let cachedEmail: string | null = null;

export async function getAuthenticatedEmail(_agentDir?: unknown): Promise<string | null> {
	if (cachedEmail) return cachedEmail;
	try {
		const token = await brokerAccessToken();
		const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!r.ok) return null;
		const j = (await r.json()) as { emailAddress?: string };
		cachedEmail = j.emailAddress ?? null;
		return cachedEmail;
	} catch {
		return null;
	}
}
