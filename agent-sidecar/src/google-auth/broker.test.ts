import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	defaultGooglePaths,
	disconnectGoogle,
	embeddedClient,
	fanOutCredentials,
	type GooglePaths,
	googleStatus,
	migrateLegacyTokens,
	UNION_SCOPES,
} from "./broker.js";
import {
	defaultCoworkGooglePaths,
	writeByoClient,
	writeScopePrefs,
} from "./prefs-store.js";
import { DEFAULT_PREFS } from "./scopes.js";

let agentDir: string;
let paths: GooglePaths;
const NOW = 1_700_000_000_000;

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}

function readJson(path: string): any {
	return JSON.parse(readFileSync(path, "utf-8"));
}

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "google-broker-"));
	paths = defaultGooglePaths(agentDir);
});

afterEach(() => {
	rmSync(agentDir, { recursive: true, force: true });
});

const client = { clientId: "zosma-id", clientSecret: "zosma-secret", brokerUrl: "" };
const tokens = {
	access_token: "at-1",
	refresh_token: "rt-1",
	expires_in: 3600,
	token_type: "Bearer",
	scope: UNION_SCOPES.join(" "),
};

describe("fanOutCredentials", () => {
	it("writes the workspace oauth.json in pi-google-workspace AuthConfig shape", () => {
		fanOutCredentials(paths, {
			client,
			tokens,
			email: "u@example.com",
			redirectUri: "http://127.0.0.1:5000/oauth2callback",
			now: NOW,
		});
		const ws = readJson(paths.workspaceOAuth);
		expect(ws.clientId).toBe("zosma-id");
		expect(ws.clientSecret).toBe("zosma-secret");
		expect(ws.redirectUri).toBe("http://127.0.0.1:5000/oauth2callback");
		expect(ws.tokens).toMatchObject({
			access_token: "at-1",
			refresh_token: "rt-1",
			token_type: "Bearer",
			expiry_date: NOW + 3600_000, // ms epoch, `expiry_date` naming
		});
		expect(ws.tokens.scope).toContain("calendar");
	});

	it("writes gmail-tokens.json in pi-gmail OAuthTokens shape (expires_at + email)", () => {
		fanOutCredentials(paths, {
			client,
			tokens,
			email: "u@example.com",
			redirectUri: "http://127.0.0.1:5000/oauth2callback",
			now: NOW,
		});
		const gt = readJson(paths.gmailTokens);
		expect(gt).toMatchObject({
			access_token: "at-1",
			refresh_token: "rt-1",
			expires_at: NOW + 3600_000, // gmail uses `expires_at`, not `expiry_date`
			email: "u@example.com",
		});
		expect(gt.scope).toContain("gmail.modify");
	});

	it("merges pi-gmail client creds into settings.json without clobbering other keys", () => {
		writeJson(paths.piSettings, {
			defaultModel: "claude",
			"pi-gmail": { maxResults: 50, notifications: { enabled: true } },
		});
		fanOutCredentials(paths, {
			client,
			tokens,
			email: "u@example.com",
			redirectUri: "r",
			now: NOW,
		});
		const settings = readJson(paths.piSettings);
		expect(settings.defaultModel).toBe("claude"); // preserved
		expect(settings["pi-gmail"]).toMatchObject({
			clientId: "zosma-id",
			clientSecret: "zosma-secret",
			maxResults: 50, // preserved
			notifications: { enabled: true }, // preserved
		});
	});

	it("skips gmail destinations when Gmail capability is Off", () => {
		fanOutCredentials(paths, {
			client,
			tokens,
			email: "u@example.com",
			redirectUri: "r",
			now: NOW,
			prefs: {
				drive: "full",
				gmail: "off",
				calendar: "full",
				docs: "off",
				sheets: "off",
				slides: "off",
			},
		});
		expect(existsSync(paths.workspaceOAuth)).toBe(true); // calendar/drive selected
		expect(existsSync(paths.gmailTokens)).toBe(false); // gmail off
		// no settings.json written (gmail off, none pre-existing)
		expect(existsSync(paths.piSettings)).toBe(false);
	});

	it("removes stale gmail destinations when re-consenting with Gmail now Off", () => {
		// First connect with everything (default) → gmail files written.
		fanOutCredentials(paths, { client, tokens, email: "u@example.com", redirectUri: "r", now: NOW });
		expect(existsSync(paths.gmailTokens)).toBe(true);
		// Re-consent dropping Gmail.
		fanOutCredentials(paths, {
			client,
			tokens,
			email: "u@example.com",
			redirectUri: "r",
			now: NOW + 1,
			prefs: {
				drive: "full",
				gmail: "off",
				calendar: "full",
				docs: "full",
				sheets: "full",
				slides: "full",
			},
		});
		expect(existsSync(paths.gmailTokens)).toBe(false);
	});

	it("skips the workspace oauth.json when all workspace products are Off", () => {
		fanOutCredentials(paths, {
			client,
			tokens,
			email: "u@example.com",
			redirectUri: "r",
			now: NOW,
			prefs: {
				drive: "off",
				gmail: "modify",
				calendar: "off",
				docs: "off",
				sheets: "off",
				slides: "off",
			},
		});
		expect(existsSync(paths.workspaceOAuth)).toBe(false); // no workspace product
		expect(existsSync(paths.gmailTokens)).toBe(true); // gmail selected
	});

	it("preserves a prior refresh_token when Google omits one on re-consent", () => {
		fanOutCredentials(paths, { client, tokens, email: "u@example.com", redirectUri: "r", now: NOW });
		// Re-consent without a refresh_token
		fanOutCredentials(paths, {
			client,
			tokens: { access_token: "at-2", expires_in: 3600, scope: tokens.scope },
			email: "u@example.com",
			redirectUri: "r",
			now: NOW + 1000,
		});
		expect(readJson(paths.workspaceOAuth).tokens.refresh_token).toBe("rt-1");
		expect(readJson(paths.gmailTokens).refresh_token).toBe("rt-1");
		expect(readJson(paths.workspaceOAuth).tokens.access_token).toBe("at-2");
	});
});

