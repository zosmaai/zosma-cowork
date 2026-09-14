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
  // pi-ai streams deltas inside the update event (assistantMessageEvent),
  // e.g. { type: "text_delta", delta: "..." }. Older transports put the
  // raw delta object directly on the event.
  const ame = record(e, "assistantMessageEvent");
  if (ame && typeof ame.delta === "string") return ame.delta;
  const delta = record(e, "delta");
  return typeof delta?.text === "string" ? delta.text : "";
}

/** Content index of the streaming block, or undefined for the legacy path. */
function messageContentIndex(e: unknown): number | undefined {
  const ame = record(e, "assistantMessageEvent");
  if (ame && typeof ame.contentIndex === "number") return ame.contentIndex;
  return undefined;
}

/** Which block the delta targets: "text" | "thinking" | "toolcall". */
function messageDeltaKind(e: unknown): "text" | "thinking" | "toolcall" | undefined {
  const ame = record(e, "assistantMessageEvent");
  const t = ame?.type;
  if (typeof t !== "string") return undefined;
  if (t.startsWith("text")) return "text";
  if (t.startsWith("thinking")) return "thinking";
  if (t.startsWith("toolcall")) return "toolcall";
  return undefined;
}

/** Fresh thinking delta from a pi message event, or "" when absent. */
function thinkingDelta(e: unknown): string {
  const ame = record(e, "assistantMessageEvent");
  if (ame && typeof ame.thinking === "string") return ame.thinking;
  const delta = record(e, "delta");
  return typeof delta?.thinking === "string" ? delta.thinking : "";
}

/** Full assistant text carried by a terminal message event, or "". */
function fullText(e: unknown): string {
  // message_end carries the finalized AgentMessage: text lives in
  // content[].text blocks (pi-ai shape), fall back to .text strings.
  const message = record(e, "message");
  if (message) {
    const content = message.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
        }
      }
      if (parts.length > 0) return parts.join("");
    }
    if (typeof message.text === "string") return message.text;
  }
  return typeof (e as { text?: unknown }).text === "string" ? (e as { text: string }).text : "";
}

/** Role carried by a terminal message event ("user" | "assistant" | "toolResult"). */
function messageRole(e: unknown): "user" | "assistant" | "toolResult" | undefined {
  const message = record(e, "message");
  const role = message?.role;
  return role === "user" || role === "assistant" || role === "toolResult" ? role : undefined;
}

/** Final content block array from a terminal message event (thinking + text, etc.). */
function messageContent(e: unknown): Array<Record<string, unknown>> | undefined {
  const message = record(e, "message");
  const content = message?.content;
  return Array.isArray(content) ? (content as Array<Record<string, unknown>>) : undefined;
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
      return {
        cid,
        seq,
        kind: "message",
        payload: {
          delta: textDelta(native),
          // The UI reducer needs the true content block index (pi orders
          // assistant content [thinking, text], so text is not always 0) and
          // the block kind, so the bridge can reconstruct *_start framing.
          contentIndex: messageContentIndex(native),
          deltaKind: messageDeltaKind(native),
          thinking: typeof native.delta !== "undefined" || record(native, "assistantMessageEvent") !== undefined ? (thinkingDelta(native) || undefined) : undefined,
        },
      };
    case "message_end":
      return {
        cid,
        seq,
        kind: "message",
        payload: {
          // Carry the full finalized native message so the web bridge commits
          // a shape-identical object to what loadSession reloads from the
          // session file (model, timestamp, usage, id). Otherwise the commit
          // is partial and the reconcile swap causes a layout flicker.
          message: record(native, "message"),
          text: fullText(native),
          role: messageRole(native),
          content: messageContent(native),
        },
      };
    case "tool_call":
      return { cid, seq, kind: "tool", payload: { type: "call", name: native.name ?? "" } };
    case "tool_result":
    case "tool_execution_start":
    case "tool_execution_end":
    case "tool_execution_update":
      return { cid, seq, kind: "tool", payload: { type: "result", name: native.name ?? "" } };
    case "thinking_update":
      return { cid, seq, kind: "thinking", payload: { delta: thinkingDelta(native) || (typeof native.delta === "string" ? native.delta : "") } };
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