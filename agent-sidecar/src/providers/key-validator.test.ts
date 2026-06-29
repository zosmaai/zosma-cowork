/**
 * Tests for key-validator — per-provider format check + live probe.
 *
 * TDD: these tests were written before the implementation. They must fail
 * initially (missing module), then pass once key-validator.ts is written.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkFormat,
	KEY_FORMATS,
	liveProbe,
	validateProviderKey,
} from "./key-validator.js";

// ═══════════════════════════════════════════════════════════════════════════
// Tier 1 — Format check
// ═══════════════════════════════════════════════════════════════════════════

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

describe("checkFormat", () => {
	// ── Known providers: valid keys ───────────────────────────────────

	it("accepts a valid Anthropic key (sk-ant-api03-…)", () => {
		const r = checkFormat("anthropic", "sk-ant-api03-0123456789abcdef");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid OpenAI key (sk-…)", () => {
		const r = checkFormat("openai", "sk-0123456789abcdef0123456789");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid OpenAI project key (sk-proj-…)", () => {
		const r = checkFormat("openai", "sk-proj-0123456789abcdef0123456789");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid Google/Gemini key (AIza… 39 chars)", () => {
		// 39 chars total: "AIza" (4) + exactly 35 alphanumeric chars = 39
		const r = checkFormat("google", "AIza0123456789abcdefghijklmnopqrstuvwxy");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid Gemini key (same pattern as google)", () => {
		const r = checkFormat("gemini", "AIza0123456789abcdefghijklmnopqrstuvwxy");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid OpenRouter key (sk-or-v1-…)", () => {
		const r = checkFormat("openrouter", "sk-or-v1-0123456789abcdef0123456789");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid Groq key (gsk_…)", () => {
		const r = checkFormat("groq", "gsk_0123456789abcdef0123456789");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid Mistral key (32 alphanumeric chars)", () => {
		const r = checkFormat("mistral", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid DeepSeek key (sk-…)", () => {
		const r = checkFormat("deepseek", "sk-TestKeyPlaceholderNotARealSecretXX");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid xAI key (xai-…)", () => {
		const r = checkFormat("xai", "xai-0123456789abcdef012345");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid opencode-go key (sk-…)", () => {
		const r = checkFormat("opencode-go", "sk-TestKeyPlaceholderNotARealSecretXX");
		expect(r.ok).toBe(true);
	});

	it("accepts a valid opencode (Zen) key (sk-…)", () => {
		const r = checkFormat("opencode", "sk-TestKeyPlaceholderNotARealSecretXX");
		expect(r.ok).toBe(true);
	});

	it("rejects an Anthropic key pasted into the OpenCode Zen slot", () => {
		const r = checkFormat("opencode", "sk-ant-api03-0123456789abcdef");
		expect(r.ok).toBe(false);
		expect(r.hint).toMatch(/opencode zen/i);
	});

	// ── Known providers: invalid (wrong-provider pastes) ──────────────

	it("rejects an Anthropic key pasted into the OpenRouter slot", () => {
		// Format is valid Anthropic, not OpenRouter
		const r = checkFormat("openrouter", "sk-ant-api03-0123456789abcdef");
		expect(r.ok).toBe(false);
		expect(r.hint).toMatch(/openrouter/i);
	});

	it("rejects an OpenRouter key pasted into the Anthropic slot", () => {
		const r = checkFormat("anthropic", "sk-or-v1-0123456789abcdef");
		expect(r.ok).toBe(false);
		expect(r.hint).toMatch(/anthropic/i);
	});

	it("rejects a Google key pasted into the Groq slot", () => {
		const r = checkFormat("groq", "AIza0123456789abcdefghijklmnopqrs");
		expect(r.ok).toBe(false);
		expect(r.hint).toMatch(/groq/i);
	});

	it("rejects a truncated key for any provider", () => {
		const r = checkFormat("openai", "sk-short");
		expect(r.ok).toBe(false);
	});

	it("rejects a totally random string", () => {
		const r = checkFormat("anthropic", "this-is-not-a-key");
		expect(r.ok).toBe(false);
	});

	// ── Unknown / custom providers ────────────────────────────────────

	it("skips format check for unknown providers (returns ok)", () => {
		const r = checkFormat("my-custom-vllm", "any-random-string");
		expect(r.ok).toBe(true);
	});

	// ── Edge cases ────────────────────────────────────────────────────

	it("returns hint when format fails", () => {
		const r = checkFormat("anthropic", "sk-or-v1-xxx");
		expect(r.hint).toBeTruthy();
		expect(typeof r.hint).toBe("string");
	});

	it("returns expected prefix in hint on failure", () => {
		const r = checkFormat("anthropic", "gsk_something");
		expect(r.hint).toContain("sk-ant-api03-");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Tier 2 — Live probe
// ═══════════════════════════════════════════════════════════════════════════

describe("liveProbe", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("returns { ok: true } when the endpoint returns 200", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		const r = await liveProbe("openai", "sk-test");

		expect(r.ok).toBe(true);
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("returns { ok: false } with status when the endpoint returns 401", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("unauthorized", { status: 401 }),
		);

		const r = await liveProbe("openai", "sk-bad");

		expect(r.ok).toBe(false);
		expect(r.status).toBe(401);
	});

	it("returns { ok: false } with message on network error", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

		const r = await liveProbe("openai", "sk-test");

		expect(r.ok).toBe(false);
		expect(r.message).toBeTruthy();
	});

	it("returns { ok: false } with message on timeout", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));

		const r = await liveProbe("openai", "sk-test");

		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/timed? out|timeout/i);
	});

	it("hits the correct endpoint for Anthropic probes", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		await liveProbe("anthropic", "sk-ant-api03-test");

		expect(mockFetch).toHaveBeenCalled();
		const url = mockFetch.mock.calls[0][0];
		expect(url).toContain("api.anthropic.com");
	});

	it("sends x-api-key header for Anthropic (not Authorization Bearer)", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		const testKey = "sk-ant-api03-realkey123";
		await liveProbe("anthropic", testKey);

		const opts = mockFetch.mock.calls[0][1] as RequestInit;
		const hdrs = opts?.headers as Record<string, string>;

		// Must use x-api-key, NOT Authorization: Bearer
		expect(hdrs["x-api-key"]).toBe(testKey);
		expect(hdrs["authorization"]).toBeUndefined();
	});

	it("sends Authorization: Bearer for OpenAI (not x-api-key)", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		const testKey = "sk-0123456789abcdefghij";
		await liveProbe("openai", testKey);

		const opts = mockFetch.mock.calls[0][1] as RequestInit;
		const hdrs = opts?.headers as Record<string, string>;

		expect(hdrs["authorization"]).toBe(`Bearer ${testKey}`);
		expect(hdrs["x-api-key"]).toBeUndefined();
	});

	it("does NOT add an auth header for Gemini (key is in URL query param)", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		const testKey = "AIzaTestKey1234567890";
		await liveProbe("gemini", testKey);

		const url = mockFetch.mock.calls[0][0] as string;
		const opts = mockFetch.mock.calls[0][1] as RequestInit;
		const hdrs = opts?.headers as Record<string, string>;

		// Key must be in the URL, not in an auth header
		expect(url).toContain(`key=${encodeURIComponent(testKey)}`);
		expect(hdrs["authorization"]).toBeUndefined();
		expect(hdrs["x-api-key"]).toBeUndefined();
	});

	it("probes opencode (Zen) via POST to zen/v1/chat/completions with free model", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		await liveProbe("opencode", "sk-TestKeyPlaceholderNotARealSecretXX");

		expect(mockFetch).toHaveBeenCalled();
		const url = mockFetch.mock.calls[0][0] as string;
		const opts = mockFetch.mock.calls[0][1] as RequestInit;
		const body = JSON.parse(opts?.body as string);

		expect(url).toContain("opencode.ai/zen/v1/chat/completions");
		expect(opts?.method?.toUpperCase()).toBe("POST");
		// Must use a real model that is FREE on Zen to avoid charging valid users
		expect(body.model).toBe("deepseek-v4-flash-free");
	});

	it("rejects opencode (Zen) key when server returns 401", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ type: "error", error: { type: "AuthError", message: "Invalid API key." } }), { status: 401 }),
		);

		const r = await liveProbe("opencode", "sk-boguskey12345678901234567890123");
		expect(r.ok).toBe(false);
		expect(r.status).toBe(401);
	});

	it("uses POST /v1/chat/completions for opencode-go probe (NOT the public /v1/models)", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		await liveProbe("opencode-go", "sk-TestKeyPlaceholderNotARealSecretXX");

		expect(mockFetch).toHaveBeenCalled();
		const url = mockFetch.mock.calls[0][0] as string;
		const opts = mockFetch.mock.calls[0][1] as RequestInit;

		// /v1/models is PUBLIC on the Go API — it must NOT be used for auth checks
		expect(url).not.toContain("/v1/models");
		expect(url).toContain("/v1/chat/completions");
		expect(opts?.method?.toUpperCase()).toBe("POST");
	});

	it("sends a real model name in the opencode-go probe body (fake models return ModelError 401 regardless of key validity)", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		await liveProbe("opencode-go", "sk-TestKeyPlaceholderNotARealSecretXX");

		const opts = mockFetch.mock.calls[0][1] as RequestInit;
		const body = JSON.parse(opts?.body as string);

		// Must use a real, recognised Go model — the server validates the model
		// BEFORE auth for unrecognised models, returning 401 ModelError for both
		// valid and invalid keys. Only a real model produces 401 AuthError for
		// invalid keys and a non-401 response for valid keys.
		expect(body.model).toBe("deepseek-v4-flash");
	});

	it("rejects opencode-go key when server returns 401", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("unauthorized", { status: 401 }),
		);

		const r = await liveProbe("opencode-go", "sk-invalidkey12345678901234567890");
		expect(r.ok).toBe(false);
		expect(r.status).toBe(401);
	});

	it("rejects Anthropic key when server returns 401 (wrong key, correct header)", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: { type: "authentication_error" } }), { status: 401 }),
		);

		const r = await liveProbe("anthropic", "sk-ant-api03-badkey");
		expect(r.ok).toBe(false);
		expect(r.status).toBe(401);
	});

	it("hits the correct endpoint for Gemini probes", async () => {
		const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		await liveProbe("gemini", "AIza-test");

		expect(mockFetch).toHaveBeenCalled();
		const url = mockFetch.mock.calls[0][0];
		expect(url).toContain("generativelanguage.googleapis.com");
	});

	it("returns ok=true for providers with no probe registered", async () => {
		const r = await liveProbe("mistral", "some-key");
		expect(r.ok).toBe(true);
	});

	it("respects an AbortSignal (cancels on abort)", async () => {
		const ac = new AbortController();
		// Mock fetch that respects the abort signal — rejects when signalled
		const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(
			(_url, opts) => new Promise((_resolve, reject) => {
				if (opts?.signal) {
					opts.signal.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					}, { once: true });
				}
			}),
		);

		// Schedule abort
		setTimeout(() => ac.abort(), 10);

		const r = await liveProbe("openai", "sk-test", ac.signal);

		expect(r.ok).toBe(false);
		expect(r.message).toMatch(/cancel|cancelled|abort/i);
		expect(mockFetch).toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Combined validation
// ═══════════════════════════════════════════════════════════════════════════

describe("validateProviderKey", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("runs probe even when format is wrong (probe is authoritative)", async () => {
		// The probe endpoint returns 401 — the key is rejected regardless of format
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("unauthorized", { status: 401 }),
		);

		const r = await validateProviderKey("anthropic", "sk-or-v1-wrong");

		// Format fails but probe also fails — top-level ok is driven by probe
		expect(r.ok).toBe(false);
		expect(r.format?.ok).toBe(false);
		expect(r.probe?.ok).toBe(false);
		expect(r.probe?.status).toBe(401);
	});

	it("returns format pass + probe pass when both succeed", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", { status: 200 }),
		);

		const r = await validateProviderKey("openai", "sk-0123456789abcdef01234567890abc");

		expect(r.ok).toBe(true);
		expect(r.format?.ok).toBe(true);
		expect(r.probe?.ok).toBe(true);
	});

	it("returns format pass + probe fail when probe rejects the key", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("unauthorized", { status: 401 }),
		);

		const r = await validateProviderKey("openai", "sk-0123456789abcdef01234567890abc");

		expect(r.ok).toBe(false);
		expect(r.format?.ok).toBe(true);
		expect(r.probe?.ok).toBe(false);
		expect(r.probe?.status).toBe(401);
	});

	it("skips probe for unknown providers with no probe handler", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		const r = await validateProviderKey("my-custom-provider", "some-key");

		expect(r.ok).toBe(true);
		expect(r.format?.ok).toBe(true);
		expect(r.probe).toBeUndefined();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("skips probe for provider with no probe handler even if format passes", async () => {
		// mistral has a format check but no probe registered
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		const r = await validateProviderKey("mistral", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6");

		expect(r.ok).toBe(true);
		expect(r.format?.ok).toBe(true);
		expect(r.probe).toBeUndefined();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
