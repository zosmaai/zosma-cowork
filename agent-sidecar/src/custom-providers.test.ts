/**
 * Tests for the custom-OpenAI-compatible provider store.
 *
 * Issue #207 — the desktop app needs a way to point pi-mono at a local
 * inference server (Ollama, LM Studio, vLLM, llama.cpp `--server`, …) by
 * supplying just a base URL and an optional API key. pi-mono's
 * `ModelRegistry` already speaks `models.json`'s `providers.<id>` shape;
 * this module is the thin upsert/list/delete layer the sidecar exposes
 * to the UI.
 *
 * The most important guarantee here is the round-trip with the real
 * `ModelRegistry`: whatever we write to models.json MUST be loaded back
 * as a usable `Model<Api>` so the model dropdown lights up. That's the
 * last test below — fail-loud against pi-coding-agent's own validator.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deleteCustomProvider,
	discoverModels,
	listCustomProviders,
	modelsEndpoints,
	normalizeModelInput,
	resolveModelInput,
	saveCustomProvider,
} from "./custom-providers.js";

const VALID_INPUT = {
	id: "custom-local-llm",
	name: "Custom Local LLM",
	baseUrl: "http://localhost:11434/v1",
	models: [{ id: "llama3.1:8b", name: "Llama 3.1 8B (local)" }],
};

describe("custom-providers", () => {
	let dir: string;
	let modelsPath: string;
	let authPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "zosma-custom-providers-"));
		modelsPath = join(dir, "models.json");
		authPath = join(dir, "auth.json");
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	// ── saveCustomProvider ─────────────────────────────────────────────

	it("writes a fresh models.json with the canonical providers.<id> shape", () => {
		saveCustomProvider(modelsPath, { ...VALID_INPUT, apiKey: "sk-test-1234" });

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers["custom-local-llm"]).toMatchObject({
			name: "Custom Local LLM",
			baseUrl: "http://localhost:11434/v1",
			apiKey: "sk-test-1234",
			api: "openai-completions",
			models: [{ id: "llama3.1:8b", name: "Llama 3.1 8B (local)" }],
		});
	});

	it("creates the parent directory if missing", () => {
		const nestedPath = join(dir, "deep", "nested", "models.json");
		saveCustomProvider(nestedPath, VALID_INPUT);
		expect(existsSync(nestedPath)).toBe(true);
	});

	it("merges with an existing models.json without clobbering other providers", () => {
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: {
					"other-provider": { baseUrl: "https://example.com/v1", apiKey: "k" },
				},
			}),
		);

		saveCustomProvider(modelsPath, VALID_INPUT);

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(Object.keys(config.providers).sort()).toEqual([
			"custom-local-llm",
			"other-provider",
		]);
		expect(config.providers["other-provider"].baseUrl).toBe("https://example.com/v1");
	});

	it("overwrites an existing entry with the same id (idempotent re-save)", () => {
		saveCustomProvider(modelsPath, VALID_INPUT);
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			baseUrl: "http://localhost:1234/v1",
			models: [{ id: "phi-3-mini" }],
		});

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers["custom-local-llm"].baseUrl).toBe("http://localhost:1234/v1");
		expect(config.providers["custom-local-llm"].models).toEqual([
			{ id: "phi-3-mini", name: "phi-3-mini" },
		]);
	});

	it("strips a trailing slash from the base URL so the OpenAI client doesn't double it", () => {
		saveCustomProvider(modelsPath, { ...VALID_INPUT, baseUrl: "http://localhost:11434/v1/" });

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers["custom-local-llm"].baseUrl).toBe("http://localhost:11434/v1");
	});

	// pi-coding-agent's ModelRegistry.validateConfig REQUIRES an apiKey for
	// any non-built-in provider that defines custom models, even though local
	// servers like Ollama/LM Studio ignore the Authorization header. We store
	// a sentinel placeholder so the validator passes; the user can override
	// it later from the UI without breaking anything.
	it("stores a sentinel placeholder when the API key is omitted", () => {
		saveCustomProvider(modelsPath, VALID_INPUT);

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers["custom-local-llm"].apiKey).toBe("no-auth");
	});

	it("treats an empty-string API key the same as omitted (placeholder)", () => {
		saveCustomProvider(modelsPath, { ...VALID_INPUT, apiKey: "" });

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers["custom-local-llm"].apiKey).toBe("no-auth");
	});

	// Edit flow: the raw key never round-trips to the UI, so re-saving with a
	// blank key must KEEP the previously stored key, not wipe it to the sentinel.
	it("preserves an existing real API key when re-saved with a blank key (edit)", () => {
		saveCustomProvider(modelsPath, { ...VALID_INPUT, apiKey: "sk-keep-me" });
		// Edit the model id, leave the key field blank.
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			apiKey: undefined,
			models: [{ id: "phi-3-mini" }],
		});

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers["custom-local-llm"].apiKey).toBe("sk-keep-me");
		expect(config.providers["custom-local-llm"].models).toEqual([
			{ id: "phi-3-mini", name: "phi-3-mini" },
		]);
	});

	it("does not invent a key when a keyless provider is re-saved blank (stays sentinel)", () => {
		saveCustomProvider(modelsPath, VALID_INPUT);
		saveCustomProvider(modelsPath, { ...VALID_INPUT, baseUrl: "http://localhost:9999/v1" });

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers["custom-local-llm"].apiKey).toBe("no-auth");
	});

	// ── per-model reasoning capability (status-line honesty) ──────────────

	it("persists explicit reasoning capability fields on a model", () => {
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [
				{
					id: "gemma-thinker",
					reasoning: true,
					contextWindow: 131072,
					compat: { thinkingFormat: "qwen-chat-template" },
					thinkingLevelMap: { minimal: null, low: null, medium: null, xhigh: null },
				},
			],
		});
		const m = JSON.parse(readFileSync(modelsPath, "utf-8")).providers["custom-local-llm"].models[0];
		expect(m.reasoning).toBe(true);
		expect(m.contextWindow).toBe(131072);
		expect(m.compat).toEqual({ thinkingFormat: "qwen-chat-template" });
		expect(m.thinkingLevelMap).toEqual({ minimal: null, low: null, medium: null, xhigh: null });
	});

	// Auto-discovery only knows model ids, so a re-save (or base-URL edit)
	// passes bare {id} entries. Capability a user configured must survive.
	it("preserves per-model reasoning capability across a re-save/re-discovery", () => {
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [
				{
					id: "gemma-thinker",
					name: "Gemma Thinker",
					reasoning: true,
					compat: { thinkingFormat: "qwen-chat-template" },
					thinkingLevelMap: { minimal: null, low: null, medium: null, xhigh: null },
				},
			],
		});
		// Simulate the discovery path: bare ids, no capability, no friendly name.
		saveCustomProvider(modelsPath, { ...VALID_INPUT, models: [{ id: "gemma-thinker" }] });

		const m = JSON.parse(readFileSync(modelsPath, "utf-8")).providers["custom-local-llm"].models[0];
		expect(m.reasoning).toBe(true);
		expect(m.compat).toEqual({ thinkingFormat: "qwen-chat-template" });
		expect(m.thinkingLevelMap).toEqual({ minimal: null, low: null, medium: null, xhigh: null });
		// A previously chosen display name is kept rather than reset to the id.
		expect(m.name).toBe("Gemma Thinker");
	});

	it("lets an incoming save override a previously stored capability field", () => {
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [{ id: "m1", reasoning: true }],
		});
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [{ id: "m1", reasoning: false }],
		});
		const m = JSON.parse(readFileSync(modelsPath, "utf-8")).providers["custom-local-llm"].models[0];
		expect(m.reasoning).toBe(false);
	});

	// ── image capability (input field) ──────────────────────────────────

	it("persists explicit input (image capability) field on a model", () => {
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [{ id: "vision-model", input: ["text", "image"] }],
		});
		const m = JSON.parse(readFileSync(modelsPath, "utf-8")).providers["custom-local-llm"].models[0];
		expect(m.input).toEqual(["text", "image"]);
	});

	it("defaults to text-only when input is omitted", () => {
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [{ id: "text-only-model" }],
		});
		const m = JSON.parse(readFileSync(modelsPath, "utf-8")).providers["custom-local-llm"].models[0];
		// input is omitted (not written) — the ModelRegistry default handles fallback
		expect(m.input).toBeUndefined();
	});

	it("preserves per-model input capability across a re-save/re-discovery", () => {
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [{ id: "vision-model", input: ["text", "image"] }],
		});
		// Simulate re-discovery with bare id (no input field)
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [{ id: "vision-model" }],
		});
		const m = JSON.parse(readFileSync(modelsPath, "utf-8")).providers["custom-local-llm"].models[0];
		expect(m.input).toEqual(["text", "image"]);
	});

	it("lets an incoming save override a previously stored input field", () => {
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [{ id: "vision-model", input: ["text", "image"] }],
		});
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			models: [{ id: "vision-model", input: ["text"] }],
		});
		const m = JSON.parse(readFileSync(modelsPath, "utf-8")).providers["custom-local-llm"].models[0];
		expect(m.input).toEqual(["text"]);
	});

	// ── validation ─────────────────────────────────────────────────────

	it("rejects an empty id", () => {
		expect(() => saveCustomProvider(modelsPath, { ...VALID_INPUT, id: "" })).toThrow(/id/i);
	});

	it("rejects an empty name", () => {
		expect(() => saveCustomProvider(modelsPath, { ...VALID_INPUT, name: "  " })).toThrow(/name/i);
	});

	it("rejects an empty base URL", () => {
		expect(() => saveCustomProvider(modelsPath, { ...VALID_INPUT, baseUrl: "" })).toThrow(/url/i);
	});

	it("rejects a non-http(s) base URL", () => {
		expect(() => saveCustomProvider(modelsPath, { ...VALID_INPUT, baseUrl: "ftp://nope" })).toThrow(
			/url/i,
		);
	});

	it("rejects an empty models array", () => {
		expect(() => saveCustomProvider(modelsPath, { ...VALID_INPUT, models: [] })).toThrow(/model/i);
	});

	it("rejects a model with an empty id", () => {
		expect(() =>
			saveCustomProvider(modelsPath, { ...VALID_INPUT, models: [{ id: "  " }] }),
		).toThrow(/model/i);
	});

	// ── listCustomProviders ────────────────────────────────────────────

	it("lists saved providers with a masked API-key hint, never the raw key", () => {
		saveCustomProvider(modelsPath, { ...VALID_INPUT, apiKey: "sk-test-abcd1234" });

		const list = listCustomProviders(modelsPath);
		expect(list).toEqual([
			{
				id: "custom-local-llm",
				name: "Custom Local LLM",
				baseUrl: "http://localhost:11434/v1",
				hasApiKey: true,
				apiKeyHint: "…1234",
				models: [{ id: "llama3.1:8b", name: "Llama 3.1 8B (local)" }],
			},
		]);
		// Belt-and-braces: the raw key must never appear in the serialised list.
		expect(JSON.stringify(list)).not.toContain("sk-test-abcd1234");
	});

	it("reports hasApiKey:false when the stored value is the sentinel placeholder", () => {
		saveCustomProvider(modelsPath, VALID_INPUT);

		const list = listCustomProviders(modelsPath);
		expect(list[0]).toMatchObject({ hasApiKey: false });
		expect(list[0]).not.toHaveProperty("apiKeyHint");
	});

	it("returns [] when models.json is missing", () => {
		expect(listCustomProviders(modelsPath)).toEqual([]);
	});

	it("returns [] when models.json has no providers key", () => {
		writeFileSync(modelsPath, JSON.stringify({}));
		expect(listCustomProviders(modelsPath)).toEqual([]);
	});

	it("returns [] when models.json is corrupt JSON (does not throw)", () => {
		writeFileSync(modelsPath, "{ not valid json");
		expect(listCustomProviders(modelsPath)).toEqual([]);
	});

	// Regression (Option A): after Cowork started sharing pi's ~/.pi/agent/
	// models.json, the core Zosma-managed providers (zosmaai, local-qwen,
	// opencode-go) live alongside UI-created ones. They must NOT surface in the
	// "Custom Local LLM" panel — otherwise the user sees undeletable rows and
	// could even delete the Claude provider. Only genuinely-custom entries show.
	it("excludes Zosma-managed core providers (zosmaai, local-qwen, opencode-go)", () => {
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: {
					zosmaai: {
						name: "zosmaai",
						baseUrl: "http://devserver.zosma.ai:8787",
						apiKey: "k",
						api: "anthropic-messages",
						models: [{ id: "claude-opus-4-8", name: "Claude Opus 4.8" }],
					},
					"local-qwen": {
						name: "local-qwen",
						baseUrl: "http://192.168.1.100:8001/v1",
						apiKey: "k",
						api: "openai-completions",
						models: [{ id: "sidecar/Qwen3.5-2B", name: "Qwen 2B" }],
					},
					"opencode-go": {
						name: "opencode-go",
						baseUrl: "https://opencode.ai/zen/go/v1",
						apiKey: "k",
						api: "openai-completions",
						models: [{ id: "deepseek-v4-flash", name: "DeepSeek" }],
					},
				},
			}),
		);
		// Add a genuine UI-created custom provider on top.
		saveCustomProvider(modelsPath, VALID_INPUT);

		const list = listCustomProviders(modelsPath);
		expect(list.map((p) => p.id)).toEqual(["custom-local-llm"]);
	});

	// ── deleteCustomProvider ───────────────────────────────────────────

	it("removes the entry and leaves siblings intact", () => {
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: {
					"keep-me": { baseUrl: "https://example.com/v1", apiKey: "k" },
				},
			}),
		);
		saveCustomProvider(modelsPath, VALID_INPUT);

		deleteCustomProvider(modelsPath, "custom-local-llm");

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(Object.keys(config.providers)).toEqual(["keep-me"]);
	});

	it("is a no-op when the provider id is unknown", () => {
		saveCustomProvider(modelsPath, VALID_INPUT);
		expect(() => deleteCustomProvider(modelsPath, "ghost")).not.toThrow();

		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers["custom-local-llm"]).toBeDefined();
	});

	it("is a no-op when models.json doesn't exist", () => {
		expect(() => deleteCustomProvider(modelsPath, "anything")).not.toThrow();
	});

	// Defense-in-depth: even if some code path passes a reserved id, the core
	// Zosma-managed providers (Claude etc.) must never be removed.
	it("refuses to delete a Zosma-managed core provider", () => {
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: {
					zosmaai: {
						name: "zosmaai",
						baseUrl: "http://devserver.zosma.ai:8787",
						apiKey: "k",
						api: "anthropic-messages",
						models: [{ id: "claude-opus-4-8" }],
					},
				},
			}),
		);
		deleteCustomProvider(modelsPath, "zosmaai");
		const config = JSON.parse(readFileSync(modelsPath, "utf-8"));
		expect(config.providers.zosmaai).toBeDefined();
	});

	// ── ROUND-TRIP with the real pi-coding-agent ModelRegistry ─────────
	//
	// This is the keystone test. If pi-mono can't load what we wrote, the
	// user clicks Save and gets an invisible failure — the dropdown stays
	// empty. We verify against ModelRegistry itself, not a mock.

	it("round-trips: saved models become loadable by pi-coding-agent ModelRegistry", () => {
		saveCustomProvider(modelsPath, {
			...VALID_INPUT,
			apiKey: "sk-test-1234",
			models: [
				{ id: "llama3.1:8b", name: "Llama 3.1 8B (local)", contextWindow: 131072 },
				{ id: "qwen2.5-coder:7b" },
			],
		});

		const authStorage = AuthStorage.create(authPath);
		const registry = ModelRegistry.create(authStorage, modelsPath);

		expect(registry.getError()).toBeUndefined();
		const ours = registry
			.getAll()
			.filter((m) => m.provider === "custom-local-llm")
			.map((m) => ({ id: m.id, name: m.name, baseUrl: m.baseUrl, api: m.api }));
		expect(ours).toEqual([
			{
				id: "llama3.1:8b",
				name: "Llama 3.1 8B (local)",
				baseUrl: "http://localhost:11434/v1",
				api: "openai-completions",
			},
			{
				id: "qwen2.5-coder:7b",
				name: "qwen2.5-coder:7b",
				baseUrl: "http://localhost:11434/v1",
				api: "openai-completions",
			},
		]);
	});

	it("round-trips even with no user-supplied API key (sentinel keeps the validator happy)", () => {
		saveCustomProvider(modelsPath, VALID_INPUT);

		const authStorage = AuthStorage.create(authPath);
		const registry = ModelRegistry.create(authStorage, modelsPath);

		expect(registry.getError()).toBeUndefined();
		expect(registry.getAll().some((m) => m.provider === "custom-local-llm")).toBe(true);
	});
});

// ── discoverModels ────────────────────────────────────────────────────
//
// The new UX collects only a base URL + optional key and asks the server
// which models it serves (OpenAI `GET /v1/models`). These tests stub fetch
// so they never touch the network.

/** Build a minimal Response-like object for the fake fetch. */
function fakeResponse(body: unknown, ok = true): Response {
	return {
		ok,
		json: async () => body,
	} as unknown as Response;
}

