/**
 * google-auth/consent — loopback redirect + PKCE consent for the Zosma Google
 * broker. Returns the raw token response + resolved account email; the caller
 * (broker.fanOutCredentials) writes them to the real package config files.
 *
 * Flow (PKCE S256 via the Zosma backend broker — NO secret on the device):
 *   1. Bind an ephemeral http server on 127.0.0.1 (the loopback listener).
 *   2. redirect_uri is the BROKER's HTTPS /callback (a registered Web-client
 *      redirect); `state` carries the loopback port + a CSRF nonce.
 *   3. Open the consent URL (browser). Google redirects to the broker, which
 *      bounces the browser back to 127.0.0.1:<port>/oauth2callback?code&state.
 *   4. Verify the state nonce, then POST {code, code_verifier, redirect_uri} to
 *      the broker /token endpoint — the broker adds the client_secret and
 *      returns the tokens. The device never holds the secret.
 *   5. Resolve the account email from the userinfo endpoint.
 *
 * Cancellation: pass an AbortSignal; aborting closes the loopback server and
 * rejects with an AbortError so re-entrant connect attempts can't get stuck on
 * a bound port (same hazard the start_oauth handler documents).
 */

import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { type EmbeddedClient, type OAuthTokenResponse, UNION_SCOPES } from "./broker.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface ConsentTargets {
	/** redirect_uri sent to Google + used at exchange. */
	redirectUri: string;
	/**
	 * true  → Zosma brokered flow: Google redirects to the broker /callback which
	 *          bounces to the loopback; the broker adds the secret at /token.
	 * false → bring-your-own direct flow: Google redirects straight to the
	 *          loopback redirect; we exchange directly with Google (device has
	 *          the user's own client_secret).
	 */
	useBroker: boolean;
}

/** Pick the redirect target + exchange mode from the resolved client. */
export function consentTargets(client: EmbeddedClient, port: number): ConsentTargets {
	if (client.brokerUrl) return { redirectUri: `${client.brokerUrl}/callback`, useBroker: true };
	return { redirectUri: `http://127.0.0.1:${port}/oauth2callback`, useBroker: false };
}

/** Build the Google consent URL for an explicit scope list (pure/testable). */
export function buildAuthUrl(opts: {
	clientId: string;
	redirectUri: string;
	scopes: string[];
	challenge: string;
	state: string;
}): string {
	const params = new URLSearchParams({
		client_id: opts.clientId,
		redirect_uri: opts.redirectUri,
		response_type: "code",
		scope: opts.scopes.join(" "),
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: "true",
		code_challenge: opts.challenge,
		code_challenge_method: "S256",
		state: opts.state,
	});
	return `${AUTH_URL}?${params.toString()}`;
}

export interface ConsentResult {
	tokens: OAuthTokenResponse;
	email: string;
	redirectUri: string;
}

export interface ConsentOptions {
	client: EmbeddedClient;
	/** Called with the consent URL so the caller can open the user's browser. */
	onAuthUrl: (url: string) => void;
	signal?: AbortSignal;
	/** Fixed loopback port (0 = OS-assigned ephemeral). Default 0. */
	port?: number;
	/** Exact scope list to request (identity + selected). Default UNION_SCOPES. */
	scopes?: string[];
}

function base64Url(buf: Buffer): string {
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makePkce(): { verifier: string; challenge: string } {
	const verifier = base64Url(randomBytes(32));
	const challenge = base64Url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

function listen(server: Server, port: number): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") resolve(addr.port);
			else reject(new Error("failed to bind loopback server"));
		});
	});
}

function abortError(): Error {
	const err = new Error("Google consent cancelled");
	err.name = "AbortError";
	return err;
}

