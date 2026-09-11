/**
 * Thin RPC dispatch for the daemon's Pi harness adapter (ZOS-93).
 *
 * Exposes the {@link PiAdapter} over the loopback IPC boundary. Ops are
 * `pi:*` names mapped 1:1 to adapter methods; inputs are extracted from the
 * flat request body and validated. Session `cwd` values must resolve inside
 * an allowed root (same security gate as the git/file RPCs) — a caller can
 * never start an agent in a directory it was not granted.
 */
import type { PiAdapter } from "./adapter.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "../git/file-access.ts";
import { toSlashPath } from "../git/paths.ts";
import type { NormalizedEvent, Turn } from "@zosma-cowork/protocol";

// RPC op identifiers dispatched to the Pi adapter below.
export const PI_RPC_OPS = [
  "pi:probe",
  "pi:start",
  "pi:resume",
  "pi:prompt",
  "pi:command",
  "pi:update",
  "pi:cancel",
  "pi:close",
  "pi:health",
  "pi:list",
  "pi:dispose",
] as const;
export type PiRpcOp = (typeof PI_RPC_OPS)[number];

export interface PiRpcRequest {
  type: string;
  sessionId?: string;
  /** Workspace root the session runs in. Must be within an allowed root. */
  cwd?: string;
  /** Bypass the store: resume the persisted session file at this path (cutover). */
  sessionFile?: string;
  /** Model scope applied at construction (provider/modelId). */
  model?: { provider?: string; modelId?: string };
  /** Thinking level applied at construction. */
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
  /** Tool allowlist applied at construction. */
  toolNames?: string[];
  text?: string;
  cid?: string;
  timedOut?: boolean;
  mode?: "steer" | "follow_up";
  status?: string;
  config?: Record<string, unknown>;
  /** Advanced-control command for `pi:command` (ZOS-95). */
  command?: Record<string, unknown>;
  /** Base64 image attachments for `pi:prompt`. */
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  /** Embedded turn for the streaming transport (`pi:stream`). */
  turn?: {
    text?: string;
    cid?: string;
    timedOut?: boolean;
    mode?: "steer" | "follow_up";
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
  };
}

export interface IpcResult {
  status: number;
  body: unknown;
}

function ok(body: Record<string, unknown>): IpcResult {
  return { status: 200, body };
}

/** Adapters normalized-error the same shape as protocol `AdapterError`. */
function errBody(message: string): Record<string, unknown> {
  return { error: message };
}

/** Gate a request-supplied cwd: must be a real directory inside an allowed root. */
async function gateCwd(cwd: string | undefined): Promise<string | undefined> {
  if (!cwd) return undefined;
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) {
    throw new Error("Access denied");
  }
  return cwd;
}

/**
 * Dispatch one `pi:*` op to the adapter. Never throws: every adapter error is
 * normalized into a non-2xx IpcResult so the server can reply uniformly.
 */