describe("embeddedClient BYO precedence", () => {
	it("uses a bring-your-own client (id+secret, direct refresh — no broker)", () => {
		const c = embeddedClient({ clientId: "byo-id", clientSecret: "byo-secret" });
		expect(c.clientId).toBe("byo-id");
		expect(c.clientSecret).toBe("byo-secret");
		expect(c.brokerUrl).toBe(""); // BYO holds the secret → direct, no broker
	});

	it("falls back to the Zosma embedded client (brokered) when no BYO", () => {
		const c = embeddedClient();
		expect(c.clientId).toBeTruthy();
		expect(c.brokerUrl).toBeTruthy(); // brokered flow
	});
});

describe("googleStatus", () => {
	it("reports disconnected when no files exist", () => {
		const s = googleStatus(paths);
		expect(s.connected).toBe(false);
		expect(s.email).toBeNull();
		expect(s.scopes).toEqual([]);
		expect(s.products.gmail).toBe(false);
	});

	it("reports connected + email + per-product scopes after fan-out", () => {
		fanOutCredentials(paths, { client, tokens, email: "u@example.com", redirectUri: "r", now: NOW });
		const s = googleStatus(paths);
		expect(s.connected).toBe(true);
		expect(s.email).toBe("u@example.com");
		expect(s.products).toMatchObject({
			gmail: true,
			calendar: true,
			drive: true,
			docs: true,
			sheets: true,
			slides: true,
		});
		expect(s.destinations.workspaceOAuth.present).toBe(true);
		expect(s.destinations.gmailSettings.present).toBe(true);
		expect(s.destinations.gmailTokens.present).toBe(true);
	});

	it("reports granted capability per product (granted-vs-requested diff)", () => {
		fanOutCredentials(paths, { client, tokens, email: "u@example.com", redirectUri: "r", now: NOW });
		const s = googleStatus(paths);
		expect(s.granted.gmail).toBe("modify");
		expect(s.granted.calendar).toBe("full");
		expect(s.granted.drive).toBe("full");
	});

	it("is connected on a gmail-only token even without workspace oauth.json", () => {
		fanOutCredentials(paths, {
			client,
			tokens: { ...tokens, scope: "openid email https://www.googleapis.com/auth/gmail.modify" },
			email: "u@example.com",
			redirectUri: "r",
			now: NOW,
			prefs: {
				drive: "off",
				gmail: "modify",
				calendar: "off",
				docs: "off",
				sheets: "off",
				slides: "off",
			},
		});
		const s = googleStatus(paths);
		expect(s.destinations.workspaceOAuth.present).toBe(false);
		expect(s.connected).toBe(true); // gmail tokens alone count as connected
		expect(s.granted.gmail).toBe("modify");
	});
});