/** Run the full consent flow and return tokens + email. */
export async function runConsent(opts: ConsentOptions): Promise<ConsentResult> {
	// Need a client id, plus EITHER a broker (Zosma flow) OR a client secret
	// (bring-your-own direct flow).
	if (!opts.client.clientId || (!opts.client.brokerUrl && !opts.client.clientSecret)) {
		throw new Error(
			"Google OAuth client not configured (set ZOSMA_GOOGLE_CLIENT_ID + broker, or supply your own client id + secret).",
		);
	}
	if (opts.signal?.aborted) throw abortError();

	const { verifier, challenge } = makePkce();
	const nonce = base64Url(randomBytes(16));

	const server = createServer();
	const port = await listen(server, opts.port ?? 0);
	// Brokered: Google → broker /callback → bounce to loopback (state carries the
	// port). Direct (BYO): Google → loopback redirect straight away.
	const { redirectUri, useBroker } = consentTargets(opts.client, port);
	const scopes = opts.scopes ?? UNION_SCOPES;
	const state = base64Url(Buffer.from(JSON.stringify({ port, nonce }), "utf8"));

	// Wait for the loopback callback (or abort).
	const code = await new Promise<string>((resolve, reject) => {
		const onAbort = () => {
			server.close();
			reject(abortError());
		};
		opts.signal?.addEventListener("abort", onAbort, { once: true });

		server.on("request", (req, res) => {
			const url = new URL(req.url ?? "/", redirectUri);
			if (url.pathname !== "/oauth2callback") {
				res.writeHead(404).end();
				return;
			}
			const err = url.searchParams.get("error");
			const returnedState = url.searchParams.get("state");
			const returnedCode = url.searchParams.get("code");
			const returnedNonce = decodeState(returnedState).nonce;

			const finish = (status: number, body: string) => {
				res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(body);
				opts.signal?.removeEventListener("abort", onAbort);
				server.close();
			};

			if (err) {
				finish(400, htmlPage("Connection failed", `Google returned: ${escapeHtml(err)}`, false));
				reject(new Error(`Google consent error: ${err}`));
				return;
			}
			if (!returnedNonce || returnedNonce !== nonce) {
				finish(400, htmlPage("Connection failed", "State mismatch — please try again.", false));
				reject(new Error("OAuth state mismatch"));
				return;
			}
			if (!returnedCode) {
				finish(400, htmlPage("Connection failed", "No authorization code returned.", false));
				reject(new Error("No authorization code returned"));
				return;
			}
			finish(
				200,
				htmlPage(
					"Google connected",
					"You can close this tab and return to Zosma Cowork.",
					true,
				),
			);
			resolve(returnedCode);
		});

		// Build + open the consent URL.
		opts.onAuthUrl(
			buildAuthUrl({
				clientId: opts.client.clientId,
				redirectUri,
				scopes,
				challenge,
				state,
			}),
		);
	});

	// Exchange the code: brokered (broker adds the secret) or direct (BYO secret).
	const tokens = await exchangeCode(opts.client, useBroker, code, redirectUri, verifier, opts.signal);
	const email = await fetchEmail(tokens.access_token, opts.signal);
	return { tokens, email, redirectUri };
}

/** Decode the broker `state` blob → { port, nonce }; tolerant of garbage. */
function decodeState(raw: string | null): { port?: number; nonce?: string } {
	if (!raw) return {};
	try {
		const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
			port?: number;
			nonce?: string;
		};
		return v && typeof v === "object" ? v : {};
	} catch {
		return {};
	}
}

async function exchangeCode(
	client: EmbeddedClient,
	useBroker: boolean,
	code: string,
	redirectUri: string,
	verifier: string,
	signal?: AbortSignal,
): Promise<OAuthTokenResponse> {
	// Direct (bring-your-own): exchange with Google using the user's secret.
	const req = useBroker
		? {
				url: `${client.brokerUrl}/token`,
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
			}
		: {
				url: GOOGLE_TOKEN_URL,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json",
				},
				body: new URLSearchParams({
					client_id: client.clientId,
					client_secret: client.clientSecret,
					code,
					code_verifier: verifier,
					redirect_uri: redirectUri,
					grant_type: "authorization_code",
				}).toString(),
			};
	const res = await fetch(req.url, {
		method: "POST",
		headers: req.headers,
		body: req.body,
		signal,
	});
	const text = await res.text();
	let data: Record<string, unknown> = {};
	try {
		data = JSON.parse(text) as Record<string, unknown>;
	} catch {
		// fall through to the error path below
	}
	if (!res.ok || typeof data.access_token !== "string") {
		const via = useBroker ? "broker" : "Google";
		const msg =
			typeof data.error_description === "string"
				? data.error_description
				: `Token exchange failed via ${via} (HTTP ${res.status})`;
		throw new Error(msg);
	}
	return data as unknown as OAuthTokenResponse;
}

