/**
 * ZOS-94 — approval broker RPC dispatch over the loopback IPC boundary.
 *
 * Ops are `approval:*` names mapped 1:1 to {@link ApprovalBroker} methods.
 * Request/reply payloads are the normalized protocol envelopes from
 * `packages/protocol/src/approval.ts`, so any client (web tier now, other
 * harnesses later) speaks the same shapes. Cross-session and unknown
 * correlation ids surface as non-2xx results — never as silent approvals.
 */
import type { ApprovalBroker } from "./broker.ts";
import type { ApprovalResult } from "@zosma-cowork/protocol";

// RPC op identifiers dispatched to the broker below.
export const APPROVAL_RPC_OPS = [
  "approval:request",
  "approval:resolve",
  "approval:cancel",
  "approval:list",
  "approval:reconnect",
] as const;
export type ApprovalRpcOp = (typeof APPROVAL_RPC_OPS)[number];

export interface ApprovalRpcRequest {
  type: string;
  correlationId?: string;
  sessionId?: string;
  kind?: string;
  prompt?: string;
  options?: string[];
  default?: string;
  timeoutMs?: number;
  reason?: string;
  result?: ApprovalResult;
}

export interface IpcResult {
  status: number;
  body: unknown;
}

function ok(body: Record<string, unknown>): IpcResult {
  return { status: 200, body };
}

/** map a broker failure code to an HTTP status (client errors, not 500). */
const STATUS: Record<string, number> = {
  invalid_request: 400,
  duplicate_request: 409,
  unknown_request: 404,
  cross_session_reply: 403,
};

/**
 * Dispatch one `approval:*` op to the broker. Never throws: every broker
 * failure is mapped to a non-2xx IpcResult that explains the rejection.
 */
export async function handleApprovalRpc(broker: ApprovalBroker, request: ApprovalRpcRequest): Promise<IpcResult> {
  try {
    switch (request.type) {
      case "approval:request": {
        const outcome = await broker.request({
          correlationId: request.correlationId,
          sessionId: request.sessionId,
          kind: request.kind,
          prompt: request.prompt,
          options: request.options,
          default: request.default,
          timeoutMs: request.timeoutMs,
        });
        return outcome.ok
          ? ok({ pending: outcome.pending })
          : { status: STATUS[outcome.code] ?? 400, body: { error: outcome.code, message: outcome.message } };
      }
      case "approval:resolve": {
        if (!request.correlationId || !request.sessionId || !request.result) {
          return { status: 400, body: { error: "invalid_request", message: "missing correlationId, sessionId, or result" } };
        }
        const outcome = broker.resolve(request.sessionId, request.correlationId, request.result);
        return outcome.ok
          ? ok({ pending: outcome.pending })
          : { status: STATUS[outcome.code] ?? 400, body: { error: outcome.code, message: outcome.message } };
      }
      case "approval:cancel": {
        if (!request.correlationId || !request.sessionId) {
          return { status: 400, body: { error: "invalid_request", message: "missing correlationId or sessionId" } };
        }
        const outcome = broker.cancel(request.sessionId, request.correlationId, request.reason);
        return outcome.ok
          ? ok({ pending: outcome.pending })
          : { status: STATUS[outcome.code] ?? 400, body: { error: outcome.code, message: outcome.message } };
      }
      case "approval:list": {
        return ok({ pending: broker.list(request.sessionId) });
      }
      case "approval:reconnect": {
        if (!request.sessionId) return { status: 400, body: { error: "invalid_request", message: "missing sessionId" } };
        const reServed = await broker.reconnect(request.sessionId);
        return ok({ reServed, pending: broker.list(request.sessionId) });
      }
      default:
        return { status: 404, body: { error: `unknown op: ${request.type}` } };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { error: "internal_error", message } };
  }
}
