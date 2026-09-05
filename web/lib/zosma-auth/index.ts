/**
 * Zosma Router Auth — orchestration.
 *
 * Re-port of agent-sidecar/src/zosma-auth/index.ts (sidecar deleted
 * 2026-08-26). Server-side: the Next.js web server now owns the whole
 * PKCE flow; no sidecar, no Tauri.
 *
 * Task 0 live probe (2026-08-26): production router.zosma.ai is a LiteLLM
 * proxy with NO /v1/cowork/* endpoints (404). The PKCE endpoints live on
 * the dev router (this machine's zosma-router-config.json points at
 * http://localhost:3000). Base URLs are config-driven, so the flow works
 * wherever the endpoints are deployed; authenticateWithKey (Task 7) is the
 * degraded path for endpoint-less environments.
 *
 * Frozen server contract (do not change):
 *   client_id is "zosma-cowork"
 *   POST {authBaseUrl}/v1/cowork/authorizations -> { authorization_url }
 *   POST {authBaseUrl}/v1/cowork/token          -> { access_token }
 *   GET  {authBaseUrl}/v1/models  (Bearer)      -> { data: [rows] }
 *   POST {authBaseUrl}/v1/cowork/revoke (Bearer)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "../models-cache";
import { generateCodeVerifier, generateState, sha256Base64url } from "./crypto";
import { deletePending, loadPending, savePending } from "./state";
import { resolveRouterConfig } from "./router-config";
import { ZOSMA_PROVIDER_ID, deleteProvider, readProviderEntry, restoreProvider, snapshotProvider, upsertProvider } from "./models-json";

export const ZOSMA_CLIENT_ID = "zosma-cowork";
export const DEVICE_ID_FILE = "zosma-device-id.txt";
const TIMEOUT_MS = 10_000;
const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Injectable dependencies. Production wiring comes from productionDeps()
 * (Task 7); tests inject stubs.
 */
export interface ZosmaAuthDeps {
  /** Reload the pi model registry (production: invalidate web models cache). */
  reload: () => Promise<void>;
  /**
   * Models visible in the registry for one provider after reload.
   * Production: fresh ModelRuntime + getProvider(providerId).
   */
  getAvailable: (providerId: string) => Promise<Array<{ id: string; provider: string }>>;
  /** fetch override (tests). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface StartAuthResult {
  authorizationUrl: string;
}

export interface CompleteAuthResult {
  providerId: string;
  selectedModelId: string;
  modelCount: number;
}

export interface ZosmaStatus {
  configured: boolean;
  pending: boolean;
  modelCount: number;
  baseUrl: string | null;
  authBaseUrl: string;
  routerBaseUrl: string;
}

function fetchImpl(deps: ZosmaAuthDeps): typeof globalThis.fetch {
  return deps.fetch ?? globalThis.fetch;
}

/**
 * Load or generate a stable device id. Persists to `<piDir>/zosma-device-id.txt`.
 */
export function loadDeviceId(piDir: string): string {
  const path = join(piDir, DEVICE_ID_FILE);
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf-8").trim();
      if (existing) return existing;
    }
  } catch {
    // Unreadable file — generate a new id below.
  }
  const id = `cowork-${randomBytes(16).toString("hex")}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, id, { mode: 0o600 });
  return id;
}

/**
 * Start the Zosma Router auth flow.
 *
 * 1. Generate state + PKCE code_verifier + S256 challenge
 * 2. Load/generate device id
 * 3. Persist pending transaction BEFORE the network call (crash-safe)
 * 4. POST {auth}/v1/cowork/authorizations
 * 5. Return authorizationUrl for the system browser
 *
 * `redirectUri` (optional): loopback callback URL forwarded to the auth
 * server so browsers can complete the flow over HTTP. Servers that ignore
 * it simply deep-link instead; the manual-paste path always works.
 */
export async function startZosmaAuth(
  piDir: string,
  deps: ZosmaAuthDeps,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts: { redirectUri?: string } = {},
): Promise<StartAuthResult> {
  const config = resolveRouterConfig(piDir);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = sha256Base64url(codeVerifier);
  const deviceId = loadDeviceId(piDir);

  savePending(
    { state, codeVerifier, deviceId, expiresAt: Date.now() + PENDING_TTL_MS },
    piDir,
  );

  const body: Record<string, unknown> = {
    client_id: ZOSMA_CLIENT_ID,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    device_id: deviceId,
  };
  const res = await fetchImpl(deps)(`${config.authBaseUrl}/v1/cowork/authorizations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    deletePending(piDir);
    throw new Error(`Auth server returned ${res.status}`);
  }

  const parsed = (await res.json()) as { authorization_url?: string };
  if (!parsed.authorization_url) {
    deletePending(piDir);
    throw new Error("Auth server returned missing authorization_url");
  }
  return { authorizationUrl: parsed.authorization_url };
}

