/**
 * Control plane WS endpoint + command ingestion (ZOS-96).
 *
 * The control plane accepts OUTBOUND WebSocket connections from employee
 * daemons (no inbound ports on the machine), registers each machine on its
 * `hello` frame, pushes commands as `rpc.request` frames with server-generated
 * correlation ids, accepts `rpc.response`/`ack` frames, and replays unacked
 * commands above the machine's reported watermark after a reconnect. Machine-
 * initiated RPCs dispatch to an injected `handleRpc` and are answered on the
 * same correlation id.
 *
 * Transport: plain node:http (no framework) + `ws` upgraded on /ws. The REST
 * surface (command ingestion, registry, ack) is ~5 routes; a framework buys
 * nothing here. Token auth (Bearer) on both WS upgrade and REST.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  CONTROL_HELLO,
  CONTROL_RPC_REQUEST,
  CONTROL_RPC_RESPONSE,
  CONTROL_ACK,
  CONTROL_PING,
  CONTROL_PONG,
  FRAME_VALIDATORS,
} from "@zosma-cowork/protocol";
import type { CommandStore } from "./store.ts";

export interface RpcReply {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface ControlPlaneServer {
  start(port?: number): Promise<{ port: number }>;
  stop(): Promise<void>;
  /** Registry snapshot for ops/tests. */
  machines(): Array<{ machineId: string; connected: boolean; watermark: number }>;
  /** Ingest a command for a machine; pushes immediately if connected. */
  push(machineId: string, cmd: { method: string; params?: Record<string, unknown> }): Promise<{ correlationId: string; seq: number }>;
  store: CommandStore;
}

interface Conn {
  ws: WebSocket;
  machineId: string;
  watermark: number;
}

