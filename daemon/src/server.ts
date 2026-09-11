/**
 * Loopback daemon server: readiness health endpoint + authenticated IPC.
 *
 * Binds to 127.0.0.1 only — the daemon's control plane is local desktop
 * integration, never externally reachable. IPC requests must present the shared
 * token or they are rejected.
 */
import http from "node:http";
import { GIT_RPC_OPS, handleGitRpc, type GitRpcRequest } from "./git/rpc.ts";
import { FILES_RPC_OPS, handleFilesRpc, type FilesRpcRequest } from "./files/rpc.ts";
import { READ_RPC_OPS, handleReadRpc, type ReadRpcRequest } from "./read/rpc.ts";
import { AUTH_RPC_OPS, handleAuthRpc, type AuthRpcRequest } from "./auth/rpc.ts";
import { type IpcResult as PiIpcResult } from "./pi/rpc.ts";

export type Readiness = "starting" | "ready" | "shutting-down" | "error";

/**
 * Pi adapter dispatch, injected so the server can be built/loaded without
 * the Pi SDK (default: no Pi ops handled → 501). Wired in `index.ts`.
 */
export type PiRpcHandler = (request: { type: string; [key: string]: unknown }) => Promise<PiIpcResult>;

/**
 * Pi streaming dispatch for `POST /ipc/stream` (SSE). The handler pushes
 * normalized events to `sink` as they occur and resolves once the turn's
 * terminal event has been sunk (or errors). Injected like `piRpc` so the
 * server stays Pi-free; wired in `index.ts`.
 */
export type PiStreamHandler = (
  request: { type: string; [key: string]: unknown },
  sink: (event: unknown) => void,
) => Promise<PiIpcResult>;

export interface DaemonServerOptions {
  token: string;
  logger?: {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
  /** When set, `pi:*` ops dispatch to this handler (the Pi adapter). */
  piRpc?: PiRpcHandler;
  /** When set, `POST /ipc/stream` (SSE) dispatches to this handler. */
  piStream?: PiStreamHandler;
  /** Fixed port to bind (supervision). Default: ephemeral (`listen(0)`). */
  port?: number;
}

export interface DaemonServer {
  start(): Promise<{ port: number }>;
  stop(): Promise<void>;
  setReady(state: Readiness): void;
  getState(): Readiness;
  get port(): number;
}

interface IpcMessage {
  type: string;
  [key: string]: unknown;
}
interface IpcReply {
  ok: boolean;
  type: string;
  [key: string]: unknown;
}

function authHeld(authorization: string | undefined, token: string): boolean {
  if (!authorization) return false;
  const s = authorization.trim();
  const i = s.indexOf(" ");
  if (i === -1 || s.slice(0, i).toUpperCase() !== "BEARER") return false;
  return timingSafeEqual(s.slice(i + 1).trim(), token);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createDaemonServer(options: DaemonServerOptions): DaemonServer {
  const log = options.logger;
  let state: Readiness = "starting";
  let server: http.Server | null = null;
  let boundPort = 0;

  function reply(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    });
    res.end(payload);
  }

  function handleHealth(res: http.ServerResponse): void {
    if (state === "ready") return reply(res, 200, { status: "ready" });
    if (state === "shutting-down") return reply(res, 503, { status: "shutting-down" });
    return reply(res, 503, { status: state });
  }

