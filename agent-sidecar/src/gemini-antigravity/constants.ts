/**
 * Constants for the "Sign in with Google → Gemini" provider (Antigravity /
 * Gemini Code Assist backend). Built entirely in Cowork's layer — registered
 * into pi via its PUBLIC runtime APIs (registerOAuthProvider / registerApiProvider),
 * with NO edits to the vendored pi packages.
 *
 * Authenticates against the Antigravity / Gemini Code Assist backend using the
 * signed-in account's own quota. Everything here is overridable via env so
 * nothing is silently hard-pinned.
 *
 * Values mirror github.com/tuxevil/pi-antigravity-rotator (src/types.ts,
 * src/oauth.ts); the client id is the Antigravity desktop-app OAuth client id,
 * kept in its original base64 form.
 */

/** Provider id used across pi (auth.json key, model.provider, model.api). */
export const PROVIDER_ID = "google-antigravity";
/** Human label shown in the auth UI + model picker grouping. */
export const PROVIDER_NAME = "Gemini (Google)";

// ── OAuth client (Antigravity desktop app; env-overridable) ───────────────
export const CLIENT_ID =
	process.env.ANTIGRAVITY_CLIENT_ID ||
	atob(
		"MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
	);
// The Antigravity desktop-app client secret is NOT committed to source. It is
// injected into the bundle at build time by scripts/prebuild.mjs (from
// $ANTIGRAVITY_CLIENT_SECRET or the gitignored agent-sidecar/antigravity-client-secret
// file), which replaces the placeholder below. At runtime an explicit env var
// still wins. If neither is provided, Google sign-in will fail with a clear error.
export const CLIENT_SECRET =
	process.env.ANTIGRAVITY_CLIENT_SECRET || "__ANTIGRAVITY_CLIENT_SECRET__";

/**
 * Returns true when the client secret is a real injected value.
 * Returns false when the build-time placeholder is still present
 * (i.e. prebuild.mjs did not run or ANTIGRAVITY_CLIENT_SECRET is unset).
 */
export function isClientSecretConfigured(): boolean {
	return Boolean(CLIENT_SECRET) && !CLIENT_SECRET.startsWith("__ANTIGRAVITY");
}

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

/**
 * Loopback redirect. Antigravity's client allows this exact localhost callback;
 * we bind a server on the port and auto-capture the code (no manual paste — the
 * point of doing this natively for non-technical users).
 */
export const REDIRECT_URI =
	process.env.ANTIGRAVITY_REDIRECT_URI || "http://localhost:51121/oauth-callback";
export const REDIRECT_PORT = 51121;
export const REDIRECT_PATH = "/oauth-callback";

export const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];

// ── Code Assist backend (Bearer-authed; project-scoped) ───────────────────
/** Endpoint cascade for inference, tried on auth/availability failures. */
export const CODE_ASSIST_ENDPOINTS = [
	process.env.ANTIGRAVITY_ENDPOINT || "https://daily-cloudcode-pa.googleapis.com",
	"https://cloudcode-pa.googleapis.com",
];
/** Endpoints tried for `loadCodeAssist` project discovery (sandbox first). */
export const LOAD_CODE_ASSIST_ENDPOINTS = [
	process.env.ANTIGRAVITY_LOAD_ENDPOINT || "https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://daily-cloudcode-pa.googleapis.com",
];

const ANTIGRAVITY_VERSION = process.env.PI_AI_ANTIGRAVITY_VERSION || "1.107.0";
/** Mimic the Antigravity desktop client so the backend accepts the request. */
export const REQUEST_HEADERS: Record<string, string> = {
	"User-Agent":
		process.env.ANTIGRAVITY_USER_AGENT || `antigravity/${ANTIGRAVITY_VERSION} darwin/arm64`,
	"x-goog-api-client":
		process.env.ANTIGRAVITY_X_GOOG_API_CLIENT || "google-cloud-sdk vscode_cloudshelleditor/0.1",
	"Client-Metadata":
		process.env.ANTIGRAVITY_CLIENT_METADATA ||
		JSON.stringify({ ideType: "ANTIGRAVITY", platform: "MACOS", pluginType: "GEMINI" }),
};

/**
 * Curated Gemini model set surfaced once signed in. The picker shows these
 * grouped under "Gemini (Google)".
 *
 * `id` is the picker/display id; `upstream` is the model name the Code Assist
 * `streamGenerateContent` endpoint actually accepts (the two differ for the 3.x
 * "agent" models — mapping mirrors pi-antigravity-rotator's forwardRequest).
 * We intentionally do NOT auto-discover via `fetchAvailableModels`: its keys are
 * quota/display ids in a different namespace than the inference endpoint
 * accepts, so sending them verbatim would break the 3.x models.
 */
export interface GeminiModelDef {
	id: string;
	upstream: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
}

export const GEMINI_MODELS: GeminiModelDef[] = [
	{
		id: "gemini-2.5-pro",
		upstream: "gemini-2.5-pro",
		name: "Gemini 2.5 Pro",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	},
	{
		id: "gemini-2.5-flash",
		upstream: "gemini-2.5-flash",
		name: "Gemini 2.5 Flash",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	},
	// The backend's latest pro/flash. Display names follow Antigravity's
	// branding (3.1 Pro / 3.5 Flash); `upstream` is the name the inference
	// endpoint accepts (the "-agent" ids).
	{
		id: "gemini-3.1-pro",
		upstream: "gemini-pro-agent",
		name: "Gemini 3.1 Pro",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	},
	{
		id: "gemini-3.5-flash",
		upstream: "gemini-3-flash-agent",
		name: "Gemini 3.5 Flash",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	},
];
