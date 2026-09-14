/**
 * Loopback daemon server: readiness health endpoint + authenticated IPC.
 *
 * Binds to 127.0.0.1 only — the daemon's control plane is local desktop
 * integration, never externally reachable. IPC requests must present the shared
 * token or they are rejected.
 *
 * HTTP layer is Hono (`hono` + `@hono/node-server`), replacing the original
 * hand-rolled node:http server. Route + response surface is unchanged:
 *   GET  /health      → readiness
 *   POST /ipc         → JSON-RPC-ish dispatch (git/files/read/auth/pi)
 *   POST /ipc/stream  → SSE of normalized Pi events
 */
import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
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

const MAX_BODY_BYTES = 1 << 20; // 1 MiB cap, same as before

/**
 * Read the raw request body as text, enforcing the 1 MiB cap that the old
 * node:http `readJson` enforced. Hono's `c.req.text()` has no size limit.
 */
async function readBodyRaw(c: import("hono").Context): Promise<string> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("payload too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createDaemonServer(options: DaemonServerOptions): DaemonServer {
  const log = options.logger;
  let state: Readiness = "starting";
  let server: ServerType | null = null;
  let boundPort = 0;

  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header("x-content-type-options", "nosniff");
    await next();
  });

  /** `POST /ipc` dispatch — same ops as the old handler, same reply shape. */
  async function handleIpc(c: import("hono").Context): Promise<Response> {
    const authorization = c.req.header("authorization");
    if (!authHeld(authorization, options.token)) {
      log?.warn("ipc rejected", { reason: "unauthorized" });
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    let body: IpcMessage;
    try {
      body = JSON.parse(await readBodyRaw(c)) as IpcMessage;
    } catch {
      return c.json({ ok: false, error: "invalid_request" }, 400);
    }
    const type = body?.type;
    if (typeof type !== "string" || type.length === 0) {
      return c.json({ ok: false, error: "invalid_request", detail: "missing type" }, 400);
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
        return c.json({ ok: result.status < 400, type, ...data }, result.status as 200);
      } catch (err) {
        return c.json({ ok: false, error: "internal_error" }, 500);
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
        return c.json({ ok: result.status < 400, type, ...data }, result.status as 200);
      } catch (err) {
        return c.json({ ok: false, error: "internal_error" }, 500);
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
        return c.json({ ok: result.status < 400, type, ...data }, result.status as 200);
      } catch (err) {
        return c.json({ ok: false, error: "internal_error" }, 500);
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
        return c.json({ ok: result.status < 400, type, ...data }, result.status as 200);
      } catch (err) {
        return c.json({ ok: false, error: "internal_error" }, 500);
      }
    }

    // Pi session ops (ZOS-93): dispatched only when a Pi adapter is wired.
    // Without one, every `pi:*` op is 501 — safe-by-default like the file ops.
    if (typeof type === "string" && type.startsWith("pi:")) {
      if (!options.piRpc) {
        return c.json({ ok: false, error: "pi_adapter_not_configured" }, 501);
      }
      try {
        const result = await options.piRpc({ type, ...rest });
        const data = (result.body ?? {}) as Record<string, unknown>;
        return c.json({ ok: result.status < 400, type, ...data }, result.status as 200);
      } catch (err) {
        return c.json({ ok: false, error: "internal_error" }, 500);
      }
    }

    const ipcReplyValue: IpcReply = { ok: true, type, ...rest };
    return c.json(ipcReplyValue, 200);
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
  async function handleStream(c: import("hono").Context): Promise<Response> {
    const authorization = c.req.header("authorization");
    if (!authHeld(authorization, options.token)) {
      log?.warn("ipc stream rejected", { reason: "unauthorized" });
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }
    if (!options.piStream) {
      return c.json({ ok: false, error: "pi_adapter_not_configured" }, 501);
    }
    let body: IpcMessage;
    try {
      body = JSON.parse(await readBodyRaw(c)) as IpcMessage;
    } catch {
      return c.json({ ok: false, error: "invalid_request" }, 400);
    }

    return streamSSE(c, async (stream) => {
      // Serialized write chain: frames go out as they arrive (true streaming),
      // promise-chained so concurrent bursts keep order without batching.
      let chain: Promise<unknown> = Promise.resolve();
      const send = (data: unknown): void => {
        chain = chain.then(() => stream.writeSSE({ data: JSON.stringify(data) })).catch(() => undefined);
      };
      const flush = async (): Promise<void> => {
        await chain.catch(() => undefined);
      };
      const heartbeat = setInterval(() => {
        void stream.write(":\n\n");
      }, SSE_HEARTBEAT_MS);
      // Force headers through before the handler's first event arrives.
      await stream.write(":\n\n");
      try {
        const { type: _type, ...rest } = body;
        const result = await options.piStream!({ type: _type ?? "pi:stream", ...rest }, send);
        await flush();
        if (result.status >= 400) {
          send({ type: "error", ...((result.body ?? {}) as Record<string, unknown>) });
          await flush();
        }
      } catch {
        send({ type: "error", error: "internal_error" });
        await flush();
      } finally {
        clearInterval(heartbeat);
      }
    });
  }

  app.get("/health", (c) => {
    if (state === "ready") return c.json({ status: "ready" }, 200);
    if (state === "shutting-down") return c.json({ status: "shutting-down" }, 503);
    return c.json({ status: state }, 503);
  });
  app.post("/ipc", (c) => handleIpc(c));
  app.post("/ipc/stream", (c) => handleStream(c));
  app.all("*", (c) => c.json({ ok: false, error: "not_found" }, 404));

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
        server = serve(
          {
            fetch: app.fetch,
            hostname: "127.0.0.1",
            port: options.port ?? 0,
          },
          (info) => {
            boundPort = info.port;
            log?.info("daemon listening", { port: boundPort });
            resolve({ port: boundPort });
          },
        );
        server.on("error", reject);
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