async function fetchEmail(accessToken: string, signal?: AbortSignal): Promise<string> {
	try {
		const res = await fetch(USERINFO_URL, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal,
		});
		if (!res.ok) return "unknown";
		const data = (await res.json()) as { email?: string };
		return data.email ?? "unknown";
	} catch {
		return "unknown";
	}
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => {
		switch (c) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

/**
 * Branded loopback landing page shown in the user's browser after consent.
 * `ok` toggles the success (animated tick) vs error (animated cross) variant.
 * Fully self-contained: inline CSS + SVG + keyframes, no network deps, so it
 * renders instantly and offline. Brand: Zosma blue (#017cf3 → #3080ff) on the
 * app's dark canvas (#0b0b0f).
 */
function htmlPage(title: string, message: string, ok = true): string {
	const t = escapeHtml(title);
	const m = escapeHtml(message);
	const icon = ok
		? `<svg class="glyph" viewBox="0 0 52 52" aria-hidden="true"><path class="tick" fill="none" d="M14 27l8 8 16-17"/></svg>`
		: `<svg class="glyph" viewBox="0 0 52 52" aria-hidden="true"><path class="tick" fill="none" d="M18 18l16 16"/><path class="tick tick2" fill="none" d="M34 18l-16 16"/></svg>`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t} · Zosma Cowork</title><style>
:root{--blue:#017cf3;--blue2:#3080ff;--ok:#017cf3;--ok2:#3080ff;--err:#f5455c;--err2:#ff6b7a;--ink:#e8eaf0;--mut:#9aa3b2}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;font-family:'Space Grotesk',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#0b0b0f;display:grid;place-items:center;overflow:hidden}
body::before{content:"";position:fixed;inset:0;background:radial-gradient(60rem 60rem at 50% -10%,rgba(${ok ? "1,124,243" : "245,69,92"},.18),transparent 60%),radial-gradient(40rem 40rem at 50% 120%,rgba(48,128,255,.10),transparent 60%);pointer-events:none}
main{position:relative;text-align:center;max-width:30rem;padding:2.5rem 2rem;animation:rise .6s cubic-bezier(.16,1,.3,1) both}
.badge{position:relative;width:104px;height:104px;margin:0 auto 1.6rem;display:grid;place-items:center}
.ring{position:absolute;inset:0;border-radius:50%;background:linear-gradient(145deg,var(--${ok ? "ok" : "err"}),var(--${ok ? "ok2" : "err2"}));box-shadow:0 12px 40px rgba(${ok ? "1,124,243" : "245,69,92"},.45),inset 0 0 0 1px rgba(255,255,255,.18);animation:pop .55s cubic-bezier(.34,1.56,.64,1) .05s both}
.pulse{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(${ok ? "1,124,243" : "245,69,92"},.5);animation:pulse 2.2s ease-out infinite}
.pulse.d{animation-delay:1.1s}
.glyph{position:relative;width:56px;height:56px;stroke:#fff;stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
.tick{stroke-dasharray:48;stroke-dashoffset:48;animation:draw .5s cubic-bezier(.65,0,.45,1) .42s forwards}
.tick2{animation-delay:.58s}
h1{font-family:'Chakra Petch','Space Grotesk',system-ui,sans-serif;font-weight:600;font-size:1.5rem;letter-spacing:.01em;margin:0 0 .5rem}
p{margin:0;color:var(--mut);font-size:.98rem;line-height:1.5}
.brand{margin-top:2rem;display:inline-flex;align-items:center;gap:.55rem;color:var(--mut);font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;opacity:.8}
.dot{width:8px;height:8px;border-radius:50%;background:linear-gradient(145deg,var(--blue),var(--blue2));box-shadow:0 0 10px rgba(1,124,243,.8)}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes pop{0%{transform:scale(0);opacity:0}60%{opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.7);opacity:0}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}.tick{stroke-dashoffset:0}}
</style></head><body><main>
<div class="badge">${ok ? '<span class="pulse"></span><span class="pulse d"></span>' : ""}<span class="ring"></span>${icon}</div>
<h1>${t}</h1><p>${m}</p>
<div class="brand"><span class="dot"></span>Zosma Cowork</div>
</main></body></html>`;
}
