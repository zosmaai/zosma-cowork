/**
 * Zosma Cowork — Google OAuth token broker (stateless).
 *
 * Why this exists: a desktop/Tauri app cannot keep a secret (anything shipped is
 * extractable). So the Web-application client SECRET lives only here, in Google
 * Secret Manager, and is used exclusively for the two operations Google requires
 * a secret for:
 *
 *   - POST /token    authorization_code (+ PKCE verifier) -> access/refresh tokens
 *   - POST /refresh  refresh_token                        -> fresh access token
 *
 * The desktop app keeps only the PUBLIC client_id and the user's tokens; it never
 * sees the secret. The broker is stateless — it stores nothing, so it scales
 * horizontally and is not a custodian of user data.
 *
 *   - GET  /callback Google's redirect lands here; we bounce the browser back to
 *                    the app's loopback listener (port carried in `state`).
 *   - GET  /health   liveness probe.
 *
 * Endpoints are safe to expose publicly: a caller can only complete an exchange
 * for a code/refresh_token they already legitimately hold (and, for /token, only
 * with the matching PKCE verifier). The broker just adds the secret.
 */
import { http } from "@google-cloud/functions-framework";
import express, { type Request, type Response } from "express";

// Config from the runtime environment. The client_id is public; the secret is
// mounted from Google Secret Manager (gcloud --set-secrets). Reading lazily per
// request keeps cold-start cheap and lets Secret Manager rotation take effect.
const clientId = (): string => process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
const clientSecret = (): string => process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EXCHANGE_TIMEOUT_MS = 15_000;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use((_req, res, next) => {
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Referrer-Policy", "no-referrer");
	next();
});

// --- helpers ---------------------------------------------------------------

interface GoogleTokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
	id_token?: string;
	error?: string;
	error_description?: string;
}

/** POST to Google's token endpoint with a timeout; never logs token material. */
async function googleToken(params: Record<string, string>): Promise<{
	status: number;
	data: GoogleTokenResponse;
}> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
	try {
		const res = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
			body: new URLSearchParams(params),
			signal: controller.signal,
		});
		const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
		return { status: res.status, data };
	} finally {
		clearTimeout(timer);
	}
}

/** Pass through only the safe, expected fields (never echo request internals). */
function tokenPayload(d: GoogleTokenResponse) {
	return {
		access_token: d.access_token,
		refresh_token: d.refresh_token,
		expires_in: d.expires_in,
		scope: d.scope,
		token_type: d.token_type,
		id_token: d.id_token,
	};
}

function brandedPage(title: string, message: string, ok: boolean): string {
	const t = title.replace(/[<&]/g, "");
	const m = message.replace(/[<&]/g, "");
	const c = ok ? "1,124,243" : "245,69,92";
	return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t} · Zosma Cowork</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0b0b0f;color:#e8eaf0;font-family:system-ui,sans-serif}main{text-align:center;padding:2rem;max-width:28rem}.b{width:84px;height:84px;border-radius:50%;margin:0 auto 1.4rem;background:linear-gradient(145deg,rgba(${c},1),rgba(${c},.6));box-shadow:0 12px 40px rgba(${c},.4)}h1{font-size:1.3rem;margin:0 0 .4rem}p{color:#9aa3b2;margin:0}</style><main><div class="b"></div><h1>${t}</h1><p>${m}</p></main>`;
}

// --- routes ----------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
	res.json({ ok: true, service: "zosma-oauth-broker", ts: Date.now() });
});

/**
 * Google redirect target. `state` is base64url(JSON { port, nonce }) created by
 * the app. We forward code/error + the original state to the app's loopback so
 * the app can verify the nonce and complete the exchange via /token.
 */
app.get("/callback", (req: Request, res: Response) => {
	const code = typeof req.query.code === "string" ? req.query.code : "";
	const error = typeof req.query.error === "string" ? req.query.error : "";
	const stateRaw = typeof req.query.state === "string" ? req.query.state : "";

	let port = 0;
	try {
		const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
		port = Number(parsed?.port);
	} catch {
		/* invalid state handled below */
	}
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		res
			.status(400)
			.send(
				brandedPage("Sign-in error", "Invalid sign-in state — please retry from the app.", false),
			);
		return;
	}

	const target = new URL(`http://127.0.0.1:${port}/oauth2callback`);
	if (error) target.searchParams.set("error", error);
	if (code) target.searchParams.set("code", code);
	target.searchParams.set("state", stateRaw);
	res.redirect(302, target.toString());
});

/** authorization_code -> tokens. Body: { code, code_verifier, redirect_uri }. */
app.post("/token", async (req: Request, res: Response) => {
	const { code, code_verifier, redirect_uri } = (req.body ?? {}) as Record<string, unknown>;
	if (
		typeof code !== "string" ||
		typeof code_verifier !== "string" ||
		typeof redirect_uri !== "string"
	) {
		res
			.status(400)
			.json({
				error: "invalid_request",
				error_description: "code, code_verifier and redirect_uri are required",
			});
		return;
	}
	try {
		const { status, data } = await googleToken({
			grant_type: "authorization_code",
			code,
			code_verifier,
			redirect_uri,
			client_id: clientId(),
			client_secret: clientSecret(),
		});
		if (status !== 200 || !data.access_token) {
			console.warn(`token exchange failed status=${status} error=${data.error ?? ""}`);
			res
				.status(status === 200 ? 502 : status)
				.json({
					error: data.error ?? "token_exchange_failed",
					error_description: data.error_description,
				});
			return;
		}
		res.json(tokenPayload(data));
	} catch (e) {
		console.error(`token exchange error: ${(e as Error).message}`);
		res.status(504).json({ error: "upstream_unavailable" });
	}
});

/** refresh_token -> fresh access token. Body: { refresh_token }. */
app.post("/refresh", async (req: Request, res: Response) => {
	const { refresh_token } = (req.body ?? {}) as Record<string, unknown>;
	if (typeof refresh_token !== "string" || !refresh_token) {
		res
			.status(400)
			.json({ error: "invalid_request", error_description: "refresh_token is required" });
		return;
	}
	try {
		const { status, data } = await googleToken({
			grant_type: "refresh_token",
			refresh_token,
			client_id: clientId(),
			client_secret: clientSecret(),
		});
		if (status !== 200 || !data.access_token) {
			console.warn(`refresh failed status=${status} error=${data.error ?? ""}`);
			res
				.status(status === 200 ? 502 : status)
				.json({ error: data.error ?? "refresh_failed", error_description: data.error_description });
			return;
		}
		// Google does not return a refresh_token on refresh; pass through the rest.
		res.json(tokenPayload(data));
	} catch (e) {
		console.error(`refresh error: ${(e as Error).message}`);
		res.status(504).json({ error: "upstream_unavailable" });
	}
});

app.use((_req: Request, res: Response) => {
	res.status(404).json({ error: "not_found" });
});

// Register the Express app as the HTTP function entry point `broker`.
// Scaling/secret/region knobs are set at deploy time (gcloud functions deploy).
http("broker", app);
