/**
 * Gemini (Google) provider — registers a "Sign in with Google → Gemini" OAuth
 * provider into pi via its PUBLIC runtime registry, with NO edits to the
 * vendored pi packages. Because the existing `start_oauth` / `get_auth_status`
 * commands already drive any registered OAuth provider, signing in becomes just
 * another row in the auth UI (no new sidecar commands needed).
 *
 * Stage 1–2 (this file): OAuth login + token refresh + model injection, so
 * sign-in shows Connected and the Gemini models appear in the picker.
 * Stage 3–4 (provider.ts, registered below once added): the v1internal
 * streamGenerateContent translator that actually runs inference.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import {
	type OAuthCredentials,
	type OAuthProviderInterface,
	registerOAuthProvider,
} from "@earendil-works/pi-ai/oauth";
import {
	CLIENT_SECRET,
	CODE_ASSIST_ENDPOINTS,
	GEMINI_MODELS,
	PROVIDER_ID,
	PROVIDER_NAME,
	isClientSecretConfigured,
} from "./constants.js";
import { discoverProject, getUserEmail, refreshAccessToken, runGeminiConsent } from "./oauth.js";
import { PROJECT_HEADER, UPSTREAM_HEADER, registerGeminiApiProvider } from "./provider.js";

/** Our credentials carry the discovered projectId + email alongside the tokens. */
interface GeminiCredentials extends OAuthCredentials {
	projectId: string;
	email?: string;
}

function expiresAt(expiresInSeconds: number): number {
	// ms epoch with a 5-minute safety buffer (matches pi's built-in providers).
	return Date.now() + expiresInSeconds * 1000 - 5 * 60 * 1000;
}

const provider: OAuthProviderInterface = {
	id: PROVIDER_ID,
	name: PROVIDER_NAME,
	usesCallbackServer: true,

	async login(callbacks): Promise<OAuthCredentials> {
		callbacks.onProgress?.("Opening Google sign-in…");
		const tokens = await runGeminiConsent({
			onAuthUrl: (url) =>
				callbacks.onAuth({
					url,
					instructions: "Sign in with your Google account to enable Gemini.",
				}),
			signal: callbacks.signal,
		});
		callbacks.onProgress?.("Finding your Gemini Code Assist project…");
		const projectId = await discoverProject(tokens.accessToken, callbacks.onProgress);
		const email = await getUserEmail(tokens.accessToken);
		const creds: GeminiCredentials = {
			access: tokens.accessToken,
			refresh: tokens.refreshToken,
			expires: expiresAt(tokens.expiresIn),
			projectId,
			email,
		};
		return creds;
	},

	async refreshToken(credentials): Promise<OAuthCredentials> {
		const { accessToken, expiresIn } = await refreshAccessToken(credentials.refresh);
		return {
			...credentials,
			access: accessToken,
			expires: expiresAt(expiresIn),
		};
	},

	getApiKey(credentials): string {
		return credentials.access;
	},

	// Inject the Gemini models once signed in. The api provider for
	// PROVIDER_ID (provider.ts) handles the actual requests; here we only make
	// the models appear + resolvable. baseUrl is the inference endpoint.
	modifyModels(models, credentials): Model<Api>[] {
		const baseUrl = CODE_ASSIST_ENDPOINTS[0];
		const projectId = (credentials as GeminiCredentials).projectId;
		const injected: Model<Api>[] = GEMINI_MODELS.map((m) => ({
			id: m.id,
			name: m.name,
			api: PROVIDER_ID as Api,
			provider: PROVIDER_ID,
			baseUrl,
			reasoning: m.reasoning,
			input: m.input,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			// Carry the projectId + the upstream model name to the api provider
			// (provider.ts reads model.headers[...]); not forwarded as HTTP headers.
			headers: { [PROJECT_HEADER]: projectId, [UPSTREAM_HEADER]: m.upstream },
		}));
		// Drop any pre-existing entries with our provider id, then append ours.
		return [...models.filter((m) => m.provider !== PROVIDER_ID), ...injected];
	},
};

let registered = false;

/** Idempotently register the Gemini (Google) provider. Call once at startup. */
export function registerGeminiAntigravity(): void {
	if (registered) return;

	if (!isClientSecretConfigured()) {
		// Log to stderr — stdout is reserved for the JSON sidecar protocol.
		const prefix =
			CLIENT_SECRET && CLIENT_SECRET.length > 8
				? `${CLIENT_SECRET.slice(0, 4)}...${CLIENT_SECRET.slice(-4)}`
				: `<${CLIENT_SECRET.slice(0, 40)}>`;
		process.stderr.write(
			`[gemini-antigravity] Skipping provider registration: client secret not configured (value: ${prefix})\n`,
		);
		return;
	}

	registered = true;
	process.stderr.write("[gemini-antigravity] Provider registered successfully.\n");
	registerOAuthProvider(provider);
	registerGeminiApiProvider();
}
