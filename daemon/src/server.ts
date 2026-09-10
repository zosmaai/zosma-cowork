/**
 * Loopback daemon server: readiness health endpoint + authenticated IPC.
 *
 * Binds to 127.0.0.1 only — the daemon's control plane is local desktop
 * integration, never externally reachable. IPC requests must present the shared
 * token or they are rejected.
 */
import http from "node:http";
import { GIT_RPC_OPS, handleGitRpc, type GitRpcRequest } from "./git/rpc.ts";

export type Readiness = "starting" | "ready" | "shutting-down" | "error";

export interface DaemonServerOptions {
  token: string;
  logger?: {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
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
      // file-access security. Any other op echoes back unchanged.
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

      const ipcReply: IpcReply = { ok: true, type, ...rest };
      return reply(res, 200, ipcReply);
    } catch (err) {
      return reply(res, 400, { ok: false, error: "invalid_request" });
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
        server.listen(0, "127.0.0.1");
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
