// Client-side helper for the /api/v1 read surface.
//
// Every /api/v1 read route returns one of:
//   { data: <result> }                 (2xx)
//   { error: { code, message } }       (non-2xx)
//
// This module centralizes envelope decoding so call sites never branch on the
// wire shape. Type-only imports keep the contract types out of the browser
// bundle (Phase 1 boundary rule: browser code must not import server runtime).
import type {
  AgentStateResponse,
  ModelsResponse,
  ModelState,
  SessionContext,
  SessionDetailsResponse,
  SessionsResponse,
  SkillsResponse,
  SkillInstallInput,
  SkillInstallResponse,
  SkillCheckInput,
  SkillCheckResponse,
  SkillUpdateInput,
  SkillUpdateResponse,
  SkillSearchInput,
  SkillSearchResponse,
  UpdateModelRequest,
  UpdateModelResponse,
  PluginsRequestInput,
  PluginsResponse,
} from "@/packages/pi-backend/contracts";

export class ApiV1Error extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiV1Error";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!res.ok || body.error) {
    throw new ApiV1Error(
      body.error?.message ?? `HTTP ${res.status}`,
      res.status,
      body.error?.code ?? "internal_error",
    );
  }
  return body.data as T;
}

export function listSessions(force = false): Promise<SessionsResponse> {
  return apiFetch(`/api/v1/sessions${force ? "?force=1" : ""}`, { cache: "no-store" });
}

export function getSessionDetails(
  sessionId: string,
  options: { deferThinking?: boolean; deferMedia?: boolean } = {},
): Promise<SessionDetailsResponse> {
  const params = new URLSearchParams();
  if (options.deferThinking) params.set("deferThinking", "1");
  if (options.deferMedia) params.set("deferMedia", "1");
  const query = params.toString();
  return apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`);
}

export function getSessionContext(
  sessionId: string,
  leafId?: string | null,
): Promise<SessionContext> {
  const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
  if (leafId) params.set("leafId", leafId);
  return apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/context?${params}`);
}

export function getSessionThinking(
  sessionId: string,
  entryId: string,
  blockIndex: number,
): Promise<{ thinking: string }> {
  return apiFetch(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
  );
}

export function getRunningSessionIds(signal?: AbortSignal): Promise<string[]> {
  return apiFetch<{ runningSessionIds: string[] }>("/api/v1/agent/running", {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  }).then((data) => data.runningSessionIds);
}

export interface AgentStateData {
  running: boolean;
  state?: AgentStateResponse;
}

export function getAgentState(sessionId: string): Promise<AgentStateData> {
  return apiFetch(`/api/v1/agent/${encodeURIComponent(sessionId)}/state`);
}

export function getModels(cwd?: string): Promise<ModelsResponse> {
  return apiFetch(cwd ? `/api/v1/models?cwd=${encodeURIComponent(cwd)}` : "/api/v1/models");
}

// ============================================================================
// Session model + thinking controls
//
// GET  /api/v1/sessions/{id}/model  — current model + thinking level
// PATCH /api/v1/sessions/{id}/model — select model and/or change thinking
// ============================================================================

/** List the model catalog for a headless client (no cwd probe). */
export function listModels(): Promise<ModelsResponse> {
  return apiFetch("/api/v1/models");
}

/** List installed skills (with install info) for a headless client. */
export function listSkills(cwd?: string): Promise<SkillsResponse> {
  return apiFetch(cwd ? `/api/v1/skills?cwd=${encodeURIComponent(cwd)}` : "/api/v1/skills");
}

// ============================================================================
// Skill management (ZOS-82, slice 2)
//
// POST /api/v1/skills/{install,check,update,search}
// ============================================================================

