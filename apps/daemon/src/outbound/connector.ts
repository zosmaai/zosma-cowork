/**
 * Outbound control-plane connector (ZOS-96).
 *
 * The daemon dials OUT to the control plane — no inbound port anywhere on the
 * machine (firewall/NAT friendly). Responsibilities:
 *
 *  - Authenticated WS handshake (Bearer token) + machine hello/registration.
 *  - RPC request/response correlation with per-request timeout and explicit
 *    error codes (rpc_timeout / rpc_disconnected / rpc_wire_error).
 *  - Ping/pong heartbeats; a missed pong tears the connection down.
 *  - Jittered exponential reconnect carrying the last watermark so the
 *    control plane replays only the unacked gap.
 *  - Server-pushed commands dispatch to `onCommand`; acking a handled command
 *    makes replay idempotent (no duplicate side effects — AC #5).
 *
 * Kept dependency-light: `ws` only. Correlation ids are UUIDs from
 * `randomUUID` (unique across connections — AC #4).
 */
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import {
  CONTROL_HELLO,
  CONTROL_RPC_REQUEST,
  CONTROL_RPC_RESPONSE,
  CONTROL_ACK,
  CONTROL_PING,
  CONTROL_PONG,
  FRAME_VALIDATORS,
} from "@zosma-cowork/protocol";

