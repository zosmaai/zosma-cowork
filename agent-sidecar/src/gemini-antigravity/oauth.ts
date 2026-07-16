/**
 * OAuth + project discovery for the Gemini (Google) provider.
 *
 * Loopback + PKCE consent (RFC 8252 / S256) bound to a FIXED localhost port so
 * we auto-capture the code — no manual paste. Mirrors the structure of Cowork's
 * google-auth/consent.ts but uses the Antigravity client + Code Assist
 * `loadCodeAssist` project discovery. Token storage/refresh scheduling is owned
 * by pi's AuthStorage; this module just performs the network exchanges.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
	AUTH_URL,
	CLIENT_ID,
	CLIENT_SECRET,
	LOAD_CODE_ASSIST_ENDPOINTS,
	REDIRECT_PATH,
	REDIRECT_PORT,
	REDIRECT_URI,
	SCOPES,
	TOKEN_URL,
	USERINFO_URL,
} from "./constants.js";

export interface ConsentTokens {
	accessToken: string;
	refreshToken: string;
	/** Seconds until the access token expires. */
	expiresIn: number;
}

function base64Url(buf: Buffer): string {
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makePkce(): { verifier: string; challenge: string } {
	const verifier = base64Url(randomBytes(32));
	const challenge = base64Url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

function listen(server: Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", (err: NodeJS.ErrnoException) => {
			reject(
				err.code === "EADDRINUSE"
					? new Error(
							`Port ${port} is in use — close whatever is using it and retry the Google sign-in.`,
						)
					: err,
			);
		});
		server.listen(port, "127.0.0.1", () => resolve());
	});
}

function abortError(): Error {
	const err = new Error("Google sign-in cancelled");
	err.name = "AbortError";
	return err;
}

function htmlPage(title: string, message: string): string {
	const esc = (s: string) =>
		s.replace(/[&<>"']/g, (c) =>
			c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
		);
	return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;background:#0b0b0f;color:#e8e8ea;display:grid;place-items:center;height:100vh;margin:0}main{text-align:center;max-width:28rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{opacity:.7}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;
}

/**
 * Run the loopback consent flow. Calls `onAuthUrl` with the consent URL (the
 * caller opens the browser), waits for the redirect, and exchanges the code.
 */
export async function runGeminiConsent(opts: {
	onAuthUrl: (url: string) => void;
	signal?: AbortSignal;
}): Promise<ConsentTokens> {
	if (opts.signal?.aborted) throw abortError();
	// Detect the un-injected placeholder by PREFIX so the build-time global
	// replace of the full token (see prebuild.mjs) doesn't rewrite this check.
	if (!CLIENT_SECRET || CLIENT_SECRET.startsWith("__ANTIGRAVITY")) {
		throw new Error(
			"Gemini (Google) sign-in isn't configured in this build (missing client secret). Set ANTIGRAVITY_CLIENT_SECRET.",
		);
	}

	const { verifier, challenge } = makePkce();
	const state = base64Url(randomBytes(16));

	const server = createServer();
	await listen(server, REDIRECT_PORT);

	const code = await new Promise<string>((resolve, reject) => {
		const onAbort = () => {
			server.close();
			reject(abortError());
		};
		opts.signal?.addEventListener("abort", onAbort, { once: true });

		server.on("request", (req, res) => {
			const url = new URL(req.url ?? "/", `http://127.0.0.1:${REDIRECT_PORT}`);
			if (url.pathname !== REDIRECT_PATH) {
				res.writeHead(404).end();
				return;
			}
			const finish = (status: number, body: string) => {
				res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(body);
				opts.signal?.removeEventListener("abort", onAbort);
				server.close();
			};
			const err = url.searchParams.get("error");
			const returnedState = url.searchParams.get("state");
			const returnedCode = url.searchParams.get("code");
			if (err) {
				finish(400, htmlPage("Sign-in failed", `Google returned: ${err}`));
				reject(new Error(`Google sign-in error: ${err}`));
			} else if (!returnedState || returnedState !== state) {
				finish(400, htmlPage("Sign-in failed", "State mismatch — please try again."));
				reject(new Error("OAuth state mismatch"));
			} else if (!returnedCode) {
				finish(400, htmlPage("Sign-in failed", "No authorization code returned."));
				reject(new Error("No authorization code returned"));
			} else {
				finish(200, htmlPage("Signed in", "You can close this tab and return to Zosma Cowork."));
				resolve(returnedCode);
			}
		});

		const authParams = new URLSearchParams({
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			response_type: "code",
			scope: SCOPES.join(" "),
			access_type: "offline",
			prompt: "consent",
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
		});
		opts.onAuthUrl(`${AUTH_URL}?${authParams.toString()}`);
	});

	return exchangeCode(code, verifier, opts.signal);
}

async function exchangeCode(
	code: string,
	verifier: string,
	signal?: AbortSignal,
): Promise<ConsentTokens> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			redirect_uri: REDIRECT_URI,
			grant_type: "authorization_code",
			code_verifier: verifier,
		}),
		signal,
	});
	const data = (await res.json().catch(() => ({}))) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		error_description?: string;
	};
	if (!res.ok || !data.access_token) {
		throw new Error(data.error_description || `Token exchange failed (HTTP ${res.status})`);
	}
	if (!data.refresh_token) {
		throw new Error("Google did not return a refresh token — try signing in again.");
	}
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresIn: data.expires_in ?? 3600,
	};
}