export interface ControlPlaneServerOptions {
  token: string;
  store: CommandStore;
  /** Dispatches machine-initiated RPCs; default answers method_not_found. */
  handleRpc?: (machineId: string, method: string, params?: Record<string, unknown>) => Promise<RpcReply>;
  logger?: { info(msg: string, meta?: unknown): void };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readJson(req: Server extends never ? never : import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk;
      if (body.length > 1 << 20) req.destroy(); // 1 MiB cap
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

export function createControlPlaneServer(options: ControlPlaneServerOptions): ControlPlaneServer {
  const { token, store } = options;
  const handleRpc = options.handleRpc ?? (async (_m, method) => ({ ok: false, error: { code: "method_not_found", message: `no handler for ${method}` } }));
  const log = options.logger ?? { info() {} };

  const connections = new Map<string, Conn>();

  const send = (c: Conn, type: string, payload: Record<string, unknown>): void => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type, ...payload }));
  };

  const sendCommand = (c: Conn, correlationId: string, method: string, params?: Record<string, unknown>): void => {
    const frame: Record<string, unknown> = { correlationId, method };
    if (params) frame.params = params;
    send(c, CONTROL_RPC_REQUEST, frame);
  };

  const replay = async (c: Conn): Promise<void> => {
    const pending = await store.pending(c.machineId);
    for (const cmd of pending) {
      if (cmd.seq <= c.watermark) continue;
      sendCommand(c, cmd.correlationId, cmd.method, cmd.params);
    }
  };

  const onFrame = async (c: Conn, raw: string): Promise<void> => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // not JSON — ignore, never fatal
    }
    const tag = typeof msg.type === "string" ? msg.type : "";
    const validator = FRAME_VALIDATORS[tag];
    if (!validator) return;
    const payload = { ...msg };
    delete payload.type;
    const res = validator(payload);
    if (!res.ok) return; // schema violation — ignore (never fatal)

    switch (tag) {
      case CONTROL_HELLO: {
        const hello = res.value as { machineId: string; watermark: number };
        if (c.machineId && c.machineId !== hello.machineId) {
          c.ws.close(4002, "machine id change on live connection");
          return;
        }
        c.machineId = hello.machineId;
        c.watermark = hello.watermark;
        connections.set(hello.machineId, c);
        log.info("machine registered", { machineId: hello.machineId, watermark: hello.watermark });
        void replay(c);
        return;
      }
      case CONTROL_ACK: {
        const a = res.value as { correlationId: string };
        await store.ack(a.correlationId);
        return;
      }
      case CONTROL_PING: {
        send(c, CONTROL_PONG, {});
        return;
      }
      case CONTROL_RPC_REQUEST: {
        const r = res.value as { correlationId: string; method: string; params?: Record<string, unknown> };
        const reply = await handleRpc(c.machineId ?? "unknown", r.method, r.params);
        send(c, CONTROL_RPC_RESPONSE, { correlationId: r.correlationId, ...reply });
        return;
      }
      case CONTROL_RPC_RESPONSE: {
        // Machine answering a server-pushed command — nothing to route in v1
        // (responses surfaced later); ack still records completion.
        return;
      }
      default:
        return;
    }
  };

  const authHeld = (h: string | undefined): boolean =>
    !!h && h.trim().toUpperCase().startsWith("BEARER ") && h.trim().slice(7).trim() === token;

  const json = (res: import("node:http").ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const auth = (req: import("node:http").IncomingMessage): boolean => authHeld(req.headers.authorization);

  let httpServer: Server | null = null;
  let wss: WebSocketServer | null = null;

  return {
    store,
    machines() {
      return [...connections.values()].map((x) => ({ machineId: x.machineId, connected: x.ws.readyState === WebSocket.OPEN, watermark: x.watermark }));
    },
    async push(machineId, cmd) {
      const correlationId = randomUUID();
      const seq = await store.append(machineId, { correlationId, method: cmd.method, params: cmd.params });
      const conn = connections.get(machineId);
      if (conn) sendCommand(conn, correlationId, cmd.method, cmd.params);
      return { correlationId, seq };
    },
    async start(port = 0) {
      httpServer = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { status: "ready" });
        if (!auth(req)) return json(res, 401, { ok: false, error: "unauthorized" });

        const cmdMatch = req.method === "POST" ? /^\/machines\/([^/]+)\/commands$/.exec(url.pathname) : null;
        if (cmdMatch) {
          const machineId = decodeURIComponent(cmdMatch[1]!);
          const body = await readJson(req);
          if (typeof body.method !== "string" || !body.method) return json(res, 400, { ok: false, error: "method required" });
          const result = await this.push(machineId, { method: body.method, params: body.params as Record<string, unknown> | undefined });
          return json(res, 200, { ok: true, ...result });
        }
        const ackMatch = req.method === "POST" ? /^\/machines\/([^/]+)\/commands\/([^/]+)\/ack$/.exec(url.pathname) : null;
        if (ackMatch) {
          await store.ack(decodeURIComponent(ackMatch[2]!));
          return json(res, 200, { ok: true });
        }
        if (req.method === "GET" && url.pathname === "/machines") {
          return json(res, 200, { ok: true, machines: this.machines() });
        }
        return json(res, 404, { ok: false, error: "not_found" });
      });

      wss = new WebSocketServer({ noServer: true });
      httpServer.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (url.pathname !== "/ws" || !authHeld(req.headers.authorization)) {
          socket.destroy();
          return;
        }
        wss!.handleUpgrade(req, socket, head, (ws) => {
          const conn: Conn = { ws, machineId: "", watermark: 0 };
          ws.on("message", (data) => {
            void onFrame(conn, String(data));
          });
          ws.on("close", () => {
            if (conn.machineId && connections.get(conn.machineId) === conn) connections.delete(conn.machineId);
          });
        });
      });

      const actual = await new Promise<number>((resolve, reject) => {
        httpServer!.once("error", reject);
        httpServer!.listen(port, "127.0.0.1", () => resolve((httpServer!.address() as { port: number }).port));
      });
      return { port: actual };
    },
    async stop() {
      for (const c of connections.values()) c.ws.close();
      connections.clear();
      await wait(20);
      wss?.close();
      await new Promise<void>((r) => (httpServer?.close(() => r()) ?? r()));
    },
  };
}