  async function handleIpc(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    authorization: string | undefined,
  ): Promise<void> {
    if (!authHeld(authorization, options.token)) {
      log?.warn("ipc rejected", { reason: "unauthorized" });
      return reply(res, 401, { ok: false, error: "unauthorized" });
    }
    try {
      const body: IpcMessage = await readJson(req);
      const type = body?.type;
      if (typeof type !== "string" || type.length === 0) {
        return reply(res, 400, { ok: false, error: "invalid_request", detail: "missing type" });
      }
      const { type: _type, ...rest } = body;

      // Git/worktree ops route to the ported daemon service, gated by the
      // file-access security. File/workspace/index ops route to the file
      // service with the same gate. Any other op echoes back unchanged.
      if ((GIT_RPC_OPS as readonly string[]).includes(type)) {
        try {
          const request: GitRpcRequest = {
            type,
            cwd: (rest.cwd as string | undefined) ?? undefined,
            path: (rest.path as string | undefined) ?? undefined,
            branch: (rest.branch as string | undefined) ?? undefined,
            force: (rest.force as boolean | undefined) ?? undefined,
          };
          const result = await handleGitRpc(request);
          const data = (result.body ?? {}) as Record<string, unknown>;
          return reply(res, result.status, { ok: result.status < 400, type, ...data });
        } catch (err) {
          return reply(res, 500, { ok: false, error: "internal_error" });
        }
      }

      if ((FILES_RPC_OPS as readonly string[]).includes(type)) {
        try {
          const request: FilesRpcRequest = {
            type,
            cwd: (rest.cwd as string | undefined) ?? undefined,
            path: (rest.path as string | undefined) ?? undefined,
            content: (rest.content as string | undefined) ?? undefined,
            expectedSha256: (rest.expectedSha256 as string | undefined) ?? undefined,
            query: (rest.query as string | undefined) ?? undefined,
          };
          const result = await handleFilesRpc(request);
          const data = (result.body ?? {}) as Record<string, unknown>;
          return reply(res, result.status, { ok: result.status < 400, type, ...data });
        } catch (err) {
          return reply(res, 500, { ok: false, error: "internal_error" });
        }
      }

      if ((READ_RPC_OPS as readonly string[]).includes(type)) {
        try {
          const request: ReadRpcRequest = {
            type: type as never,
            sessionId: (rest.sessionId as string | undefined) ?? undefined,
            cwd: (rest.cwd as string | undefined) ?? undefined,
            force: (rest.force as boolean | undefined) ?? undefined,
            deferThinking: (rest.deferThinking as boolean | undefined) ?? undefined,
            deferMedia: (rest.deferMedia as boolean | undefined) ?? undefined,
            leafId: (rest.leafId as string | undefined) ?? undefined,
            entryId: (rest.entryId as string | undefined) ?? undefined,
            blockIndex: (rest.blockIndex as number | undefined) ?? undefined,
            name: (rest.name as string | undefined) ?? undefined,
            source: (rest.source as string | undefined) ?? undefined,
            scope: (rest.scope as string | undefined) ?? undefined,
            package: (rest.package as string | undefined) ?? undefined,
            filePath: (rest.filePath as string | undefined) ?? undefined,
            disableModelInvocation:
              (rest.disableModelInvocation as boolean | undefined) ?? undefined,
            version: (rest.version as string | undefined) ?? undefined,
            query: (rest.query as string | undefined) ?? undefined,
            limit: (rest.limit as number | undefined) ?? undefined,
            action: (rest.action as string | undefined) ?? undefined,
            root: (rest.root as string | undefined) ?? undefined,
            trust: (rest.trust as boolean | undefined) ?? undefined,
          };
          const result = await handleReadRpc(request);
          const data = (result.body ?? {}) as Record<string, unknown>;
          return reply(res, result.status, { ok: result.status < 400, type, ...data });
        } catch (err) {
          return reply(res, 500, { ok: false, error: "internal_error" });
        }
      }

      // Auth ops: ModelRuntime-backed provider/credential surface relayed by
      // the web tier. Uses the same read/* helpers; the interactive login
      // session lives here (auth:login-start/status/callback/cancel).
      if ((AUTH_RPC_OPS as readonly string[]).includes(type)) {
        try {
          const request: AuthRpcRequest = {
            type: type as never,
            provider: (rest.provider as string | undefined) ?? undefined,
            providerId: (rest.providerId as string | undefined) ?? undefined,
            apiKey: (rest.apiKey as string | undefined) ?? undefined,
            authId: (rest.authId as string | undefined) ?? undefined,
            token: (rest.token as string | undefined) ?? undefined,
            code: (rest.code as string | undefined) ?? undefined,
            providerName: (rest.providerName as string | undefined) ?? undefined,
            providerConfig:
              (rest.providerConfig as Record<string, unknown> | undefined) ?? undefined,
            modelConfig:
              (rest.modelConfig as Record<string, unknown> | undefined) ?? undefined,
          };
          const result = await handleAuthRpc(request);
          const data = (result.body ?? {}) as Record<string, unknown>;
          return reply(res, result.status, { ok: result.status < 400, type, ...data });
        } catch (err) {
          return reply(res, 500, { ok: false, error: "internal_error" });
        }
      }

      // Pi session ops (ZOS-93): dispatched only when a Pi adapter is wired.
      // Without one, every `pi:*` op is 501 — safe-by-default like the file ops.
      if (typeof type === "string" && type.startsWith("pi:")) {
        if (!options.piRpc) {
          return reply(res, 501, { ok: false, error: "pi_adapter_not_configured" });
        }
        try {
          const result = await options.piRpc({ type, ...rest });
          const data = (result.body ?? {}) as Record<string, unknown>;
          return reply(res, result.status, { ok: result.status < 400, type, ...data });
        } catch (err) {
          return reply(res, 500, { ok: false, error: "internal_error" });
        }
      }

      const ipcReply: IpcReply = { ok: true, type, ...rest };
      return reply(res, 200, ipcReply);
    } catch (err) {
      return reply(res, 400, { ok: false, error: "invalid_request" });
    }
  }

