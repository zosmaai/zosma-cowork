/**
 * Custom OpenAI-compatible provider store (issue #207).
 *
 * The Authentication UI used to offer subscriptions (Claude/Copilot/Codex)
 * and API keys for pi-mono's ~30 built-in providers, but never a "point me
 * at my local server" path. pi-mono already speaks the OpenAI Chat
 * Completions wire protocol against any `baseUrl`, exposed through its
 * `ModelRegistry` via `models.json`'s `providers.<id>` map. This module is
 * the thin upsert/list/delete layer the sidecar exposes to the UI.
 *
 * Why the `NO_AUTH_SENTINEL` placeholder: pi-coding-agent's
 * `ModelRegistry.validateConfig` requires a non-empty `apiKey` for any
 * non-built-in provider that ships custom models, even though local
 * inference servers (Ollama, LM Studio, llama.cpp `--server`,
 * text-generation-webui) ignore the Authorization header. Storing a
 * sentinel keeps the validator happy without making the user invent a
 * fake key in the UI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Sentinel stored when the user leaves the API-key field blank. See header. */
export const NO_AUTH_SENTINEL = "no-auth";

/**
 * Zosma-managed provider ids that live in the shared ~/.pi/agent/models.json
 * but are NOT user-created via the Cowork "Custom Local LLM" UI.
 *
 * Since Option A (Cowork shares pi's models.json instead of a private copy),
 * these core providers sit alongside genuinely-custom entries. They must be
 * excluded from listCustomProviders so the settings panel only shows — and
 * only lets the user delete — providers they themselves added. Without this
 * guard the panel renders undeletable-looking rows and could even let the
 * user remove the Claude (zosmaai) provider. See Option A migration.
 */
export const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set([
	"zosmaai",
	"local-qwen",
	"opencode-go",
]);

/** Input shape the sidecar accepts from the Tauri layer. */
export interface SaveCustomProviderInput {
	/** Slug used as the providers map key (e.g. "custom-local-llm"). */
	id: string;
	/** Human-friendly label shown in the model selector. */
	name: string;
	/** OpenAI-compatible base URL, e.g. "http://localhost:11434/v1". */
	baseUrl: string;
	/** Optional. Omit or empty → stored as the NO_AUTH_SENTINEL. */
	apiKey?: string;
	/** At least one entry; each needs a non-empty id. */
	models: Array<{
		id: string;
		name?: string;
		contextWindow?: number;
		maxTokens?: number;
		/**
		 * Whether this model supports reasoning/"thinking". Drives the SDK's
		 * supportsThinking() and the status-line pill. Optional — auto-discovery
		 * can't detect it (the OpenAI-completions API exposes no capability
		 * probe), so it's only set explicitly and then preserved across re-saves.
		 */
		reasoning?: boolean;
		/**
		 * Curates pi's abstract reasoning ladder to what the model truly supports.
		 * A `null` value removes that level; a string remaps it to the provider's
		 * own value. e.g. `{minimal:null,low:null,medium:null,xhigh:null}` =>
		 * an honest binary off/on toggle.
		 */
		thinkingLevelMap?: Record<string, string | null>;
		/** Wire-format quirks (e.g. `{thinkingFormat:"qwen-chat-template"}`). */
		compat?: Record<string, unknown>;
	}>;
}

/**
 * Per-model fields the UI's discovery/manual save path doesn't supply but that
 * encode real capability. We preserve these across re-saves so a hand-tuned
 * (or future UI-set) reasoning configuration isn't silently clobbered when the
 * model list is re-discovered from the server. See saveCustomProvider().
 */
const PRESERVED_MODEL_FIELDS = [
	"reasoning",
	"thinkingLevelMap",
	"compat",
	"contextWindow",
	"maxTokens",
] as const;

/** Outward-facing summary — never leaks the raw API key. */
export interface CustomProviderSummary {
	id: string;
	name: string;
	baseUrl: string;
	hasApiKey: boolean;
	/** Last 4 chars only, shown like "…abcd". Only present when hasApiKey. */
	apiKeyHint?: string;
	models: Array<{ id: string; name: string }>;
}

// ─── internal helpers ──────────────────────────────────────────────────

type ProvidersMap = Record<string, Record<string, unknown>>;
type ModelsConfig = { providers: ProvidersMap };

function readConfig(modelsPath: string): ModelsConfig {
	if (!existsSync(modelsPath)) return { providers: {} };
	try {
		const raw = JSON.parse(readFileSync(modelsPath, "utf-8"));
		if (!raw || typeof raw !== "object") return { providers: {} };
		const providers =
			raw.providers && typeof raw.providers === "object" && !Array.isArray(raw.providers)
				? (raw.providers as ProvidersMap)
				: {};
		return { ...raw, providers };
	} catch {
		// Corrupt JSON: pretend the file is empty. Caller's save will replace it.
		return { providers: {} };
	}
}