export async function handlePiRpc(adapter: PiAdapter, request: PiRpcRequest): Promise<IpcResult> {
  try {
    switch (request.type) {
      case "pi:probe": {
        adapter.probe();
        return ok({});
      }
      case "pi:start": {
        const cwd = await gateCwd(request.cwd);
        const handle = await adapter.start(request.sessionId, cwd, {
          ...(request.model ? { model: request.model } : {}),
          ...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
          ...(request.toolNames ? { toolNames: request.toolNames } : {}),
        });
        return ok(handle as unknown as Record<string, unknown>);
      }
      case "pi:resume": {
        if (!request.sessionId) return { status: 400, body: errBody("missing sessionId") };
        let sessionFile: string | undefined = undefined;
        if (request.sessionFile) {
          const roots = await getAllowedFileRoots();
          const inRoots = isFilePathAllowed(request.sessionFile, roots) && isExistingFilePathAllowed(request.sessionFile, roots);
          // Session persistence dir: resume-from-file mirrors the web tier's
          // resolveSessionPath (index-based, not root-gated) — the file must
          // live inside the SDK agent dir or an explicitly allowed root.
          const inAgentDir = toSlashPath(request.sessionFile).startsWith(toSlashPath(getAgentDir()) + "/");
          if (!inRoots && !inAgentDir) {
            return { status: 403, body: errBody("Access denied") };
          }
          sessionFile = request.sessionFile;
        }
        const handle = await adapter.resume(request.sessionId, sessionFile);
        return ok(handle as unknown as Record<string, unknown>);
      }
      case "pi:prompt": {
        if (!request.sessionId) return { status: 400, body: errBody("missing sessionId") };
        if (!request.text) return { status: 400, body: errBody("missing text") };
        const result = await adapter.prompt(request.sessionId, {
          text: request.text,
          cid: request.cid,
          timedOut: request.timedOut,
          mode: request.mode,
          images: request.images,
        });
        return { status: result.error ? 400 : 200, body: result as unknown as Record<string, unknown> };
      }
      case "pi:command": {
        if (!request.sessionId) return { status: 400, body: errBody("missing sessionId") };
        const command = request.command;
        if (!command || typeof command !== "object" || typeof (command as { type?: unknown }).type !== "string") {
          return { status: 400, body: errBody("missing command.type") };
        }
        try {
          const result = await adapter.command(request.sessionId, command);
          return ok({ result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { status: 400, body: errBody(message) };
        }
      }
      case "pi:update": {
        if (!request.sessionId) return { status: 400, body: errBody("missing sessionId") };
        const patch: { status?: "running" | "paused" | "idle" | "resumed"; config?: Record<string, unknown> } = {};
        if (request.status) patch.status = request.status as "running" | "paused" | "idle" | "resumed";
        if (request.config) patch.config = request.config as Record<string, unknown>;
        const handle = await adapter.update(request.sessionId, patch);
        return ok(handle as unknown as Record<string, unknown>);
      }
      case "pi:cancel": {
        if (!request.sessionId) return { status: 400, body: errBody("missing sessionId") };
        const handle = await adapter.cancel(request.sessionId);
        return ok(handle as unknown as Record<string, unknown>);
      }
      case "pi:close": {
        if (!request.sessionId) return { status: 400, body: errBody("missing sessionId") };
        await adapter.close(request.sessionId);
        return ok({});
      }
      case "pi:health": {
        return ok(adapter.health() as unknown as Record<string, unknown>);
      }
      case "pi:list": {
        const sessions = await adapter.listSessions();
        return ok({ sessions: sessions as unknown as [] });
      }
      case "pi:dispose": {
        await adapter.dispose();
        return ok({});
      }
      default:
        return { status: 404, body: errBody(`unknown op: ${request.type}`) };
    }
  } catch (err) {
    if (err instanceof Error && err.message === "Access denied") {
      return { status: 403, body: errBody("Access denied") };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { status: 500, body: errBody(message) };
  }
}

/** One normalized event pushed live by the streaming transport. */
export type PiStreamSink = (event: NormalizedEvent) => void;

/**
 * Streaming transport handler (roadmap item 4): the `/ipc/stream` SSE route
 * injects this. Pushes normalized events to `sink` as they occur — with an
 * embedded turn it prompts first (combined one-shot), without one it watches
 * until the current/next turn ends. Resolves once the turn's terminal event
 * has been sunk. Never throws: errors become non-2xx IpcResults that the SSE
 * route frames as an `error` data event.
 */
export async function handlePiStream(
  adapter: PiAdapter,
  request: PiRpcRequest,
  sink: PiStreamSink,
): Promise<IpcResult> {
  try {
    if (request.turn && !request.turn.text) {
      return { status: 400, body: errBody("missing text") };
    }
    const turn: Turn | undefined = request.turn
      ? {
          text: request.turn.text as string,
          cid: request.turn.cid,
          timedOut: request.turn.timedOut,
          mode: request.turn.mode,
          images: request.turn.images,
        }
      : undefined;
    const result = await adapter.streamTurn(request.sessionId, turn, sink);
    if (result.error) return { status: 400, body: result as unknown as Record<string, unknown> };
    return { status: 200, body: {} };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 500, body: errBody(message) };
  }
}