export interface RpcReply {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface CommandFrame {
  correlationId: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface OutboundOptions {
  url: string;
  token: string;
  machineId: string;
  machineName: string;
  version?: number;
  /** Heartbeat interval; a missed pong (>2×) tears the connection down. Default 30s. */
  heartbeatMs?: number;
  /** Reconnect backoff cap. Default 30s. */
  maxReconnectMs?: number;
  /** Called for control-plane pushed commands; ack() sends the replay-clear. */
  onCommand?: (cmd: CommandFrame) => Promise<RpcReply> | RpcReply;
  onWatermark?: (watermark: number) => void;
  logger?: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
}

export interface OutboundStatus {
  connected: boolean;
  watermark: number;
  attempts: number;
  lastError?: string;
}

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_MAX_RECONNECT_MS = 30_000;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class OutboundConnector {
  private ws: WebSocket | null = null;
  private stopped = false;
  private dialing = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastError: string | undefined;
  private watermark = 0;
  private lastPongAt = 0;
  private readonly pending = new Map<string, { resolve: (r: RpcReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly opts: Required<Pick<OutboundOptions, "url" | "token" | "machineId" | "machineName" | "version" | "heartbeatMs" | "maxReconnectMs">> &
    OutboundOptions;

  constructor(options: OutboundOptions) {
    this.opts = {
      version: 1,
      heartbeatMs: DEFAULT_HEARTBEAT_MS,
      maxReconnectMs: DEFAULT_MAX_RECONNECT_MS,
      ...options,
    };
  }

  status(): OutboundStatus {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      watermark: this.watermark,
      attempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }

  /** Machine-initiated RPC with explicit timeout; never hangs. */
  request(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<RpcReply> {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(Object.assign(new Error("rpc_disconnected"), { code: "rpc_disconnected" }));
        return;
      }
      const correlationId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(Object.assign(new Error(`rpc_timeout after ${timeoutMs}ms`), { code: "rpc_timeout" }));
      }, timeoutMs);
      this.pending.set(correlationId, { resolve, reject, timer });
      const frame: Record<string, unknown> = { correlationId, method };
      if (params) frame.params = params;
      ws.send(JSON.stringify({ type: CONTROL_RPC_REQUEST, ...frame }), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(correlationId);
          reject(Object.assign(new Error("rpc_wire_error"), { code: "rpc_wire_error" }));
        }
      });
    });
  }

  /** Ack a server-pushed command → control plane never replays it (idempotent). */
  ack(correlationId: string): void {
    this.send({ type: CONTROL_ACK, correlationId });
  }

  start(): void {
    this.stopped = false;
    void this.dial();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.failPending("rpc_disconnected", "connector stopped");
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      ws.removeAllListeners();
      try { ws.close(); } catch { /* noop */ }
    }
  }

  private send(frame: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private failPending(code: string, message: string): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(Object.assign(new Error(message), { code }));
    }
    this.pending.clear();
  }

  private async dial(): Promise<void> {
    if (this.stopped || this.dialing) return;
    this.dialing = true;
    try {
      const ws = new WebSocket(this.opts.url, {
        headers: { Authorization: `Bearer ${this.opts.token}` },
      });
      this.ws = ws;

      ws.on("open", () => {
        this.reconnectAttempts = 0;
        this.lastError = undefined;
        this.lastPongAt = Date.now();
        this.startHeartbeat();
        ws.send(JSON.stringify({
          type: CONTROL_HELLO,
          machineId: this.opts.machineId,
          name: this.opts.machineName,
          version: this.opts.version,
          watermark: this.watermark,
        }));
        this.opts.logger?.info("control plane connected", { machineId: this.opts.machineId });
      });

      ws.on("message", (data) => {
        void this.onMessage(String(data));
      });

      ws.on("error", (err) => {
        this.lastError = err.message;
        this.opts.logger?.warn("control plane socket error", { error: err.message });
      });

      ws.on("close", () => {
        this.stopHeartbeat();
        this.failPending("rpc_disconnected", "control plane connection closed");
        if (this.stopped) return;
        this.scheduleReconnect();
      });
    } finally {
      this.dialing = false;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const base = Math.min(250 * 2 ** (this.reconnectAttempts - 1), this.opts.maxReconnectMs);
    const jitter = base * (0.5 + Math.random() * 0.5); // 50–100% of base
    this.opts.logger?.warn("control plane reconnect scheduled", { attempt: this.reconnectAttempts, inMs: Math.round(jitter) });
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.dial(); }, jitter);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongAt > this.opts.heartbeatMs * 2) {
        this.opts.logger?.warn("control plane heartbeat missed — tearing down");
        ws.terminate(); // triggers close → reconnect
        return;
      }
      ws.send(JSON.stringify({ type: CONTROL_PING }), () => {});
    }, this.opts.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const tag = typeof msg.type === "string" ? msg.type : "";
    const validator = FRAME_VALIDATORS[tag];
    if (!validator) return;
    const payload = { ...msg };
    delete payload.type;
    const res = validator(payload);
    if (!res.ok) return;

    switch (tag) {
      case CONTROL_PING:
        this.send({ type: CONTROL_PONG });
        return;
      case CONTROL_PONG:
        this.lastPongAt = Date.now();
        return;
      case CONTROL_RPC_RESPONSE: {
        const r = res.value as { correlationId: string; ok: boolean; data?: unknown; error?: { code: string; message: string } };
        const pending = this.pending.get(r.correlationId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(r.correlationId);
          pending.resolve(r.ok
            ? { ok: true, data: r.data }
            : { ok: false, error: r.error ?? { code: "rpc_wire_error", message: "malformed rpc response" } });
        }
        return;
      }
      case CONTROL_RPC_REQUEST: {
        // Server-pushed command. Fire-and-forget with a guard so a slow
        // handler never wedges message processing.
        const cmd = res.value as CommandFrame;
        void (async () => {
          let reply: RpcReply = { ok: false, error: { code: "cmd_failed", message: "no handler" } };
          try {
            reply = (await this.opts.onCommand?.(cmd)) ?? reply;
          } catch (e) {
            reply = { ok: false, error: { code: "cmd_failed", message: e instanceof Error ? e.message : String(e) } };
          }
          this.ack(cmd.correlationId);
          const frame: Record<string, unknown> = { correlationId: cmd.correlationId, ...reply };
          this.send({ type: CONTROL_RPC_RESPONSE, ...frame });
        })();
        return;
      }
      default:
        return;
    }
  }
}