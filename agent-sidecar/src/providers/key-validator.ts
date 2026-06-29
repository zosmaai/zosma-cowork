/**
 * key-validator — per-provider API key format checking + live probe.
 *
 * Tier 1: Synchronous regex-based format check for 10 known providers.
 * Tier 2: Asynchronous HTTP probe hitting the provider's cheapest auth endpoint.
 *
 * Design decision (see docs/tasks/issue-302-api-key-validation.md):
 * The regex table is duplicated on the frontend so format feedback is instant.
 * This module is the sidecar source of truth for pre-probe validation.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tier 1 — Per-provider key format regexes
// ═══════════════════════════════════════════════════════════════════════════

export const KEY_FORMATS: Record<string, RegExp> = {
	anthropic: /^sk-ant-api03-[0-9a-zA-Z]{16,}$/,
	openai: /^sk-(?:proj-)?[0-9a-zA-Z]{20,}$/,
	google: /^AIza[0-9A-Za-z_-]{35}$/,
	gemini: /^AIza[0-9A-Za-z_-]{35}$/,
	openrouter: /^sk-or-v1-[0-9a-zA-Z]{16,}$/,
	groq: /^gsk_[0-9a-zA-Z]{16,}$/,
	mistral: /^[A-Za-z0-9]{32}$/,
	deepseek: /^sk-[0-9a-zA-Z]{32,}$/,
	xai: /^xai-[0-9a-zA-Z]{16,}$/,
	"opencode-go": /^sk-[0-9a-zA-Z]{32,}$/,
	// "opencode" is the provider id for OpenCode Zen (display name "OpenCode Zen")
	opencode: /^sk-[0-9a-zA-Z]{32,}$/,
};

/**
 * Human-readable prefix hints, keyed by provider id.
 * Shown in the inline hint when format validation fails.
 */
const FORMAT_HINTS: Record<string, string> = {
	anthropic: "sk-ant-api03-…",
	openai: "sk-… or sk-proj-…",
	google: "AIza… (39 characters)",
	gemini: "AIza… (39 characters)",
	openrouter: "sk-or-v1-…",
	groq: "gsk_…",
	mistral: "32 alphanumeric characters",
	deepseek: "sk-… (32+ characters)",
	xai: "xai-…",
	"opencode-go": "sk-… (32+ characters)",
	opencode: "sk-… (32+ characters)",
};

/**
 * HUMAN_READABLE names for provider display in hints.
 */
const PROVIDER_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	gemini: "Gemini",
	openrouter: "OpenRouter",
	groq: "Groq",
	mistral: "Mistral",
	deepseek: "DeepSeek",
	xai: "xAI",
	"opencode-go": "OpenCode Go",
	opencode: "OpenCode Zen",
};

export interface FormatResult {
	ok: boolean;
	hint?: string;
}

/**
 * Check whether `key` matches the expected format for `provider`.
 *
 * If the provider is not in the regex table (custom / unknown), format
 * check is skipped silently — returns `{ ok: true }`.
 *
 * Pure function — no side effects, never throws.
 */