/**
 * Default piDir for route handlers.
 */
export function zosmaPiDir(): string {
  return getAgentDir();
}

// Facade re-export (routes import config ops from @/lib/zosma-auth).
export { saveRouterConfig } from "./router-config";

type ModelInput = "text" | "image";

interface MappedModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning: boolean;
  input?: ModelInput[];
}

/**
 * Map router model row input capabilities to pi's `input` shape.
 */
function mapInputCapability(row: Record<string, unknown>): ModelInput[] | undefined {
  if (Array.isArray(row.input)) {
    const filtered = row.input.filter(
      (v: unknown): v is ModelInput => v === "text" || v === "image",
    );
    if (filtered.length > 0) return filtered;
  }
  if (Array.isArray(row.input_modalities)) {
    const hasImage = row.input_modalities.some(
      (m: unknown) =>
        typeof m === "string" && (m === "image" || m === "vision" || m === "image_url"),
    );
    return hasImage ? ["text", "image"] : ["text"];
  }
  return undefined;
}

function mapCatalogRows(rows: Array<Record<string, unknown>>): MappedModel[] {
  return rows.map((r) => ({
    id: String(r.id),
    name: r.display_name ? String(r.display_name) : String(r.id),
    contextWindow:
      typeof r.context_window === "number"
        ? r.context_window
        : typeof r.contextWindow === "number"
          ? r.contextWindow
          : undefined,
    maxTokens:
      typeof r.max_tokens === "number"
        ? r.max_tokens
        : typeof r.maxTokens === "number"
          ? r.maxTokens
          : undefined,
    reasoning: Boolean(r.reasoning),
    input: mapInputCapability(r),
  }));
}

/**
 * Shared save → reload → verify → rollback tail, used by completeZosmaAuth
 * here and by refreshZosmaModels / authenticateWithKey (Task 7).
 */
async function saveCatalogAndVerify(
  models: MappedModel[],
  apiKey: string,
  piDir: string,
  deps: ZosmaAuthDeps,
  name: string,
  api: string,
): Promise<CompleteAuthResult> {
  const config = resolveRouterConfig(piDir);
  const modelsPath = join(piDir, "models.json");
  const prior = snapshotProvider(modelsPath, ZOSMA_PROVIDER_ID);
  try {
    upsertProvider(modelsPath, ZOSMA_PROVIDER_ID, {
      id: ZOSMA_PROVIDER_ID,
      name,
      baseUrl: config.routerBaseUrl,
      apiKey,
      api,
      models: models.map((m) => ({ ...m })),
    });
    await deps.reload();
    const available = await deps.getAvailable(ZOSMA_PROVIDER_ID);
    const registered = new Set(available.map((m) => m.id));
    for (const m of models) {
      if (!registered.has(m.id)) {
        throw new Error(`model ${m.id} not found in registry after reload`);
      }
    }
  } catch (err) {
    restoreProvider(modelsPath, ZOSMA_PROVIDER_ID, prior);
    try {
      await deps.reload();
    } catch {
      // Re-init after rollback failed — leave it, the user can retry.
    }
    throw err;
  }
  return {
    providerId: ZOSMA_PROVIDER_ID,
    selectedModelId: models[0].id,
    modelCount: models.length,
  };
}