describe("disconnectGoogle", () => {
	it("revokes the refresh token and deletes both token files", async () => {
		fanOutCredentials(paths, { client, tokens, email: "u@example.com", redirectUri: "r", now: NOW });
		const revoke = vi.fn(() => Promise.resolve());
		const res = await disconnectGoogle(paths, revoke);
		expect(revoke).toHaveBeenCalledWith("rt-1");
		expect(res.revoked).toBe(true);
		expect(existsSync(paths.workspaceOAuth)).toBe(false);
		expect(existsSync(paths.gmailTokens)).toBe(false);
		expect(res.removed).toContain(paths.workspaceOAuth);
		expect(res.removed).toContain(paths.gmailTokens);
	});

	it("still deletes local files when revoke fails (best-effort)", async () => {
		fanOutCredentials(paths, { client, tokens, email: "u@example.com", redirectUri: "r", now: NOW });
		// Per the vitest gotcha: a throwing mock + beforeEach mockReset causes a
		// false unhandled-rejection failure. Use mockImplementationOnce(reject)
		// and assert via resolves.
		const revoke = vi.fn();
		revoke.mockImplementationOnce(() => Promise.reject(new Error("network down")));
		await expect(disconnectGoogle(paths, revoke)).resolves.toMatchObject({ revoked: false });
		expect(existsSync(paths.workspaceOAuth)).toBe(false);
		expect(existsSync(paths.gmailTokens)).toBe(false);
	});

	it("is a no-op (no revoke) when nothing is connected", async () => {
		const revoke = vi.fn(() => Promise.resolve());
		const res = await disconnectGoogle(paths, revoke);
		expect(revoke).not.toHaveBeenCalled();
		expect(res.removed).toEqual([]);
	});

	it("also clears Cowork scope-prefs + BYO files when cowork paths given", async () => {
		fanOutCredentials(paths, { client, tokens, email: "u@example.com", redirectUri: "r", now: NOW });
		const cowork = defaultCoworkGooglePaths(join(agentDir, "zosmaai"));
		writeScopePrefs(cowork, DEFAULT_PREFS);
		writeByoClient(cowork, { clientId: "id", clientSecret: "s" });
		const res = await disconnectGoogle(paths, vi.fn(() => Promise.resolve()), cowork);
		expect(existsSync(cowork.scopePrefs)).toBe(false);
		expect(existsSync(cowork.byoClient)).toBe(false);
		expect(res.removed).toContain(cowork.scopePrefs);
	});
});

describe("migrateLegacyTokens", () => {
	it("imports a legacy ~/.pi/agent/google/oauth.json into both destinations", () => {
		writeJson(paths.legacyOAuth, {
			clientId: "legacy-id",
			clientSecret: "legacy-secret",
			redirectUri: "http://127.0.0.1:1/oauth2callback",
			tokens: {
				access_token: "legacy-at",
				refresh_token: "legacy-rt",
				scope: UNION_SCOPES.join(" "),
				expiry_date: Date.now() + 3600_000,
			},
		});
		const res = migrateLegacyTokens(paths);
		expect(res.migrated).toBe(true);
		expect(res.from).toBe(paths.legacyOAuth);
		expect(readJson(paths.workspaceOAuth).clientId).toBe("legacy-id");
		expect(readJson(paths.gmailTokens).refresh_token).toBe("legacy-rt");
	});

	it("does not clobber an existing live connection", () => {
		fanOutCredentials(paths, { client, tokens, email: "u@example.com", redirectUri: "r", now: NOW });
		writeJson(paths.legacyOAuth, {
			clientId: "legacy-id",
			clientSecret: "legacy-secret",
			tokens: { access_token: "legacy-at", refresh_token: "legacy-rt" },
		});
		const res = migrateLegacyTokens(paths);
		expect(res.migrated).toBe(false);
		expect(readJson(paths.workspaceOAuth).clientId).toBe("zosma-id"); // unchanged
	});

	it("is a no-op when no legacy file exists", () => {
		expect(migrateLegacyTokens(paths).migrated).toBe(false);
	});
});
