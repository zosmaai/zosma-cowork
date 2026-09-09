import { BackendError } from "./errors";
import type { RuntimeManager } from "./runtime-manager";

// Transport-neutral streaming surface. The /api/v1 streaming route wires this
// handle into web/lib/agent-event-stream.ts (SSE) so a headless client receives
// the exact same agent events the UI consumes — no UI/server-only imports here.

export interface StreamingEvent {
  type: string;
  [key: string]: unknown;
}

export interface StreamingSessionHandle {
  readonly isStreaming: boolean;
  readonly streamingMessage: unknown;
  onEvent(listener: (event: StreamingEvent) => void): () => void;
}

// Resolve the live wrapper for a session, or reject with session_not_found.
// A session must already be running in the runtime registry — the v1 boundary
// exposes streaming, not session creation. Concurrency isolation falls out of
// runtime.getSession: each wrapper owns its own event channel and registry slot.
export async function getSessionStream(
  sessionId: string,
  runtime: RuntimeManager,
): Promise<StreamingSessionHandle> {
  const wrapper = runtime.getSession(sessionId);
  if (!wrapper?.isAlive()) {
    throw new BackendError("session_not_found", "Session not found");
  }
  return wrapper as unknown as StreamingSessionHandle;
}
