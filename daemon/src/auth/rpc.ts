// Auth ops (roadmap item 6 end-to-end): the web tier's ModelRuntime usage —
// provider listing, auth status, API-key login, logout, the interactive OAuth
// login, and model-discovery auth resolution — moves here. The daemon owns
// auth.json writes (same proper-lockfile protocol as pi's AuthStorage) and
// runs ModelRuntime; a login session registry bridges the interactive
// prompt/notify flow across IPC (web SSE route polls auth:login-status and
// relays client codes via auth:login-callback).
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeSimple, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { invalidateModelsCache } from "../read/models.ts";
import { okResult, errResult } from "../read/rpc.ts";
import {
  removeStoredCredentialIfType,
  storeProviderCredential,
} from "./credential-store.ts";

export const AUTH_RPC_OPS = [
  "auth:provider-listing",
  "auth:api-key-status",
  "auth:api-key-login",
  "auth:remove-api-key",
  "auth:logout",
  "auth:login-start",
  "auth:login-status",
  "auth:login-callback",
  "auth:login-cancel",
  "auth:provider-models",
  "auth:resolve-discovery",
  "auth:test-model",
] as const;

export type AuthRpcOp = (typeof AUTH_RPC_OPS)[number];

export interface AuthRpcRequest {
  type: AuthRpcOp;
  provider?: string;
  providerId?: string;
  apiKey?: string;
  authId?: string;
  token?: string;
  code?: string;
  providerName?: string;
  providerConfig?: Record<string, unknown>;
  modelConfig?: Record<string, unknown>;
}

export type AuthRpcResult = import("../pi/rpc.ts").IpcResult;

// --- Login session registry (interactive OAuth across IPC) ---

interface PendingPrompt {
  token: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  promise: Promise<string>;
}

interface LoginSession {
  provider: string;
  events: Array<Record<string, unknown>>;
  prompts: Map<string, PendingPrompt>;
  abort: AbortController;
  done: boolean;
  ok: boolean;
  error: string | null;
  task: Promise<void>;
}

const loginSessions = new Map<string, LoginSession>();

function createPendingPrompt(session: LoginSession, provider: string): PendingPrompt {
  const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = (value) => {
      session.prompts.delete(token);
      res(value);
    };
    reject = (error) => {
      session.prompts.delete(token);
      rej(error);
    };
  });
  session.prompts.set(token, { token, resolve, reject, promise });
  return { token, resolve, reject, promise };
}

function rejectAllPrompts(session: LoginSession): void {
  for (const prompt of session.prompts.values()) prompt.reject(new Error("Login finished"));
  session.prompts.clear();
}

function startLoginSession(provider: string): { authId: string; session: LoginSession } {
  const authId = randomUUID();
  const session: LoginSession = {
    provider,
    events: [],
    prompts: new Map(),
    abort: new AbortController(),
    done: false,
    ok: false,
    error: null,
    task: Promise.resolve(),
  };
  loginSessions.set(authId, session);

  session.task = (async () => {
    const modelRuntime = await ModelRuntime.create();
    if (!modelRuntime.getProvider(provider)?.auth.oauth) {
      session.events.push({ type: "error", message: `Unknown provider: ${provider}` });
      finishLoginSession(session);
      return;
    }

    const signal = session.abort.signal;
    try {
      await modelRuntime.login(provider, "oauth", {
        prompt: async (prompt) => {
          const request = createPendingPrompt(session, provider);
          if (prompt.type === "select") {
            session.events.push({
              type: "select_request",
              message: prompt.message,
              options: prompt.options,
              token: request.token,
            });
          } else {
            session.events.push({
              type: "prompt_request",
              message: prompt.message,
              placeholder: prompt.placeholder ?? null,
              token: request.token,
            });
          }
          return request.promise;
        },
        notify: (event) => {
          if (event.type === "auth_url") {
            const request = createPendingPrompt(session, provider);
            session.events.push({
              type: "auth",
              url: event.url,
              instructions: event.instructions ?? null,
              token: request.token,
            });
          } else if (event.type === "device_code") {
            session.events.push({
              type: "device_code",
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              intervalSeconds: event.intervalSeconds ?? null,
              expiresInSeconds: event.expiresInSeconds ?? null,
            });
          } else {
            session.events.push({ type: "progress", message: event.message });
          }
        },
        signal,
      });
      invalidateModelsCache();
      session.ok = true;
      session.events.push({ type: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "Login cancelled" && !signal.aborted) {
        session.error = msg;
        session.events.push({ type: "error", message: msg });
      } else {
        session.events.push({ type: "cancelled" });
      }
    } finally {
      finishLoginSession(session);
    }
  })();
  return { authId, session };
}

function finishLoginSession(session: LoginSession): void {
  session.done = true;
  rejectAllPrompts(session);
}

// --- Handlers ---

async function collectProviderListingInputs(
  modelRuntime: ModelRuntime,
): Promise<Array<Record<string, unknown>>> {
  const models = modelRuntime.getModels();
  const credentialTypes = new Map<string, string>();
  try {
    for (const credential of await modelRuntime.listCredentials()) {
      if (credential.type === "api_key" || credential.type === "oauth") {
        credentialTypes.set(credential.providerId, credential.type);
      }
    }
  } catch {
    // A damaged auth.json must not empty the provider list; fall back to the
    // per-provider auth status only.
  }

  return modelRuntime.getProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    hasApiKeyLogin: Boolean(provider.auth.apiKey?.login),
    hasOAuth: Boolean(provider.auth.oauth),
    ...(provider.auth.oauth?.name ? { oauthName: provider.auth.oauth.name } : {}),
    status: modelRuntime.getProviderAuthStatus(provider.id),
    ...(credentialTypes.has(provider.id)
      ? { credentialType: credentialTypes.get(provider.id) }
      : {}),
    modelCount: models.filter((model) => model.provider === provider.id).length,
  }));
}

