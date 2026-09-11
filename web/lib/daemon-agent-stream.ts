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
      const toolIds: string[] = []; // name-suffixed ids of open tool calls
      let toolCounter = 0;
      let closed = false;

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
            const delta = typeof payload.delta === "string" ? payload.delta : undefined;
            const thinking = typeof payload.thinking === "string" ? payload.thinking : undefined;
            if (text !== "") {
              // Terminal message frame.
              enqueue({
                type: "message_end",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text }],
                },
              });
              messageOpen = false;
              break;
            }
            if (delta === undefined) break; // bare message_start placeholder
            if (!messageOpen) {
              messageOpen = true;
              enqueue({
                type: "message_start",
                message: { role: "assistant", content: [] },
              });
            }
            enqueue({
              type: "message_update",
              assistantMessageEvent: { type: "text_delta", delta },
            });
            if (thinking && thinking !== "") {
              enqueue({
                type: "message_update",
                assistantMessageEvent: { type: "thinking_delta", thinking },
              });
            }
            break;
          }
          case "thinking": {
            if (!messageOpen) break;
            const delta = typeof payload.delta === "string" ? payload.delta : "";
            if (delta === "") break;
            enqueue({
              type: "message_update",
              assistantMessageEvent: { type: "thinking_delta", thinking: delta },
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