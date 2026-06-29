/**
 * Tests for frontend key-format checker.
 *
 * Mirrors the sidecar tests at agent-sidecar/src/providers/key-validator.test.ts
 * but tests the frontend-only checkKeyFormat function.
 */

import { describe, expect, it } from "vitest";
import { KEY_FORMATS, checkKeyFormat } from "./key-format";

describe("KEY_FORMATS", () => {
	it("defines a regex for every known provider", () => {
		const providers = [
			"anthropic",
			"openai",
			"google",
			"gemini",
			"openrouter",
			"groq",
			"mistral",
			"deepseek",
			"xai",
			"opencode-go",
			"opencode",
		];
		for (const p of providers) {
			expect(KEY_FORMATS[p]).toBeDefined();
			expect(KEY_FORMATS[p]).toBeInstanceOf(RegExp);
		}
	});
});

describe("checkKeyFormat", () => {
	// ── Known providers: valid keys ───────────────────────────────────

	it("accepts a valid Anthropic key", () => {
		expect(checkKeyFormat("anthropic", "sk-ant-api03-0123456789abcdef").ok).toBe(true);
	});

	it("accepts a valid OpenAI key", () => {
		expect(checkKeyFormat("openai", "sk-0123456789abcdef0123456789").ok).toBe(true);
	});

	it("accepts a valid OpenAI project key", () => {
		expect(checkKeyFormat("openai", "sk-proj-0123456789abcdef0123456789").ok).toBe(true);
	});

	it("accepts a valid Google/Gemini key (AIza… 39 chars)", () => {
		expect(checkKeyFormat("google", "AIza0123456789abcdefghijklmnopqrstuvwxy").ok).toBe(true);
	});

	it("accepts a valid Gemini key", () => {
		expect(checkKeyFormat("gemini", "AIza0123456789abcdefghijklmnopqrstuvwxy").ok).toBe(true);
	});

	it("accepts a valid OpenRouter key", () => {
		expect(checkKeyFormat("openrouter", "sk-or-v1-0123456789abcdef0123456789").ok).toBe(true);
	});

	it("accepts a valid Groq key", () => {
		expect(checkKeyFormat("groq", "gsk_0123456789abcdef0123456789").ok).toBe(true);
	});

	it("accepts a valid Mistral key", () => {
		expect(checkKeyFormat("mistral", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6").ok).toBe(true);
	});

	it("accepts a valid DeepSeek key", () => {
		expect(checkKeyFormat("deepseek", "sk-TestKeyPlaceholderNotARealSecretXX").ok).toBe(true);
	});

	it("accepts a valid xAI key", () => {
		expect(checkKeyFormat("xai", "xai-0123456789abcdef012345").ok).toBe(true);
	});

	it("accepts a valid opencode-go key", () => {
		expect(checkKeyFormat("opencode-go", "sk-TestKeyPlaceholderNotARealSecretXX").ok).toBe(true);
	});

	it("accepts a valid opencode (Zen) key", () => {
		expect(checkKeyFormat("opencode", "sk-TestKeyPlaceholderNotARealSecretXX").ok).toBe(true);
	});

	it("rejects an Anthropic key pasted into the OpenCode Zen slot", () => {
		const r = checkKeyFormat("opencode", "sk-ant-api03-0123456789abcdef");
		expect(r.ok).toBe(false);
		expect(r.hint).toMatch(/opencode zen/i);
	});

	// ── Known providers: wrong-provider pastes ────────────────────────

	it("rejects an Anthropic key pasted into the OpenRouter slot", () => {
		const r = checkKeyFormat("openrouter", "sk-ant-api03-0123456789abcdef");
		expect(r.ok).toBe(false);
		expect(r.hint).toMatch(/openrouter/i);
	});

	it("rejects an OpenRouter key pasted into the Anthropic slot", () => {
		const r = checkKeyFormat("anthropic", "sk-or-v1-0123456789abcdef");
		expect(r.ok).toBe(false);
		expect(r.hint).toMatch(/anthropic/i);
	});

	it("rejects a truncated key", () => {
		expect(checkKeyFormat("openai", "sk-short").ok).toBe(false);
	});

	it("rejects a random string", () => {
		expect(checkKeyFormat("anthropic", "not-a-key-at-all").ok).toBe(false);
	});

	// ── Unknown / custom providers ────────────────────────────────────

	it("skips format check for unknown providers", () => {
		expect(checkKeyFormat("my-custom-vllm", "any-random-string").ok).toBe(true);
	});

	// ── Edge cases ────────────────────────────────────────────────────

	it("returns a helpful hint when format fails", () => {
		const r = checkKeyFormat("anthropic", "gsk_something");
		expect(r.hint).toContain("sk-ant-api03-");
	});

	it("returns ok for empty key (caller should handle emptiness separately)", () => {
		expect(checkKeyFormat("openai", "").ok).toBe(true);
	});

	it("trims whitespace before checking", () => {
		expect(checkKeyFormat("openai", "  sk-0123456789abcdef0123456789  ").ok).toBe(true);
	});
});
