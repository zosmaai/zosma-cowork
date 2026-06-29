/**
 * Frontend-side per-provider API key format checking.
 *
 * This regex table is duplicated from agent-sidecar/src/providers/key-validator.ts
 * by design (see docs/tasks/issue-302-api-key-validation.md):
 * the table is small (~10 entries), static, and changes rarely. Duplication
 * avoids cross-bundle import complexity and keeps format feedback instant
 * (no round-trip to the sidecar).
 *
 * The sidecar copy is the source of truth for pre-probe validation.
 */

/** Per-provider key format patterns */
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

/** Human-friendly prefix hints shown in the inline validation message */
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

/** Human-readable provider display names */
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

export interface FormatCheckResult {
	ok: boolean;
	hint?: string;
}

/**
 * Check whether `key` looks like it belongs to `provider`.
 *
 * Unknown providers (not in the regex table) skip the check — returns
 * `{ ok: true }` with no hint.
 *
 * Pure function — never throws.
 */
export function checkKeyFormat(provider: string, key: string): FormatCheckResult {
	if (!key.trim()) {
		return { ok: true };
	}

	const pattern = KEY_FORMATS[provider];
	if (!pattern) {
		// Unknown provider — skip format check
		return { ok: true };
	}

	if (pattern.test(key.trim())) {
		return { ok: true };
	}

	const displayName = PROVIDER_NAMES[provider] ?? provider;
	const expected = FORMAT_HINTS[provider];
	const hint = expected
		? `This doesn't look like a ${displayName} key. ${displayName} keys typically start with ${expected}.`
		: `This doesn't look like a ${displayName} key — proceed if you're sure.`;

	return { ok: false, hint };
}
