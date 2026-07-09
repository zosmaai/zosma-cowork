// ── Zosma account (Better Auth session) ─────────────────────────────────────

/** User record returned by Better Auth's `getSession().data.user`. */
export type ZosmaUser = {
	id: string;
	name: string;
	email: string;
	image?: string | null;
	emailVerified: boolean;
	createdAt: Date;
	updatedAt: Date;
};

// ── LLM provider credentials ─────────────────────────────────────────────────

/**
 * Shared auth types — mirror of the sidecar's `get_auth_status` response.
 *
 * Kept here (rather than re-declared in each consumer) so adding a field
 * on the sidecar only needs one frontend update.
 */

export type AuthStatusEntry = {
	id: string;
	type: "api_key" | "oauth" | "unknown";
	expires?: number;
};

export type ApiKeyProvider = {
	/** Provider id used by pi-mono's `AuthStorage` and `ModelRegistry`. */
	id: string;
	/** Human-friendly label from `ModelRegistry.getProviderDisplayName()`. */
	displayName: string;
};

export type AuthStatus = {
	/** Currently configured credentials, one per provider id. */
	providers: AuthStatusEntry[];
	/** OAuth-capable provider ids the SDK supports. */
	supported: string[];
	/**
	 * Every provider pi-mono knows about, deduped, sorted by display name.
	 * The UI uses this to populate the API-key provider picker (issue #150).
	 *
	 * Optional because older sidecar builds did not return it — UI must
	 * treat absence as "no picker, freeform input".
	 */
	apiKeyProviders?: ApiKeyProvider[];
};

/**
 * User-added OpenAI-compatible endpoint (issue #207).
 *
 * Returned by the sidecar's `list_custom_providers` command. The raw API
 * key is NEVER round-tripped to the frontend; `apiKeyHint` shows only the
 * last 4 chars when one is configured.
 */
export type CustomProvider = {
	id: string;
	name: string;
	baseUrl: string;
	hasApiKey: boolean;
	apiKeyHint?: string;
	models: { id: string; name: string }[];
};

/** Input shape accepted by `save_custom_provider`. */
export type SaveCustomProviderInput = {
	id: string;
	name: string;
	baseUrl: string;
	/** Optional. Empty / undefined → sidecar stores a sentinel placeholder. */
	apiKey?: string;
	models: {
		id: string;
		name?: string;
		contextWindow?: number;
		maxTokens?: number;
		/** Reasoning/"thinking" capability — drives the status-line pill. */
		reasoning?: boolean;
		/** Curates pi's reasoning ladder (null removes a level, string remaps). */
		thinkingLevelMap?: Record<string, string | null>;
		/** Wire-format quirks, e.g. `{ thinkingFormat: "qwen-chat-template" }`. */
		compat?: Record<string, unknown>;
	}[];
};
