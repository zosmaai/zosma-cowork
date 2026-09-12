/**
 * Pi native event → normalized event mapping (protocol boundary).
 *
 * The daemon never inspects native Pi fields directly; this module is the
 * single point where a Pi session event becomes a {@link NormalizedEvent}.
 * Kept pure (no SDK imports) so the mapping rules are unit-testable offline.
 */
import type { NormalizedEvent, NormalizedEventKind } from "@zosma-cowork/protocol";

/** Adapter-owned mapping: Pi native tags → normalized kinds. */
export const PI_EVENT_MAPPINGS: Array<{ kind: NormalizedEventKind; nativeTypes: string[] }> = [
  { kind: "message", nativeTypes: ["message_start", "message_update", "message_end"] },
  { kind: "tool", nativeTypes: ["tool_call", "tool_result", "tool_execution_start", "tool_execution_end", "tool_execution_update"] },
  { kind: "thinking", nativeTypes: ["thinking_update"] },
  { kind: "status", nativeTypes: ["turn_start", "turn_end", "queue_update", "model_select"] },
  { kind: "end", nativeTypes: ["agent_end", "agent_settled"] },
  { kind: "error", nativeTypes: ["error"] },
];

/** Incrementing per-turn event counter. */
export class SeqCounter {
  private next = 0;
  nextSeq(): number {
    return ++this.next;
  }
}

function record(e: unknown, key: string): Record<string, unknown> | undefined {
  const value = (e as Record<string, unknown> | undefined)?.[key];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/** Fresh text delta from a pi message event, or "" when absent. */
function textDelta(e: unknown): string {
  const delta = record(e, "delta");
  return typeof delta?.text === "string" ? delta.text : "";
}

/** Full assistant text carried by a terminal message event, or "". */
function fullText(e: unknown): string {
  const message = record(e, "message");
  if (message && typeof message.text === "string") return message.text;
  return typeof (e as { text?: unknown }).text === "string" ? (e as { text: string }).text : "";
}

/**
 * Map one native Pi event to a normalized event. Returns undefined for
 * unmapped tags (the adapter keeps its own seq/correlation bookkeeping).
 */
export function mapPiEvent(
  native: { type: string; [key: string]: unknown },
  cid: string,
  seq: number,
): NormalizedEvent | null {
  switch (native.type) {
    case "message_start":
      return { cid, seq, kind: "message", payload: { delta: "", text: "" } };
    case "message_update":
      return { cid, seq, kind: "message", payload: { delta: textDelta(native), thinking: typeof native.delta !== "undefined" ? (record(native, "delta")?.thinking ?? undefined) : undefined } };
    case "message_end":
      return { cid, seq, kind: "message", payload: { text: fullText(native) } };
    case "tool_call":
      return { cid, seq, kind: "tool", payload: { type: "call", name: native.name ?? "" } };
    case "tool_result":
    case "tool_execution_start":
    case "tool_execution_end":
    case "tool_execution_update":
      return { cid, seq, kind: "tool", payload: { type: "result", name: native.name ?? "" } };
    case "thinking_update":
      return { cid, seq, kind: "thinking", payload: { delta: typeof native.delta === "string" ? native.delta : "" } };
    case "turn_start":
    case "turn_end":
    case "queue_update":
    case "model_select":
      return { cid, seq, kind: "status", payload: { phase: native.type, ...(typeof native.queueSize === "number" ? { queueSize: native.queueSize } : {}) } };
    case "agent_end":
    case "agent_settled":
      return { cid, seq, kind: "end", payload: { stopReason: native.type === "agent_end" ? "end_turn" : "settled" } };
    case "error":
      return { cid, seq, kind: "error", payload: { message: typeof native.message === "string" ? native.message : "" } };
    default:
      return null;
  }
}