export function checkFormat(provider: string, key: string): FormatResult {
	const pattern = KEY_FORMATS[provider];
	if (!pattern) {
		// Unknown provider — skip format check
		return { ok: true };
	}

	const trimmed = key.trim();
	if (pattern.test(trimmed)) {
		return { ok: true };
	}

	// Build a helpful hint
	const displayName = PROVIDER_NAMES[provider] ?? provider;
	const expected = FORMAT_HINTS[provider];
	const hint = expected
		? `This doesn't look like a ${displayName} key. ${displayName} keys start with ${expected}.`
		: `This doesn't look like a ${displayName} key.`;

	return { ok: false, hint };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tier 2 — Live probe endpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a probe provider in PROBE_ENDPOINTS with:
 *   url: string | ((key: string) => string) — the endpoint URL
 *   headers?: Record<string, string> — additional headers besides the key header
 *   method?: string — defaults to GET
 *   body?: string — request body for POST probes
 *   keyHeader?: string — the header name used to send the API key.
 *     - "authorization" (default): sends `Authorization: Bearer <key>`
 *     - any other string (e.g. "x-api-key"): sends `<name>: <key>` (raw, no Bearer prefix)
 *     - "none": key is embedded in the URL (Gemini); no auth header is added
 */
interface ProbeEndpoint {
	url: string | ((key: string) => string);
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	keyHeader?: string;
}

const PROBE_ENDPOINTS: Record<string, ProbeEndpoint> = {
	openai: {
		url: "https://api.openai.com/v1/models",
	},
	openrouter: {
		// /auth/key is auth-protected and returns 401 for invalid keys.
		url: "https://openrouter.ai/api/v1/auth/key",
	},
	opencode: {
		// Provider id "opencode" = OpenCode Zen (display name "OpenCode Zen").
		// Uses Authorization: Bearer (same as opencode-go).
		// Uses deepseek-v4-flash-free (a FREE model on Zen) so the probe
		// never incurs charges even for valid keys.
		// Server validates model BEFORE auth for unrecognised models, so we
		// must use a real, known model (same constraint as opencode-go).
		// Valid key → 200 (free, no charge); Invalid key → 401 AuthError.
		url: "https://opencode.ai/zen/v1/chat/completions",
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: "deepseek-v4-flash-free",
			messages: [{ role: "user", content: "hi" }],
			max_tokens: 1,
		}),
	},
	"opencode-go": {
		// /v1/models is PUBLIC — returns 200 for any request, regardless of
		// auth. It CANNOT be used as an auth check.
		//
		// POST /v1/chat/completions is the correct probe:
		//   - Missing key  → 401 {type:"AuthError", message:"Missing API key."}
		//   - Invalid key  → 401 {type:"AuthError", message:"Invalid API key."}
		//   - Valid key    → 200 (actual completion) or limit/billing error (non-401)
		//
		// IMPORTANT: the server validates the *model* before the API key only
		// for unrecognised model IDs (returns 401 ModelError regardless of key).
		// Using a real, recognised model ensures auth errors come back as
		// AuthError 401 while a valid key returns a non-401 status.
		// We use deepseek-v4-flash (cheapest Go model) with max_tokens:1.
		url: "https://opencode.ai/zen/go/v1/chat/completions",
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: "deepseek-v4-flash",
			messages: [{ role: "user", content: "hi" }],
			max_tokens: 1,
		}),
	},
	anthropic: {
		// Anthropic uses `x-api-key` header — NOT `Authorization: Bearer`.
		// Sending Bearer causes a 401 even for valid keys.
		url: "https://api.anthropic.com/v1/messages",
		method: "POST",
		headers: {
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
		keyHeader: "x-api-key",
	},
	gemini: {
		// Gemini passes the key as a URL query param, not a header.
		url: (key: string) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
		keyHeader: "none",
	},
	google: {
		url: (key: string) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
		keyHeader: "none",
	},
};

// Providers that support probing — set of keys in PROBE_ENDPOINTS
const PROBE_PROVIDERS = new Set(Object.keys(PROBE_ENDPOINTS));

export interface ProbeResult {
	ok: boolean;
	status?: number;
	message?: string;
}

/**
 * Hit the provider's cheapest auth-verifying endpoint with a 5s timeout.
 *
 * Returns the probe result — never throws. Network errors, timeouts, and
 * parse failures are captured and returned as `{ ok: false, message }`.
 *
 * For providers with no probe endpoint registered, returns `{ ok: true }`
 * (skip silently).
 */
