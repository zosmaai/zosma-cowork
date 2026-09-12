// Server-side relay to the zosma daemon (roadmap item 6 — client cutover).
//
// The browser cannot reach the daemon directly (loopback 127.0.0.1, Bearer
// token, no CORS), so web routes relay through this module. All execution
// paths that used the in-process pi-backend runtime now forward to the daemon
// over `/ipc`; the web keeps only session-file reads and static discovery
// (models/skills/plugins), which never needed a live agent runtime.
//
// Daemon discovery contract (set by `pnpm dev:all` / the prod unit):
//   ZOSMA_DAEMON_URL    http://127.0.0.1:<port>   (required)
//   ZOSMA_DAEMON_TOKEN  shared Bearer token        (required)
//
// Server-side only by contract — never import from browser code (components/
// hooks/). The token only ever exists in process.env, so a rogue browser
// import fails closed with a 503 daemon_not_configured and leaks nothing.

import { BackendError, STATUS_BY_CODE } from "./backend-errors.ts";
import type { BackendErrorCode } from "./api-contracts.ts";

export class DaemonError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "DaemonError";
    this.status = status;
    this.code = code;
  }
}

export interface DaemonConfig {
  url: string;
  token: string;
}

/** Read daemon config from the env contract; null when the daemon is absent. */
export function daemonConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig | null {
  const url = env.ZOSMA_DAEMON_URL;
  const token = env.ZOSMA_DAEMON_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export interface DaemonIpcResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * POST one IPC envelope to the daemon. Never throws on non-2xx: the daemon's
 * reply body is returned as-is so routes can translate the wire shape. Throws
 * DaemonError only for transport failures (daemon not listening) — the caller
 * turns those into a 503 "daemon not running" so cutover failures are legible.
 */
export async function daemonIpc(
  body: Record<string, unknown>,
  config: DaemonConfig = requireConfig(),
): Promise<DaemonIpcResult> {
  let res: Response;
  try {
    res = await fetch(`${config.url}/ipc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new DaemonError(
      error instanceof Error ? error.message : String(error),
      503,
      "daemon_unreachable",
    );
  }
  const raw = await res.json().catch(() => ({}));
  const parsed = (raw ?? {}) as Record<string, unknown>;
  return { status: res.status, body: { ...parsed, status: res.status } };
}

/**
 * Open an SSE stream to `POST /ipc/stream`. Returns the raw Response so the
 * route can forward `res.body` bytes through. Daemon errors before the stream
 * opens surface as a non-2xx Response (the caller replies json).
 */
export async function daemonStream(
  body: Record<string, unknown>,
  config: DaemonConfig = requireConfig(),
): Promise<Response> {
  try {
    return await fetch(`${config.url}/ipc/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
        "Cache-Control": "no-cache, no-transform",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new DaemonError(
      error instanceof Error ? error.message : String(error),
      503,
      "daemon_unreachable",
    );
  }
}

export function requireConfig(config: DaemonConfig | null = daemonConfig()): DaemonConfig {
  if (!config) {
    throw new DaemonError(
      "Daemon not configured — start it with `pnpm dev:all` (ZOSMA_DAEMON_URL / ZOSMA_DAEMON_TOKEN missing)",
      503,
      "daemon_not_configured",
    );
  }
  return config;
}

// ============================================================================
// Typed daemon ops (translate the `/ipc` reply into the shape each route
// already exposes, so route rewiring is a one-line swap, not a new contract).
// ============================================================================

export interface PiSessionHandle {
  sessionId: string;
  state: string;
  nativeSessionId: string;
  [key: string]: unknown;
}

/** `pi:start` — new session in `cwd`. Returns the native session id. */
export async function piStart(
  cwd: string,
  sessionId?: string,
  scope?: { model?: { provider?: string; modelId?: string }; thinkingLevel?: string; toolNames?: string[] },
  config?: DaemonConfig,
): Promise<PiSessionHandle> {
  const { status, body } = await daemonIpc({
    type: "pi:start",
    cwd,
    ...(sessionId ? { sessionId } : {}),
    ...(scope?.model ? { model: scope.model } : {}),
    ...(scope?.thinkingLevel ? { thinkingLevel: scope.thinkingLevel } : {}),
    ...(scope?.toolNames ? { toolNames: scope.toolNames } : {}),
  }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "pi:start failed"), status, String(body.error ?? "internal_error"));
  return body as unknown as PiSessionHandle;
}

/** `pi:resume` — attach to `sessionId`, optionally from a web-resolved file. */
export async function piResume(sessionId: string, sessionFile?: string, config?: DaemonConfig): Promise<PiSessionHandle> {
  const { status, body } = await daemonIpc({
    type: "pi:resume",
    sessionId,
    ...(sessionFile ? { sessionFile } : {}),
  }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "pi:resume failed"), status, String(body.error ?? "internal_error"));
  return body as unknown as PiSessionHandle;
}