/** Refresh an access token from a stored refresh token. */
export async function refreshAccessToken(
	refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});
	const data = (await res.json().catch(() => ({}))) as {
		access_token?: string;
		expires_in?: number;
		error_description?: string;
	};
	if (!res.ok || !data.access_token) {
		throw new Error(data.error_description || `Token refresh failed (HTTP ${res.status})`);
	}
	return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

const CODE_ASSIST_METADATA = {
	ideType: "IDE_UNSPECIFIED",
	platform: "PLATFORM_UNSPECIFIED",
	pluginType: "GEMINI",
};
const FREE_TIER_ID = "free-tier";

function projectIdOf(p: unknown): string | undefined {
	if (typeof p === "string" && p) return p;
	if (p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string") {
		return (p as { id: string }).id;
	}
	return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the Cloud Code companion projectId for this account.
 *
 * Calls `loadCodeAssist`; if the account has no project yet (brand-new, never
 * used Antigravity/Code Assist), it auto-provisions one via `onboardUser` — the
 * default/free tier uses a Google-managed project — and polls the returned
 * long-running operation until ready. This mirrors the official gemini-cli
 * setup flow, so the user does NOT need to open the Antigravity IDE first.
 */
export async function discoverProject(
	accessToken: string,
	onProgress?: (msg: string) => void,
): Promise<string> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"User-Agent": "google-api-nodejs-client/9.15.1",
	};
	const postJson = async (url: string, payload: unknown): Promise<any | undefined> => {
		const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
		return res.ok ? res.json() : undefined;
	};

	let lastErr = "";
	for (const endpoint of LOAD_CODE_ASSIST_ENDPOINTS) {
		try {
			const loadRes = await postJson(`${endpoint}/v1internal:loadCodeAssist`, {
				metadata: CODE_ASSIST_METADATA,
			});
			if (!loadRes) continue;

			const existing = projectIdOf(loadRes.cloudaicompanionProject);
			if (existing) return existing;

			// No project yet → onboard (auto-provision). Pick the default tier;
			// fall back to the free tier (managed project, no GCP project needed).
			onProgress?.("Setting up your Gemini access (one-time)…");
			const tier =
				(loadRes.allowedTiers as Array<{ id?: string; isDefault?: boolean }> | undefined)?.find(
					(t) => t.isDefault,
				) ?? { id: FREE_TIER_ID };
			const onboardReq = {
				tierId: tier.id ?? FREE_TIER_ID,
				// Free/managed tier rejects a project id; we have none to offer anyway.
				cloudaicompanionProject: undefined,
				metadata: CODE_ASSIST_METADATA,
			};

			let lro = await postJson(`${endpoint}/v1internal:onboardUser`, onboardReq);
			// Poll the long-running operation (GET) until done (~cap 90s).
			for (let i = 0; lro && !lro.done && lro.name && i < 30; i++) {
				await sleep(3000);
				const res = await fetch(`${endpoint}/v1internal/${lro.name}`, { headers });
				lro = res.ok ? await res.json() : lro;
			}
			const provisioned = projectIdOf(lro?.response?.cloudaicompanionProject);
			if (provisioned) return provisioned;
			lastErr = "onboarding completed without returning a project";
		} catch (err) {
			lastErr = err instanceof Error ? err.message : String(err);
		}
	}
	throw new Error(
		`Could not set up Gemini Code Assist for this account${lastErr ? ` (${lastErr})` : ""}. Make sure the account is eligible for Gemini, then try signing in again.`,
	);
}

/** Best-effort account email for display. */
export async function getUserEmail(accessToken: string): Promise<string | undefined> {
	try {
		const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
		if (!res.ok) return undefined;
		const data = (await res.json()) as { email?: string };
		return data.email;
	} catch {
		return undefined;
	}
}