/**
 * Complete the Zosma Router auth flow after the browser returns code+state.
 *
 * 1. Validate inputs
 * 2. Load pending tx, verify state match
 * 3. Exchange code + PKCE verifier for the router key
 * 4. Fetch the authenticated model catalog
 * 5. Map rows to the pi model shape
 * 6. Save + reload + verify (+ rollback) via saveCatalogAndVerify
 * 7. Delete pending tx
 */
export async function completeZosmaAuth(
  code: string,
  state: string,
  piDir: string,
  deps: ZosmaAuthDeps,
): Promise<CompleteAuthResult> {
  const config = resolveRouterConfig(piDir);

  if (!code || !state) throw new Error("missing code or state");

  const tx = loadPending(piDir);
  if (!tx) throw new Error("no pending auth transaction (expired or never started)");
  if (tx.state !== state) {
    deletePending(piDir);
    throw new Error("state mismatch — possible CSRF");
  }

  const tokenRes = await fetchImpl(deps)(`${config.authBaseUrl}/v1/cowork/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: ZOSMA_CLIENT_ID,
      code,
      code_verifier: tx.codeVerifier,
      device_id: tx.deviceId,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!tokenRes.ok) {
    deletePending(piDir);
    const msg =
      tokenRes.status === 401
        ? "code expired or already used"
        : `token exchange returned ${tokenRes.status}`;
    throw new Error(msg);
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  const routerKey = tokenBody.access_token;
  if (!routerKey) {
    deletePending(piDir);
    throw new Error("token response missing access_token");
  }

  const modelsRes = await fetchImpl(deps)(`${config.authBaseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${routerKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!modelsRes.ok) {
    deletePending(piDir);
    throw new Error(`model catalog returned ${modelsRes.status}`);
  }

  const catalogBody = (await modelsRes.json()) as { data?: unknown[] };
  const rows = (catalogBody.data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    deletePending(piDir);
    throw new Error("no models entitled for this account");
  }

  const models = mapCatalogRows(rows);
  const result = await saveCatalogAndVerify(models, routerKey, piDir, deps, "Zosma AI", "openai-completions");
  deletePending(piDir);
  return result;
}

/**
 * Test seam: route unit tests override production deps (ModelRuntime +
 * network) without touching the real agent dir. Production code never
 * sets this global.
 */
declare global {
  var __zosmaAuthDepsForTests: ZosmaAuthDeps | undefined;
}

/**
 * Production dependency wiring: web models-cache invalidation + live
 * ModelRuntime reads.
 */
export function productionDeps(): ZosmaAuthDeps {
  return {
    reload: async () => {
      invalidateModelsCache();
    },
    getAvailable: async (providerId) => {
      const runtime = await ModelRuntime.create();
      const provider = runtime.getProvider(providerId);
      if (!provider) return [];
      // Probed 2026-08-26: provider exposes getModels(), not a models array.
      const models = provider.getModels?.() ?? [];
      return models.map((m) => ({ id: m.id, provider: providerId }));
    },
  };
}

/**
 * Deps to use at runtime: test override if present, else production.
 */
export function resolveDeps(): ZosmaAuthDeps {
  return globalThis.__zosmaAuthDepsForTests ?? productionDeps();
}

/**
 * Disconnect: best-effort server-side revoke, local provider removal, reload.
 * Revoke failures never block the local disconnect.
 */
export async function disconnectZosmaAuth(piDir: string, deps: ZosmaAuthDeps): Promise<void> {
  const config = resolveRouterConfig(piDir);
  const modelsPath = join(piDir, "models.json");
  const provider = readProviderEntry(modelsPath, ZOSMA_PROVIDER_ID);

  if (provider?.apiKey) {
    try {
      const res = await fetchImpl(deps)(`${config.authBaseUrl}/v1/cowork/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`[zosma-auth] server revoke returned ${res.status}; proceeding locally`);
      }
    } catch {
      console.warn("[zosma-auth] server revoke failed; proceeding locally");
    }
  }

  deleteProvider(modelsPath, ZOSMA_PROVIDER_ID);
  await deps.reload();
}

/**
 * Cancel an in-progress flow: deletes the pending PKCE transaction only.
 * Never touches the configured provider.
 */
export async function cancelZosmaAuth(piDir: string): Promise<void> {
  deletePending(piDir);
}

/**
 * Refresh the model catalog with the existing key (no key rotation).
 */
export async function refreshZosmaModels(
  piDir: string,
  deps: ZosmaAuthDeps,
): Promise<{ modelCount: number; selectedModelId: string }> {
  const config = resolveRouterConfig(piDir);
  const modelsPath = join(piDir, "models.json");
  const provider = readProviderEntry(modelsPath, ZOSMA_PROVIDER_ID);
  if (!provider?.apiKey) throw new Error("Zosma Router is not configured");

  const modelsRes = await fetchImpl(deps)(`${config.authBaseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!modelsRes.ok) throw new Error(`model catalog returned ${modelsRes.status}`);

  const catalogBody = (await modelsRes.json()) as { data?: unknown[] };
  const rows = (catalogBody.data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) throw new Error("no models entitled for this account");

  const models = mapCatalogRows(rows);
  const result = await saveCatalogAndVerify(
    models,
    provider.apiKey,
    piDir,
    deps,
    provider.name ?? "Zosma AI",
    provider.api ?? "openai-completions",
  );
  return { modelCount: result.modelCount, selectedModelId: result.selectedModelId };
}

/**
 * Degraded sign-in for environments where the PKCE endpoints are not
 * deployed (Task 0 finding: production LiteLLM proxy has no /v1/cowork/*):
 * take a router key directly, fetch the catalog with it, save + verify.
 */
export async function authenticateWithKey(
  apiKey: string,
  piDir: string,
  deps: ZosmaAuthDeps,
): Promise<CompleteAuthResult> {
  const config = resolveRouterConfig(piDir);
  const key = apiKey.trim();
  if (!key) throw new Error("missing API key");

  // Manual key is a raw router key (sk-...), so validate against the router (LiteLLM) host.
  // The auth host's /v1/models only accepts cowork device keys and returns device_key_invalid for raw keys.
  const modelsRes = await fetchImpl(deps)(`${config.routerBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!modelsRes.ok) throw new Error(`model catalog returned ${modelsRes.status}`);

  const catalogBody = (await modelsRes.json()) as { data?: unknown[] };
  const rows = (catalogBody.data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) throw new Error("no models entitled for this account");

  const models = mapCatalogRows(rows);
  const existing = readProviderEntry(join(piDir, "models.json"), ZOSMA_PROVIDER_ID);
  return saveCatalogAndVerify(
    models,
    key,
    piDir,
    deps,
    existing?.name ?? "Zosma AI",
    existing?.api ?? "openai-completions",
  );
}

/**
 * Read-only status for the UI: is the provider configured, is a sign-in
 * in flight, how many models, which base URLs are effective.
 */
export function getZosmaStatus(piDir: string): ZosmaStatus {
  const config = resolveRouterConfig(piDir);
  const provider = readProviderEntry(join(piDir, "models.json"), ZOSMA_PROVIDER_ID);
  return {
    configured: Boolean(provider),
    pending: Boolean(loadPending(piDir)),
    modelCount: provider?.models?.length ?? 0,
    baseUrl: provider?.baseUrl ?? null,
    authBaseUrl: config.authBaseUrl,
    routerBaseUrl: config.routerBaseUrl,
  };
}
