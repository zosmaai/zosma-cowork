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
  SessionContext,
  SessionDetailsResponse,
  SessionsResponse,
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