export async function liveProbe(
	provider: string,
	key: string,
	signal?: AbortSignal,
): Promise<ProbeResult> {
	const endpoint = PROBE_ENDPOINTS[provider];
	if (!endpoint) {
		return { ok: true };
	}

	// Build the request URL
	const resolvedUrl = typeof endpoint.url === "function" ? endpoint.url(key) : endpoint.url;

	// Build headers
	const headers: Record<string, string> = {
		...endpoint.headers,
	};

	// Add the API key via the header strategy declared on the endpoint:
	//   "none"        → key is in the URL query string already; skip header
	//   "x-api-key"   → Anthropic-style: `x-api-key: <key>` (raw, no Bearer)
	//   "authorization" (default) → standard: `Authorization: Bearer <key>`
	const keyHeader = endpoint.keyHeader ?? "authorization";
	if (keyHeader === "none") {
		// Key embedded in URL — no auth header needed
	} else if (keyHeader === "authorization") {
		headers.authorization = `Bearer ${key}`;
	} else {
		// Custom header (e.g. "x-api-key") — send key verbatim, no Bearer prefix
		headers[keyHeader] = key;
	}

	// Create a timeout signal (5s) that races with the caller's signal
	const timeoutAc = new AbortController();
	const timeoutId = setTimeout(() => timeoutAc.abort(new DOMException("Probe timed out", "TimeoutError")), 5_000);

	// Combine the caller's signal with our timeout
	const combinedSignal = combineSignals(timeoutAc.signal, signal);

	try {
		const response = await fetch(resolvedUrl, {
			method: endpoint.method ?? "GET",
			headers,
			body: endpoint.body,
			signal: combinedSignal,
		});

		clearTimeout(timeoutId);

		// Debug: log probe result so we can see what's happening
		// eslint-disable-next-line no-console
		console.error(`[probe] ${provider} → ${endpoint.method ?? "GET"} ${resolvedUrl} → ${response.status}`);

		// Try to extract error message from body (for reporting)
		let body: string | undefined;
		try {
			body = await response.text();
			body = body.slice(0, 200).trim() || undefined;
		} catch {
			// response.text() can fail — ignore
		}

		// 401/403 = authentication rejection → key is definitely invalid
		if (response.status === 401 || response.status === 403) {
			return {
				ok: false,
				status: response.status,
				message: body ?? `HTTP ${response.status}`,
			};
		}

		// 200 or any non-401 error (400, 404, 422, etc.) = auth passed.
		// The request may have failed for other reasons (bad model, wrong
		// endpoint), but the API key was accepted by the server.
		return {
			ok: true,
			status: response.status,
			message: response.ok ? undefined : (body ?? `HTTP ${response.status}`),
		};
	} catch (err: unknown) {
		clearTimeout(timeoutId);

		if (err instanceof DOMException) {
			if (err.name === "TimeoutError") {
				return { ok: false, message: "Probe timed out (couldn't reach provider)" };
			}
			if (err.name === "AbortError") {
				return { ok: false, message: "Probe cancelled" };
			}
		}

		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, message: msg };
	}
}

/**
 * Combine two AbortSignals into one — fires when EITHER signal aborts.
 *
 * Returns a new AbortController whose signal is safe to pass to fetch.
 * The controller is aborted if either source signal aborts, and the
 * caller should call controller.abort() to clean up when done.
 */
function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const controller = new (globalThis as any).AbortController();

	const activeSignals = signals.filter((s): s is AbortSignal => s !== undefined);
	if (activeSignals.length === 0) {
		// No signals at all — return the controller's signal
		// but we still need to clean it up later. Eh.
		return controller.signal;
	}

	// If any signal is already aborted, abort immediately
	if (activeSignals.some((s) => s.aborted)) {
		controller.abort(activeSignals.find((s) => s.aborted)?.reason);
		return controller.signal;
	}

	const onAbort = () => {
		// Find the reason from the first aborted signal
		const abortedSignal = activeSignals.find((s) => s.aborted);
		controller.abort(abortedSignal?.reason);
	};

	for (const sig of activeSignals) {
		sig.addEventListener("abort", onAbort, { once: true });
	}

	return controller.signal;
}

// ═══════════════════════════════════════════════════════════════════════════
// Combined validation
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
	ok: boolean;
	format?: FormatResult;
	probe?: ProbeResult;
}

/**
 * Run Tier 1 (format check) + Tier 2 (live probe) and return the combined
 * result.
 *
 * The live probe is authoritative: it ALWAYS runs when a probe endpoint is
 * registered for the provider, even if the format check fails. Format
 * regexes can be outdated and providers may accept keys we don't recognise.
 *
 * If the provider has no probe registered, the result falls back to the
 * format check alone.
 */
export async function validateProviderKey(
	provider: string,
	key: string,
	signal?: AbortSignal,
): Promise<ValidationResult> {
	const format = checkFormat(provider, key);

	// Always run the live probe when a probe endpoint exists, regardless
	// of format check result. The live probe is authoritative — format
	// regexes can be outdated or the provider may accept keys we don't
	// recognise. If the probe fails we block; if it succeeds we allow.
	if (PROBE_PROVIDERS.has(provider)) {
		const probe = await liveProbe(provider, key, signal);
		return { ok: probe.ok, format, probe };
	}

	// No probe registered — fall back to format check only
	return { ok: format.ok, format };
}