export async function handleAuthRpc(request: AuthRpcRequest): Promise<AuthRpcResult> {
  switch (request.type) {
    case "auth:provider-listing": {
      const modelRuntime = await ModelRuntime.create();
      return okResult(await collectProviderListingInputs(modelRuntime));
    }

    case "auth:api-key-status": {
      if (!request.provider) return errResult("invalid_request", "provider is required");
      const modelRuntime = await ModelRuntime.create();
      const status = modelRuntime.getProviderAuthStatus(request.provider);
      const displayName = modelRuntime.getProvider(request.provider)?.name ?? request.provider;
      const models = modelRuntime.getModels(request.provider).length;
      return okResult({
        provider: request.provider,
        displayName,
        configured: status.configured,
        source: status.source,
        models,
      });
    }

    case "auth:api-key-login": {
      const { provider, apiKey } = request;
      if (!provider) return errResult("invalid_request", "provider is required");
      if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
        return errResult("invalid_request", "apiKey is required");
      }
      const modelRuntime = await ModelRuntime.create();
      const apiKeyAuth = modelRuntime.getProvider(provider)?.auth.apiKey;
      if (!apiKeyAuth?.login) {
        return errResult("invalid_request", `${provider} does not support API key login`);
      }
      let keySubmitted = false;
      try {
        const credential = await apiKeyAuth.login({
          signal: new AbortController().signal,
          notify: () => {},
          prompt: async (prompt) => {
            if (prompt.type === "select") {
              const keyOption = prompt.options.find(
                (option) => option.id === "api-key" || option.id === "bearer-token",
              );
              if (keyOption) return keyOption.id;
              throw new Error(`${provider} requires interactive authentication setup`);
            }
            if (!keySubmitted && prompt.type === "secret") {
              keySubmitted = true;
              return apiKey.trim();
            }
            throw new Error(`${provider} requires additional authentication settings`);
          },
        });
        await storeProviderCredential(provider, credential);
      } catch (e) {
        return errResult(
          "auth_failed",
          e instanceof Error ? e.message : String(e),
        );
      }
      invalidateModelsCache();
      return okResult({ success: true });
    }

    case "auth:remove-api-key": {
      if (!request.provider) return errResult("invalid_request", "provider is required");
      const removal = await removeStoredCredentialIfType(request.provider, "api_key");
      if (removal.status === "type_mismatch") {
        return errResult(
          "type_mismatch",
          `${request.provider} is authenticated with OAuth, not an API key`,
          409,
        );
      }
      invalidateModelsCache();
      return okResult({ success: true });
    }

    case "auth:logout": {
      if (!request.provider) return errResult("invalid_request", "provider is required");
      const modelRuntime = await ModelRuntime.create();
      if (!modelRuntime.getProvider(request.provider)?.auth.oauth) {
        return errResult("invalid_request", `Unknown provider: ${request.provider}`);
      }
      const removal = await removeStoredCredentialIfType(request.provider, "oauth");
      if (removal.status === "type_mismatch") {
        return errResult(
          "type_mismatch",
          `${request.provider} is authenticated with an API key, not OAuth`,
          409,
        );
      }
      invalidateModelsCache();
      return okResult({ ok: true });
    }

    case "auth:login-start": {
      if (!request.provider) return errResult("invalid_request", "provider is required");
      const { authId } = startLoginSession(request.provider);
      return okResult({ authId, events: [] });
    }

    case "auth:login-status": {
      if (!request.authId) return errResult("invalid_request", "authId is required");
      const session = loginSessions.get(request.authId);
      if (!session) return errResult("not_found", "No pending login for authId", 404);
      const events = session.events.splice(0);
      const result = {
        events,
        done: session.done,
        ok: session.ok,
        ...(session.error ? { error: session.error } : {}),
      };
      if (session.done) loginSessions.delete(request.authId);
      return okResult(result);
    }

    case "auth:login-callback": {
      const { authId, token, code } = request;
      if (!authId || !token || !code) {
        return errResult("invalid_request", "authId, token and code are required");
      }
      const session = loginSessions.get(authId);
      if (!session) return errResult("not_found", "No pending login for authId", 404);
      const prompt = session.prompts.get(token);
      if (!prompt) return errResult("not_found", "No pending login for token", 404);
      prompt.resolve(code);
      return okResult({ ok: true, provider: session.provider });
    }

    case "auth:login-cancel": {
      if (!request.authId) return errResult("invalid_request", "authId is required");
      const session = loginSessions.get(request.authId);
      if (!session) return okResult({ ok: true });
      session.abort.abort();
      return okResult({ ok: true });
    }

    case "auth:provider-models": {
      if (!request.providerId) return errResult("invalid_request", "providerId is required");
      const modelRuntime = await ModelRuntime.create();
      const provider = modelRuntime.getProvider(request.providerId);
      if (!provider) return okResult({ models: [] });
      const models = provider.getModels?.() ?? [];
      return okResult({
        models: models.map((m) => ({ id: m.id, provider: request.providerId })),
      });
    }

    case "auth:resolve-discovery": {
      const { providerName, providerConfig } = request;
      if (!providerName) return errResult("invalid_request", "providerName is required");
      let tempDir: string | undefined;
      try {
        tempDir = mkdtempSync(join(tmpdir(), "pi-daemon-model-discovery-"));
        const modelsPath = join(tempDir, "models.json");
        const discoveryModelId = "__pi_web_model_discovery__";
        writeFileSync(
          modelsPath,
          JSON.stringify({
            providers: {
              [providerName]: {
                ...(providerConfig ?? {}),
                models: [{ id: discoveryModelId }],
              },
            },
          }, null, 2),
          "utf8",
        );

        const modelRuntime = await ModelRuntime.create({ modelsPath });
        const loadError = modelRuntime.getError();
        if (loadError) throw new Error(loadError);
        const model = modelRuntime.getModel(providerName, discoveryModelId);
        if (!model) throw new Error(`Unable to load provider "${providerName}"`);

        const resolved = await modelRuntime.getAuth(model);
        const stringRecord = (value: unknown): Record<string, string> => {
          if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
          return Object.fromEntries(
            Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          );
        };
        if (resolved) {
          return okResult({
            apiKey: resolved.auth.apiKey,
            headers: stringRecord(resolved.auth.headers),
          });
        }
        return okResult({
          headers: stringRecord(modelRuntime.getCompatibilityRequestConfig(model).headers),
        });
      } catch (e) {
        return errResult("auth_failed", e instanceof Error ? e.message : String(e));
      } finally {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      }
    }

    case "auth:test-model": {
      const { providerName, providerConfig, modelConfig } = request;
      if (!providerName) return errResult("invalid_request", "providerName is required");
      if (!providerConfig) return errResult("invalid_request", "provider is required");
      if (!modelConfig) return errResult("invalid_request", "model is required");
      return testModel(providerName, providerConfig, modelConfig);
    }

    default:
      return errResult("unknown_op", `Unknown op: ${request.type}`);
  }
}
const TEST_TIMEOUT_MS = 20_000;

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// Test a model config by completing a one-shot prompt against the provider.
// Failure to load/authenticate the model returns {ok:false} as a successful
// result (the web route answers HTTP 200 with ok:false, not an error status);
// only missing required input fields are errResults.
async function testModel(
  providerName: string,
  providerConfig: Record<string, unknown>,
  modelConfig: Record<string, unknown>,
): Promise<import("../pi/rpc.ts").IpcResult> {
  const modelId = typeof modelConfig.id === "string" ? modelConfig.id.trim() : "";
  if (!modelId) return errResult("invalid_request", "Model ID is required");

  let tempDir: string | undefined;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "pi-daemon-model-test-"));
    const modelsPath = join(tempDir, "models.json");
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [providerName]: {
            ...providerConfig,
            models: [{ ...modelConfig, id: modelId }],
          },
        },
      }, null, 2),
      "utf8",
    );

    const modelRuntime = await ModelRuntime.create({ modelsPath });
    const loadError = modelRuntime.getError();
    if (loadError) return okResult({ ok: false, error: loadError });

    const model = modelRuntime.getModel(providerName, modelId);
    if (!model) return okResult({ ok: false, error: `Model not found: ${providerName}/${modelId}` });

    const resolved = await modelRuntime.getAuth(model);
    if (!resolved?.auth.apiKey) {
      return okResult({ ok: false, error: `No API key found for "${providerName}"` });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    let status: number | undefined;
    const startedAt = Date.now();
    try {
      const message = await completeSimple(
        model,
        {
          messages: [{
            role: "user",
            content: "Reply with OK only.",
            timestamp: Date.now(),
          }],
        },
        {
          apiKey: resolved.auth.apiKey,
          headers: resolved.auth.headers,
          maxTokens: 16,
          timeoutMs: TEST_TIMEOUT_MS,
          maxRetries: 0,
          cacheRetention: "none",
          signal: controller.signal,
          onResponse: (response) => { status = response.status; },
        },
      );
      const latencyMs = Date.now() - startedAt;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        return okResult({
          ok: false,
          error: message.errorMessage ?? (controller.signal.aborted ? "Test timed out" : "Model returned an error"),
          latencyMs,
          status,
        });
      }
      return okResult({
        ok: true,
        latencyMs,
        status,
        responseText: assistantText(message).slice(0, 300),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return okResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