export function installSkill(input: SkillInstallInput): Promise<SkillInstallResponse> {
  return apiFetch("/api/v1/skills/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function checkSkillUpdates(input: SkillCheckInput): Promise<SkillCheckResponse> {
  return apiFetch("/api/v1/skills/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateSkill(input: SkillUpdateInput): Promise<SkillUpdateResponse> {
  return apiFetch("/api/v1/skills/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function searchSkills(input: SkillSearchInput): Promise<SkillSearchResponse> {
  return apiFetch("/api/v1/skills/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ============================================================================
// Plugin management (ZOS-82) — extensions/skills/prompts/themes over /api/v1
//
// GET  /api/v1/plugins?cwd=
// POST /api/v1/plugins          { action, source?, scope?, cwd }
// ============================================================================

export function listPlugins(cwd?: string): Promise<PluginsResponse> {
  return apiFetch(cwd ? `/api/v1/plugins?cwd=${encodeURIComponent(cwd)}` : "/api/v1/plugins");
}

export function managePlugin(input: PluginsRequestInput): Promise<PluginsResponse> {
  return apiFetch("/api/v1/plugins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Read the active model + thinking level for a live session. */
export function getSessionModel(sessionId: string): Promise<ModelState> {
  return apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/model`);
}

/** Select a model and/or change the thinking-level budget on a session. */
export function configureModel(
  sessionId: string,
  patch: UpdateModelRequest,
): Promise<UpdateModelResponse> {
  return apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/model`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

// ============================================================================
// Streaming transport
//
// POST /api/v1/sessions/{id}/stream — SSE mirroring the UI wire byte-for-byte.
// Browser-safe (fetch + ReadableStream); no server-only/server runtime imports.
// ============================================================================

/** Client-facing agent event, decoded from each SSE `data:` frame. */
export type StreamingClientEvent = { type: string; [key: string]: unknown };

/**
 * Live handle over a streamed session. `onEvent` returns an unsubscribe; call
 * `close` to cancel the underlying read loop and release the connection.
 */
export interface StreamingSessionHandle {
  readonly sessionId: string;
  onEvent(listener: (event: StreamingClientEvent) => void): () => void;
  close(): void;
}

// Parse SSE frames incrementally; a `data:` line may straddle read boundaries.
// Buffers decoded events so a listener attached after the first event still
// receives it (an SSE reader is inherently late to the stream).
class SseParser {
  private buffer = "";
  private listeners = new Set<(event: StreamingClientEvent) => void>();
  // Only buffered before a subscriber attaches; keeps memory bounded to
  // events received before the first onEvent call.
  private buffered: StreamingClientEvent[] = [];

  onEvent(listener: (event: StreamingClientEvent) => void): () => void {
    const pending = this.buffered;
    this.buffered = [];
    for (const event of pending) {
      try { listener(event); } catch { /* ignore listener errors */ }
    }
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  write(chunk: string): void {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf("\n\n")) !== -1) {
      const frame = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const match = /^data:\s?(.*)$/.exec(frame);
      if (match) {
        try {
          const event = JSON.parse(match[1]) as StreamingClientEvent;
          if (this.listeners.size === 0) {
            this.buffered.push(event);
          } else {
            for (const listener of [...this.listeners]) {
              try { listener(event); } catch { /* ignore listener errors */ }
            }
          }
        } catch { /* ignore malformed frame */ }
      }
    }
  }
}

export async function streamSession(
  sessionId: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<StreamingSessionHandle> {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  const res = await fetch(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/stream`,
    {
      method: "POST",
      ...init,
      headers,
      ...(signal ? { signal } : {}),
    },
  );

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new ApiV1Error(
      body.error?.message ?? `HTTP ${res.status}`,
      res.status,
      body.error?.code ?? "internal_error",
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let closed = false;
  let scheduled = false;

  const parser = new SseParser();
  const pump = (): void => {
    reader
      .read()
      .then(({ done, value }) => {
        if (done) { closed = true; return; }
        parser.write(decoder.decode(value, { stream: true }));
        if (!closed && !scheduled) {
          scheduled = true;
          queueMicrotask(() => {
            scheduled = false;
            pump();
          });
        }
      })
      .catch(() => { closed = true; });
  };

  pump();

  return {
    sessionId,
    onEvent(listener) {
      return parser.onEvent(listener);
    },
    close() {
      closed = true;
      reader.cancel().catch(() => {});
    },
  };
}