/** `pi:prompt` — send a turn (plain | steer | follow_up). Returns events. */
export async function piPrompt(
  sessionId: string,
  turn: { text: string; cid?: string; timedOut?: boolean; mode?: "steer" | "follow_up"; images?: Array<{ type: "image"; data: string; mimeType: string }> },
  config?: DaemonConfig,
): Promise<unknown> {
  const { status, body } = await daemonIpc({ type: "pi:prompt", sessionId, ...turn }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "pi:prompt failed"), status, String(body.error ?? "internal_error"));
  return body.events;
}

/** `pi:command` — advanced-control (get_state/set_model/bash/reload/fork/…). */
export async function piCommand(sessionId: string, command: Record<string, unknown>, config?: DaemonConfig): Promise<unknown> {
  const { status, body } = await daemonIpc({ type: "pi:command", sessionId, command }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "pi:command failed"), status, String(body.error ?? "internal_error"));
  return body.result;
}

/** `pi:list` — live sessions on the daemon (running-state poller source). */
export async function piList(config?: DaemonConfig): Promise<Array<PiSessionHandle>> {
  const { status, body } = await daemonIpc({ type: "pi:list" }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "pi:list failed"), status, String(body.error ?? "internal_error"));
  const sessions = body.sessions;
  return Array.isArray(sessions) ? (sessions as unknown as PiSessionHandle[]) : [];
}

/** `pi:close` — shut down a live session on the daemon. */
export async function piClose(sessionId: string, config?: DaemonConfig): Promise<void> {
  const { status, body } = await daemonIpc({ type: "pi:close", sessionId }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "pi:close failed"), status, String(body.error ?? "internal_error"));
}

/** `pi:health` — daemon readiness. */
export async function piHealth(): Promise<{ ready?: boolean }> {
  const { status, body } = await daemonIpc({ type: "pi:health" });
  if (status >= 400) return {};
  return body as { ready?: boolean };
}
/**
 * `read:*` — static read surface served by the daemon (roadmap item 6
 * end-to-end). `op` is the bare op name (e.g. "list-sessions"); the client
 * prefixes `read:`. Returns the daemon's `data` payload. `payload` carries the
 * flat read fields (sessionId, cwd, force, …).
 */
export async function piRead(
  op: string,
  payload: Record<string, unknown> = {},
  config?: DaemonConfig,
): Promise<unknown> {
  const { status, body } = await daemonIpc({ type: `read:${op}`, ...payload }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "read failed"), status, String(body.code ?? "internal_error"));
  return body.data;
}

/** `auth:*` ops — ModelRuntime-backed provider/credential surface. */
export async function piAuth(
  op: string,
  payload: Record<string, unknown> = {},
  config?: DaemonConfig,
): Promise<unknown> {
  const { status, body } = await daemonIpc({ type: `auth:${op}`, ...payload }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "auth failed"), status, String(body.code ?? "internal_error"));
  return body.data;
}

/** `read:allow-root` — grant a workspace root to the daemon's file gate. */
export async function piAllowRoot(root: string, config?: DaemonConfig): Promise<void> {
  const { status, body } = await daemonIpc({ type: "read:allow-root", root }, config);
  if (status >= 400) throw new DaemonError(String(body.error ?? "allow-root failed"), status, String(body.code ?? "internal_error"));
}

// ---- error translation -----------------------------------------------------
// The daemon's read/execute ops surface BackendError-shaped codes
// (session_not_found, access_denied, …). Re-wrap them as real BackendErrors so
// apiErrorResponse / backendErrorResponse translate to the client contract.

/** Map a DaemonError to its BackendError equivalent; null for other errors. */
export function daemonToBackend(error: unknown): BackendError | null {
  if (!(error instanceof DaemonError)) return null;
  const code: BackendErrorCode =
    error.code in STATUS_BY_CODE ? (error.code as BackendErrorCode) : "startup_failed";
  return new BackendError(code, error.message);
}

// Legacy (non-v1) routes answer bare {error} — keep the pre-daemon status
// contract: npx-backed skill failures were 500, everything else maps
// straight from the daemon status.
const LEGACY_500_CODES = new Set([
  "skill_install_failed",
  "skill_check_failed",
  "skill_update_failed",
  "skill_search_failed",
  "plugin_action_failed",
]);

export function legacyDaemonError(error: unknown): { status: number; error: string } {
  if (error instanceof DaemonError) {
    const status = LEGACY_500_CODES.has(error.code) ? 500 : error.status;
    return { status, error: error.message };
  }
  return { status: 500, error: error instanceof Error ? error.message : String(error) };
}
