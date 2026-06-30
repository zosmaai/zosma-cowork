/**
 * TDD tests for registerGeminiAntigravity() client-secret guard.
 * Issue #276: provider must not be registered when ANTIGRAVITY_CLIENT_SECRET
 * is missing / still the build-time placeholder.
 *
 * All mocks use vi.doMock (not hoisted) + dynamic import so each test gets a
 * fresh module with the desired constants.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("registerGeminiAntigravity – client secret guard", () => {
	let registerOAuthProvider: ReturnType<typeof vi.fn>;
	let registerGeminiApiProvider: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.resetModules();

		registerOAuthProvider = vi.fn();
		registerGeminiApiProvider = vi.fn();

		// Mock external deps that are NOT under test
		vi.doMock("@earendil-works/pi-ai/oauth", () => ({
			registerOAuthProvider,
		}));
		vi.doMock("./provider.js", () => ({
			registerGeminiApiProvider,
			PROJECT_HEADER: "x-antigravity-project",
			UPSTREAM_HEADER: "x-antigravity-upstream",
		}));
		vi.doMock("./oauth.js", () => ({
			runGeminiConsent: vi.fn(),
			refreshAccessToken: vi.fn(),
			discoverProject: vi.fn(),
			getUserEmail: vi.fn(),
		}));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("does NOT register the OAuth provider when CLIENT_SECRET is the build placeholder", async () => {
		vi.doMock("./constants.js", () => ({
			CLIENT_SECRET: "__ANTIGRAVITY_CLIENT_SECRET__",
			CLIENT_ID: "test-client-id",
			PROVIDER_ID: "google-antigravity",
			PROVIDER_NAME: "Gemini (Google)",
			GEMINI_MODELS: [],
			CODE_ASSIST_ENDPOINTS: [],
			// isClientSecretConfigured reflects the placeholder — returns false
			isClientSecretConfigured: () => false,
		}));

		const { registerGeminiAntigravity } = await import("./index.js");
		registerGeminiAntigravity();

		expect(registerOAuthProvider).not.toHaveBeenCalled();
	});

	it("does NOT register the API provider when CLIENT_SECRET is the build placeholder", async () => {
		vi.doMock("./constants.js", () => ({
			CLIENT_SECRET: "__ANTIGRAVITY_CLIENT_SECRET__",
			CLIENT_ID: "test-client-id",
			PROVIDER_ID: "google-antigravity",
			PROVIDER_NAME: "Gemini (Google)",
			GEMINI_MODELS: [],
			CODE_ASSIST_ENDPOINTS: [],
			isClientSecretConfigured: () => false,
		}));

		const { registerGeminiAntigravity } = await import("./index.js");
		registerGeminiAntigravity();

		expect(registerGeminiApiProvider).not.toHaveBeenCalled();
	});

	it("DOES register the OAuth provider when CLIENT_SECRET is a real value", async () => {
		vi.doMock("./constants.js", () => ({
			CLIENT_SECRET: "real-secret-abc123",
			CLIENT_ID: "test-client-id",
			PROVIDER_ID: "google-antigravity",
			PROVIDER_NAME: "Gemini (Google)",
			GEMINI_MODELS: [],
			CODE_ASSIST_ENDPOINTS: [],
			isClientSecretConfigured: () => true,
		}));

		const { registerGeminiAntigravity } = await import("./index.js");
		registerGeminiAntigravity();

		expect(registerOAuthProvider).toHaveBeenCalledOnce();
	});

	it("DOES register the API provider when CLIENT_SECRET is a real value", async () => {
		vi.doMock("./constants.js", () => ({
			CLIENT_SECRET: "real-secret-abc123",
			CLIENT_ID: "test-client-id",
			PROVIDER_ID: "google-antigravity",
			PROVIDER_NAME: "Gemini (Google)",
			GEMINI_MODELS: [],
			CODE_ASSIST_ENDPOINTS: [],
			isClientSecretConfigured: () => true,
		}));

		const { registerGeminiAntigravity } = await import("./index.js");
		registerGeminiAntigravity();

		expect(registerGeminiApiProvider).toHaveBeenCalledOnce();
	});

	it("writes a debug message to stderr when skipping registration", async () => {
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		vi.doMock("./constants.js", () => ({
			CLIENT_SECRET: "__ANTIGRAVITY_CLIENT_SECRET__",
			CLIENT_ID: "test-client-id",
			PROVIDER_ID: "google-antigravity",
			PROVIDER_NAME: "Gemini (Google)",
			GEMINI_MODELS: [],
			CODE_ASSIST_ENDPOINTS: [],
			isClientSecretConfigured: () => false,
		}));

		const { registerGeminiAntigravity } = await import("./index.js");
		registerGeminiAntigravity();

		expect(stderrSpy).toHaveBeenCalled();
		const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(written).toContain("client secret not configured");
	});

	it("writes a success message to stderr when secret IS configured", async () => {
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		vi.doMock("./constants.js", () => ({
			CLIENT_SECRET: "real-secret-abc123",
			CLIENT_ID: "test-client-id",
			PROVIDER_ID: "google-antigravity",
			PROVIDER_NAME: "Gemini (Google)",
			GEMINI_MODELS: [],
			CODE_ASSIST_ENDPOINTS: [],
			isClientSecretConfigured: () => true,
		}));

		const { registerGeminiAntigravity } = await import("./index.js");
		registerGeminiAntigravity();

		expect(stderrSpy).toHaveBeenCalled();
		const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(written).toContain("registered");
	});
});

describe("isClientSecretConfigured", () => {
	beforeEach(() => {
		// Clear any vi.doMock factories left by the previous describe block so
		// these tests always import the REAL constants module.
		vi.doUnmock("./constants.js");
		vi.doUnmock("./provider.js");
		vi.doUnmock("./oauth.js");
		vi.doUnmock("@earendil-works/pi-ai/oauth");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("returns false when env var is unset (falls back to build placeholder)", async () => {
		vi.stubEnv("ANTIGRAVITY_CLIENT_SECRET", "");
		vi.resetModules();
		const { isClientSecretConfigured } = await import("./constants.js");
		expect(isClientSecretConfigured()).toBe(false);
	});

	it("returns false when env var is explicitly the placeholder string", async () => {
		vi.stubEnv("ANTIGRAVITY_CLIENT_SECRET", "__ANTIGRAVITY_CLIENT_SECRET__");
		vi.resetModules();
		const { isClientSecretConfigured } = await import("./constants.js");
		expect(isClientSecretConfigured()).toBe(false);
	});

	it("returns true when env var contains a real secret", async () => {
		vi.stubEnv("ANTIGRAVITY_CLIENT_SECRET", "super-secret-value");
		vi.resetModules();
		const { isClientSecretConfigured } = await import("./constants.js");
		expect(isClientSecretConfigured()).toBe(true);
	});
});