describe("modelsEndpoints", () => {
	it("probes /models first when the base URL already ends in /v1", () => {
		expect(modelsEndpoints("http://localhost:11434/v1")).toEqual([
			"http://localhost:11434/v1/models",
		]);
	});

	it("falls back to /v1/models when the base URL has no version suffix", () => {
		expect(modelsEndpoints("http://127.0.0.1:8080")).toEqual([
			"http://127.0.0.1:8080/models",
			"http://127.0.0.1:8080/v1/models",
		]);
	});
});

describe("discoverModels", () => {
	it("returns the ids from an OpenAI { data: [{ id }] } response", async () => {
		const fetchImpl = async () =>
			fakeResponse({ object: "list", data: [{ id: "llama3.1:8b" }, { id: "mistral:7b" }] });
		const res = await discoverModels("http://localhost:11434/v1", undefined, { fetchImpl });
		expect(res).toEqual({
			models: ["llama3.1:8b", "mistral:7b"],
			reachable: true,
			modelCapabilities: {},
		});
	});

	it("accepts a bare array response and dedupes ids", async () => {
		const fetchImpl = async () => fakeResponse([{ id: "a" }, { id: "a" }, { id: "b" }]);
		const res = await discoverModels("http://localhost:11434/v1", undefined, { fetchImpl });
		expect(res.models).toEqual(["a", "b"]);
	});

	it("tries /v1/models after /models 404s for a host-only base URL", async () => {
		const seen: string[] = [];
		const fetchImpl = async (url: string | URL | Request) => {
			const u = String(url);
			seen.push(u);
			if (u.endsWith("/v1/models")) return fakeResponse({ data: [{ id: "phi3" }] });
			return fakeResponse({}, false); // 404 on the bare /models probe
		};
		const res = await discoverModels("http://127.0.0.1:8080", undefined, {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(seen).toEqual(["http://127.0.0.1:8080/models", "http://127.0.0.1:8080/v1/models"]);
		expect(res).toEqual({
			models: ["phi3"],
			reachable: true,
			modelCapabilities: {},
		});
	});

	it("reports reachable:true but no models when every probe 404s", async () => {
		const fetchImpl = async () => fakeResponse({}, false);
		const res = await discoverModels("http://127.0.0.1:8080", undefined, { fetchImpl });
		expect(res).toEqual({ models: [], reachable: true });
	});

	it("reports reachable:false when the server can't be connected to", async () => {
		const fetchImpl = async () => {
			throw new Error("ECONNREFUSED");
		};
		const res = await discoverModels("http://127.0.0.1:8080", undefined, { fetchImpl });
		expect(res).toEqual({ models: [], reachable: false });
	});

	it("sends a Bearer header when an API key is supplied", async () => {
		let authHeader: string | undefined;
		const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
			authHeader = (init?.headers as Record<string, string>)?.Authorization;
			return fakeResponse({ data: [{ id: "x" }] });
		};
		await discoverModels("https://gw.example/v1", "sk-test-1234", {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(authHeader).toBe("Bearer sk-test-1234");
	});

	it("omits the auth header for a blank key or the no-auth sentinel", async () => {
		let authHeader: string | undefined = "set";
		const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
			authHeader = (init?.headers as Record<string, string>)?.Authorization;
			return fakeResponse({ data: [{ id: "x" }] });
		};
		await discoverModels("https://gw.example/v1", "no-auth", {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(authHeader).toBeUndefined();
	});

	it("throws on a malformed base URL (a real validation error, not a network miss)", async () => {
		await expect(discoverModels("not-a-url")).rejects.toThrow(/valid URL/);
	});

	it("parses input capability metadata from response rows", async () => {
		const fetchImpl = async () =>
			fakeResponse({
				data: [
					{ id: "vision-model", input: ["text", "image"] },
					{ id: "text-model", input: ["text"] },
					{ id: "bare-model" },
				],
			});
		const res = await discoverModels("http://localhost:11434/v1", undefined, { fetchImpl });
		expect(res.models).toEqual(["vision-model", "text-model", "bare-model"]);
		expect(res.modelCapabilities).toEqual({
			"vision-model": ["text", "image"],
			"text-model": ["text"],
		});
		// bare-model has no capability metadata → not in modelCapabilities
		expect(res.modelCapabilities!["bare-model"]).toBeUndefined();
	});

	it("parses input_modalities from response rows", async () => {
		const fetchImpl = async () =>
			fakeResponse({
				data: [
					{ id: "vision-model", input_modalities: ["text", "image"] },
					{ id: "text-model", input_modalities: ["text"] },
				],
			});
		const res = await discoverModels("http://localhost:11434/v1", undefined, { fetchImpl });
		expect(res.modelCapabilities).toEqual({
			"vision-model": ["text", "image"],
			"text-model": ["text"],
		});
	});

	it("parses capabilities.image from response rows", async () => {
		const fetchImpl = async () =>
			fakeResponse({
				data: [
					{ id: "vision-model", capabilities: { image: true } },
					{ id: "text-model", capabilities: { image: false } },
				],
			});
		const res = await discoverModels("http://localhost:11434/v1", undefined, { fetchImpl });
		expect(res.modelCapabilities).toEqual({
			"vision-model": ["text", "image"],
		});
	});
});

// ── normalizeModelInput ───────────────────────────────────────────────

describe("normalizeModelInput", () => {
	it("returns input from explicit array", () => {
		expect(normalizeModelInput({ input: ["text", "image"] })).toEqual(["text", "image"]);
	});

	it("returns input from explicit text-only array", () => {
		expect(normalizeModelInput({ input: ["text"] })).toEqual(["text"]);
	});

	it("returns undefined for missing input", () => {
		expect(normalizeModelInput({})).toBeUndefined();
	});

	it("filters invalid values in the input array", () => {
		const result = normalizeModelInput({ input: ["text", "image", "audio"] });
		expect(result).toEqual(["text", "image"]);
	});

	it("parses input_modalities containing image/vision/image_url", () => {
		expect(normalizeModelInput({ input_modalities: ["text", "image"] })).toEqual(["text", "image"]);
		expect(normalizeModelInput({ input_modalities: ["text", "vision"] })).toEqual(["text", "image"]);
		expect(normalizeModelInput({ input_modalities: ["text", "image_url"] })).toEqual(["text", "image"]);
	});

	it("parses input_modalities with text only", () => {
		expect(normalizeModelInput({ input_modalities: ["text"] })).toEqual(["text"]);
	});

	it("parses capabilities.image: true", () => {
		expect(normalizeModelInput({ capabilities: { image: true } })).toEqual(["text", "image"]);
	});

	it("returns undefined for capabilities.image: false", () => {
		expect(normalizeModelInput({ capabilities: { image: false } })).toBeUndefined();
	});

	it("returns undefined for capabilities missing image field", () => {
		expect(normalizeModelInput({ capabilities: {} })).toBeUndefined();
	});
});

// ── resolveModelInput ────────────────────────────────────────────────

describe("resolveModelInput", () => {
	it("returns explicit input when provided", () => {
		expect(resolveModelInput("any-model", ["text", "image"])).toEqual(["text", "image"]);
	});

	it("returns known router vision model from catalog", () => {
		expect(resolveModelInput("gpt-4o", undefined)).toEqual(["text", "image"]);
		expect(resolveModelInput("claude-sonnet-4", undefined)).toEqual(["text", "image"]);
		expect(resolveModelInput("gemini-2.5-pro", undefined)).toEqual(["text", "image"]);
	});

	it("returns text-only for unknown model with no explicit input", () => {
		expect(resolveModelInput("unknown-local-model", undefined)).toEqual(["text"]);
	});

	it("prefers explicit input over known router catalog match", () => {
		expect(resolveModelInput("gpt-4o", ["text"])).toEqual(["text"]);
	});

	it("handles empty input array as no explicit input", () => {
		expect(resolveModelInput("unknown-model", [])).toEqual(["text"]);
	});
});