  const SSE_HEARTBEAT_MS = 30_000;

  /**
   * `POST /ipc/stream` — SSE of normalized Pi events (roadmap item 4).
   *
   * Mirrors the web tier's passive tap (`/api/v1/sessions/[id]/stream`): the
   * connection opens immediately, events flow as `data:` frames, and a `:`
   * heartbeat comment keeps the socket alive. The injected handler decides
   * whether the stream is one-shot (embedded turn) or a watch (client closes).
   * Handler-level validation surfaces as an SSE `error` data event; only
   * auth/config/body errors reply as JSON before the stream opens.
   */
  async function handleStream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    authorization: string | undefined,
  ): Promise<void> {
    if (!authHeld(authorization, options.token)) {
      log?.warn("ipc stream rejected", { reason: "unauthorized" });
      return reply(res, 401, { ok: false, error: "unauthorized" });
    }
    if (!options.piStream) {
      return reply(res, 501, { ok: false, error: "pi_adapter_not_configured" });
    }
    let body: IpcMessage;
    try {
      body = await readJson(req);
    } catch (err) {
      return reply(res, 400, { ok: false, error: "invalid_request" });
    }

    let closed = false;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    });
    const send = (data: unknown): void => {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* socket closed under us — stream is over */
      }
    };
    const heartbeat = setInterval(() => {
      if (!closed) {
        try {
          res.write(":\n\n");
        } catch {
          /* idle socket closed */
        }
      }
    }, SSE_HEARTBEAT_MS);
    res.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
    });
    // Force headers through before the handler's first event arrives.
    try {
      res.write(":\n\n");
    } catch {
      /* socket closed before any event — nothing to stream */
    }
    try {
      const { type: _type, ...rest } = body;
      const result = await options.piStream({ type: _type ?? "pi:stream", ...rest }, send);
      if (result.status >= 400) {
        send({ type: "error", ...((result.body ?? {}) as Record<string, unknown>) });
      }
    } catch {
      send({ type: "error", error: "internal_error" });
    } finally {
      if (!closed) {
        closed = true;
        clearInterval(heartbeat);
        try {
          res.end();
        } catch {
          /* already closed */
        }
      }
    }
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.socket.remoteAddress ?? "127.0.0.1"}`);
    const authorization = req.headers.authorization;
    if (req.method === "GET" && url.pathname === "/health") return handleHealth(res);
    if (req.method === "POST" && url.pathname === "/ipc") {
      void handleIpc(req, res, authorization);
      return;
    }
    if (req.method === "POST" && url.pathname === "/ipc/stream") {
      void handleStream(req, res, authorization);
      return;
    }
    reply(res, 404, { ok: false, error: "not_found" });
  }

  return {
    get port() {
      return boundPort;
    },
    getState() {
      return state;
    },
    setReady(s: Readiness) {
      state = s;
    },
    async start(): Promise<{ port: number }> {
      return new Promise((resolve, reject) => {
        server = http.createServer(handle);
        server.on("error", reject);
        server.on("listening", () => {
          const addr = server!.address();
          if (!addr || typeof addr === "string") return;
          boundPort = addr.port;
          log?.info("daemon listening", { port: boundPort });
          resolve({ port: boundPort });
        });
        server.listen(options.port ?? 0, "127.0.0.1");
      });
    },
    async stop(): Promise<void> {
      return new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => {
          server = null;
          boundPort = 0;
          resolve();
        });
      });
    },
  };
}

function readJson(req: http.IncomingMessage): Promise<IpcMessage> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const LIMIT = 1 << 20; // 1 MiB cap
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > LIMIT) return reject(new Error("payload too large"));
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({} as IpcMessage);
      try {
        resolve(JSON.parse(raw) as IpcMessage);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