function writeConfig(modelsPath: string, config: ModelsConfig): void {
	mkdirSync(dirname(modelsPath), { recursive: true });
	writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function require_(field: string, value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Custom provider: "${field}" is required`);
	}
	return value.trim();
}

function normaliseBaseUrl(raw: string): string {
	const trimmed = require_("baseUrl", raw);
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error('Custom provider: "baseUrl" must be a valid URL');
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error('Custom provider: "baseUrl" must use http(s)');
	}
	// pi-ai appends the path component itself, so strip the trailing slash.
	return trimmed.replace(/\/+$/, "");
}

/**
 * OpenAI-compatible model-list endpoints to probe, in priority order.
 *
 * Users may enter the base URL with or without the `/v1` suffix. pi-ai itself
 * appends the wire path, so the stored baseUrl can be either form. For
 * discovery we try `{base}/models` first (correct when the URL already ends
 * in `/v1`), then `{base}/v1/models` (correct when they typed just the host).
 */
export function modelsEndpoints(baseUrl: string): string[] {
	const base = baseUrl.replace(/\/+$/, "");
	const urls = [`${base}/models`];
	if (!/\/v\d+$/.test(base)) urls.push(`${base}/v1/models`);
	return [...new Set(urls)];
}

/** Result of probing a server's OpenAI-compatible `/models` endpoint. */
export interface DiscoverModelsResult {
	/** Deduped model ids reported by the server (empty when none found). */
	models: string[];
	/**
	 * True once *any* probe connected to the server — even a 404. Lets the UI
	 * tell "endpoint reachable but exposes no /models" (→ offer manual entry)
	 * apart from "couldn't connect at all" (→ likely a wrong URL).
	 */
	reachable: boolean;
	/**
	 * The HTTP status of the last probe response, when one was received.
	 * Helps distinguish auth failures (401) from missing endpoints (404).
	 */
	status?: number;
}

/**
 * Probe an OpenAI-compatible server for the models it serves. Used by the
 * save flow so the user supplies only a base URL + optional key and we fill
 * in the model list automatically (Ollama, LM Studio, vLLM, llama.cpp all
 * implement `GET /v1/models`).
 *
 * Network failures are swallowed into `{ models: [], reachable }` so the
 * caller can offer a manual-entry fallback; only a malformed base URL throws.
 */
export async function discoverModels(
	baseUrl: string,
	apiKey?: string,
	opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<DiscoverModelsResult> {
	const base = normaliseBaseUrl(baseUrl); // throws on invalid/non-http(s) URL
	const doFetch = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? 8000;
	const headers: Record<string, string> = { Accept: "application/json" };
	if (apiKey && apiKey !== NO_AUTH_SENTINEL && apiKey.trim().length > 0) {
		headers.Authorization = `Bearer ${apiKey.trim()}`;
	}

	let reachable = false;
	let lastStatus: number | undefined;
	for (const url of modelsEndpoints(base)) {
		try {
			const res = await doFetch(url, {
				headers,
				signal: AbortSignal.timeout(timeoutMs),
			});
			reachable = true; // we connected, regardless of status
			lastStatus = res.status;
			if (!res.ok) continue;
			const json: unknown = await res.json();
			// OpenAI shape: { object: "list", data: [{ id }] }. Some servers
			// return a bare array. Accept both; ignore entries without a string id.
			const rows = Array.isArray(json)
				? json
				: Array.isArray((json as { data?: unknown })?.data)
					? (json as { data: unknown[] }).data
					: [];
			const ids = rows
				.map((r) => (r && typeof (r as { id?: unknown }).id === "string" ? (r as { id: string }).id : null))
				.filter((id): id is string => id !== null && id.trim().length > 0);
			if (ids.length > 0) return { models: [...new Set(ids)], reachable: true, status: lastStatus };
		} catch {
			// Connection refused / DNS / timeout / bad JSON — try the next URL.
		}
	}
	return { models: [], reachable, status: lastStatus };
}

function validateInput(input: SaveCustomProviderInput): {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	models: Array<{
		id: string;
		name: string;
		contextWindow?: number;
		maxTokens?: number;
		reasoning?: boolean;
		thinkingLevelMap?: Record<string, string | null>;
		compat?: Record<string, unknown>;
	}>;
} {
	const id = require_("id", input.id);
	const name = require_("name", input.name);
	const baseUrl = normaliseBaseUrl(input.baseUrl);

	if (!Array.isArray(input.models) || input.models.length === 0) {
		throw new Error("Custom provider: at least one model is required");
	}
	const models = input.models.map((m, i) => {
		const modelId = require_(`models[${i}].id`, m?.id);
		return {
			id: modelId,
			name: m.name && m.name.trim().length > 0 ? m.name.trim() : modelId,
			...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
			...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
			...(m.reasoning !== undefined ? { reasoning: m.reasoning } : {}),
			...(m.thinkingLevelMap !== undefined ? { thinkingLevelMap: m.thinkingLevelMap } : {}),
			...(m.compat !== undefined ? { compat: m.compat } : {}),
		};
	});

	const apiKey =
		typeof input.apiKey === "string" && input.apiKey.trim().length > 0
			? input.apiKey.trim()
			: NO_AUTH_SENTINEL;

	return { id, name, baseUrl, apiKey, models };
}

// ─── public API ────────────────────────────────────────────────────────

/** Upsert a custom provider into models.json. Throws on invalid input. */
export function saveCustomProvider(modelsPath: string, input: SaveCustomProviderInput): void {
	const v = validateInput(input);
	const config = readConfig(modelsPath);
	// Edit flow: the raw API key never round-trips to the UI, so a blank key
	// field (→ NO_AUTH_SENTINEL here) on an *existing* provider means "keep the
	// current key", not "clear it". Preserve a previously stored real key so
	// editing the base URL or model id doesn't silently drop auth. To switch a
	// keyed provider back to keyless, delete and re-create it.
	const prev = config.providers[v.id];
	let apiKey = v.apiKey;
	if (apiKey === NO_AUTH_SENTINEL) {
		const prevKey = prev && typeof prev.apiKey === "string" ? prev.apiKey : "";
		if (prevKey && prevKey !== NO_AUTH_SENTINEL) {
			apiKey = prevKey;
		}
	}

	// Re-saves (model re-discovery, base-URL edits, manual entry) replace the
	// model list. Auto-discovery only knows each model's id — it can't detect
	// reasoning support or wire-format quirks — so blindly overwriting would
	// wipe any capability a user (or a future capability editor) configured.
	// Merge by id: incoming wins where it sets a field; otherwise keep the
	// previously stored capability fields (and a non-id display name).
	const prevById = new Map<string, Record<string, unknown>>();
	const prevModels =
		prev && Array.isArray((prev as { models?: unknown }).models)
			? (prev as { models: unknown[] }).models
			: [];
	for (const pm of prevModels) {
		if (pm && typeof pm === "object" && typeof (pm as { id?: unknown }).id === "string") {
			prevById.set((pm as { id: string }).id, pm as Record<string, unknown>);
		}
	}
	const models = v.models.map((m) => {
		const prevM = prevById.get(m.id);
		if (!prevM) return m;
		const merged: Record<string, unknown> = { ...m };
		for (const k of PRESERVED_MODEL_FIELDS) {
			if (merged[k] === undefined && prevM[k] !== undefined) merged[k] = prevM[k];
		}
		// Discovery supplies only the id (name defaults to the id). Keep a
		// previously chosen friendly name rather than resetting it.
		if (
			merged.name === m.id &&
			typeof prevM.name === "string" &&
			prevM.name.trim() &&
			prevM.name !== m.id
		) {
			merged.name = prevM.name;
		}
		return merged;
	});

	config.providers[v.id] = {
		name: v.name,
		baseUrl: v.baseUrl,
		apiKey,
		api: "openai-completions",
		models,
	};
	writeConfig(modelsPath, config);
}

/** Remove a provider entry. No-op when missing. */
export function deleteCustomProvider(modelsPath: string, providerId: string): void {
	if (!existsSync(modelsPath)) return;
	// Never remove a Zosma-managed core provider (Claude, local-qwen, …), even
	// if a stale build or bad RPC asks us to. See RESERVED_PROVIDER_IDS.
	if (RESERVED_PROVIDER_IDS.has(providerId)) return;
	const config = readConfig(modelsPath);
	if (!(providerId in config.providers)) return;
	delete config.providers[providerId];
	writeConfig(modelsPath, config);
}

/** List user-added providers (those carrying our own canonical shape). */
export function listCustomProviders(modelsPath: string): CustomProviderSummary[] {
	const config = readConfig(modelsPath);
	const out: CustomProviderSummary[] = [];
	for (const [id, raw] of Object.entries(config.providers)) {
		// Skip Zosma-managed core providers that live in the shared models.json
		// but were not created via the Cowork UI (see RESERVED_PROVIDER_IDS).
		if (RESERVED_PROVIDER_IDS.has(id)) continue;
		// Be defensive: we only own entries that look like our shape (baseUrl +
		// models array). pi-mono allows override-only entries against built-in
		// providers — we deliberately skip those so the UI doesn't try to edit
		// them.
		if (typeof raw !== "object" || raw === null) continue;
		const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl : "";
		const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : id;
		const rawModels = Array.isArray(raw.models) ? raw.models : [];
		if (!baseUrl || rawModels.length === 0) continue;

		const apiKey = typeof raw.apiKey === "string" ? raw.apiKey : "";
		const hasApiKey = apiKey.length > 0 && apiKey !== NO_AUTH_SENTINEL;

		const summary: CustomProviderSummary = {
			id,
			name,
			baseUrl,
			hasApiKey,
			models: rawModels
				.filter(
					(m): m is { id: string; name?: string } =>
						typeof m === "object" && m !== null && typeof (m as { id: unknown }).id === "string",
				)
				.map((m) => ({ id: m.id, name: m.name && m.name.trim() ? m.name : m.id })),
		};
		if (hasApiKey) {
			summary.apiKeyHint = `…${apiKey.slice(-4)}`;
		}
		out.push(summary);
	}
	return out;
}
