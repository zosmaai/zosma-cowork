// Bridge between the daemon's normalized event stream and the browser's
// agent-event wire contract (`/api/agent/[id]/events` consumers in
// hooks/useAgentSession). Built for roadmap item 6: the daemon owns live
// sessions and emits coarse NormalizedEvents ({cid, seq, kind, payload}),
// while the UI parses fine-grained wire events (message_start/update/end,
// tool_execution_*, agent_end/settled, ...). This module re-synthesizes the
// wire shapes from the normalized frames — no in-process Pi runtime needed.

export interface DaemonStreamOptions {
  sessionId: string;
}

type NormalizedFrame = {
  cid?: string;
  seq?: number;
  kind?: string;
  payload?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pipe daemon `/ipc/stream` SSE bytes (normalized frames) into the browser
 * SSE contract byte stream. Emits `connected` first, then translated wire
 * events, dropping heartbeats and unrepresentable status frames.
 */
export function createDaemonAgentEventStream(
  req: Request,
  { sessionId }: DaemonStreamOptions,
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let buffer = "";
      let bufferStart = 0;
      let connectedSent = false;
      let messageOpen = false;
      const startedBlocks = new Set<number>(); // content indexes already *_start'ed
      const toolIds: string[] = []; // name-suffixed ids of open tool calls
      let toolCounter = 0;
      let closed = false;

      const resetBlockState = () => startedBlocks.clear();

      // Emit a *_start for a content block if its delta has not arrived yet.
      // The reducer's updateContentBlock only mutates an EXISTING block, so a
      // delta at an uninitialized index is dropped (returns null). Framing
      // *_start first guarantees the block exists before its first delta.
      const emitBlockStart = (contentIndex: number, kind: unknown) => {
        if (startedBlocks.has(contentIndex)) return;
        const blockKind =
          kind === "thinking" || kind === "toolcall" ? kind : "text";
        startedBlocks.add(contentIndex);
        enqueue({
          type: "message_update",
          assistantMessageEvent: { type: `${blockKind}_start`, contentIndex },
        });
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        req.signal.removeEventListener("abort", abortHandler);
        void upstream.cancel().catch(() => {});
        try { controller.close(); } catch { /* already closed */ }
      };
      const abortHandler = () => cleanup();

      req.signal.addEventListener("abort", abortHandler, { once: true });

      const enqueue = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Readiness must not wait for the first real frame: an idle session
      // never emits one (only dropped heartbeats), leaving the client's
      // ensureConnected() pending forever. Emit `connected` immediately so
      // the send path proceeds and the response starts flushing.
      connectedSent = true;
      enqueue({ type: "connected", sessionId, isStreaming: false });

      // The wire contract the UI expects mirrors the old in-process stream:
      // a `connected` frame arrives first, then agent event frames.
      const ensureConnected = () => {
        if (!connectedSent) {
          connectedSent = true;
          enqueue({ type: "connected", sessionId, isStreaming: false });
        }
      };

      const translate = (frame: NormalizedFrame) => {
        const kind = frame.kind;
        const payload = isRecord(frame.payload) ? frame.payload : {};
        switch (kind) {
          case "message": {
            const text = typeof payload.text === "string" ? payload.text : "";
            if (text !== "" || (Array.isArray(payload.content) && payload.content.length > 0)) {
              // Terminal message frame. pi emits message_end for BOTH the user
              // prompt and the assistant reply. Prefer the full canonical
              // message when present (it matches what loadSession reloads from
              // the session file, so commit->reconcile is shape-identical and
              // does not cause a partial->full layout shift); otherwise fall
              // back to carrying the real role + content so the user frame is
              // not mistaken for an assistant reply (a phantom echo bubble).
              const fullMessage = isRecord(payload.message) ? payload.message : undefined;
              const role = payload.role === "user" || payload.role === "toolResult"
                ? payload.role
                : "assistant";
              const content = Array.isArray(payload.content) && payload.content.length > 0
                ? payload.content
                : [{ type: "text", text }];
              enqueue({
                type: "message_end",
                message: fullMessage ?? { role, content },
              });
              messageOpen = false;
              resetBlockState();
              break;
            }
            const deltaKind = payload.deltaKind as "text" | "thinking" | "toolcall" | undefined;
            const delta = typeof payload.delta === "string" ? payload.delta : undefined;
            const thinking = typeof payload.thinking === "string" ? payload.thinking : undefined;
            const hasDelta = (delta !== undefined && delta !== "") || (thinking !== undefined && thinking !== "");
            if (!hasDelta) break; // bare message_start placeholder
            if (!messageOpen) {
              messageOpen = true;
              enqueue({
                type: "message_start",
                message: { role: "assistant", content: [] },
              });
            }
            // The reducer's updateContentBlock only mutates an EXISTING
            // content block; a delta at an uninitialized index returns null
            // and is dropped. Use the block's true pi content index (mapping
            // passes it through) and its kind to schedule *_start so the block
            // exists before its first delta appends.
            const contentIndex =
              typeof payload.contentIndex === "number" ? payload.contentIndex : 0;
            if (thinking !== undefined && thinking !== "" && deltaKind !== "text") {
              emitBlockStart(contentIndex, "thinking");
              enqueue({
                type: "message_update",
                assistantMessageEvent: { type: "thinking_delta", thinking, contentIndex },
              });
              break;
            }
            if (delta !== undefined && delta !== "") {
              const kind = deltaKind === "thinking" || deltaKind === "toolcall" ? deltaKind : "text";
              emitBlockStart(contentIndex, kind);
              enqueue({
                type: "message_update",
                assistantMessageEvent: { type: `${kind}_delta`, delta, contentIndex },
              });
            }
            break;
          }
          case "thinking": {
            if (!messageOpen) break;
            const delta = typeof payload.delta === "string" ? payload.delta : "";
            if (delta === "") break;
            const contentIndex =
              typeof payload.contentIndex === "number" ? payload.contentIndex : 1;
            emitBlockStart(contentIndex, "thinking");
            enqueue({
              type: "message_update",
              assistantMessageEvent: { type: "thinking_delta", thinking: delta, contentIndex },
            });
            break;
          }
          case "tool": {
            const name = typeof payload.name === "string" ? payload.name : "tool";
            if (payload.type === "call") {
              const id = `${name}#${++toolCounter}`;
              toolIds.push(id);
              enqueue({ type: "tool_execution_start", toolCallId: id, toolName: name });
            } else {
              const last = [...toolIds].reverse().find((id) => id.startsWith(`${name}#`));
              if (last) {
                enqueue({ type: "tool_execution_end", toolCallId: last });
                toolIds.splice(toolIds.indexOf(last), 1);
              }
            }
            break;
          }
          case "end": {
            const stopReason = typeof payload.stopReason === "string" ? payload.stopReason : "";
            enqueue({ type: stopReason === "settled" ? "agent_settled" : "agent_end" });
            messageOpen = false;
            resetBlockState();
            toolIds.length = 0;
            break;
          }
          case "error": {
            const message = typeof payload.message === "string" ? payload.message : "Agent failed";
            enqueue({ type: "prompt_error", errorMessage: message });
            messageOpen = false;
            break;
          }
          case "status":
            // turn_start/turn_end/queue_update/model_select — nothing the UI
            // wire needs; skip.
            break;
          default:
            break;
        }
      };

      const consume = (chunk: Uint8Array) => {
        buffer += decoder.decode(chunk, { stream: true });
        // SSE frame boundary is a blank line; daemon writes one event per frame.
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n", bufferStart)) !== -1) {
          const frame = buffer.slice(bufferStart, boundary);
          bufferStart = boundary + 2;
          const trimmed = frame.replace(/\r/g, "").trim();
          if (trimmed.startsWith(":")) continue; // heartbeat
          const dataLine = trimmed.startsWith("data:")
            ? trimmed.slice(5).trim()
            : trimmed;
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine) as unknown;
            if (isRecord(parsed)) {
              ensureConnected();
              translate(parsed);
            }
          } catch {
            // Malformed frame — skip, keep the stream alive.
          }
        }
      };

      void (async () => {
        const reader = upstream.getReader();
        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            consume(value);
          }
        } catch {
          // Abort or upstream failure — close gracefully.
        } finally {
          if (bufferStart > 0) buffer = "";
          if (!closed) {
            // Upstream ended without a terminal frame: emit a synthetic end
            // so the UI's grace/close logic converges.
            ensureConnected();
            translate({ kind: "end", payload: { stopReason: "end_turn" } });
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          }
        }
      })();

      // An idle daemon watch stays open forever via `:` heartbeats, which is
      // the desired semantics — no extra timeout needed.
    },
  });
}