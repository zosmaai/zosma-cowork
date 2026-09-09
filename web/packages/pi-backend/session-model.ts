import { BackendError } from "./errors";
import type { RuntimeManager } from "./runtime-manager";
import type { AgentSessionWrapper } from "./runtime";
import type { ModelState, UpdateModelRequest } from "./contracts";

// Transport-neutral session model/thinking surface. The /api/v1
// sessions/[id]/model route wires these into the pi-backend facade so a
// headless client can read, select, and reconfigure a session's model +
// thinking-level — no UI/server-only imports here.

// Resolve the live wrapper for a session, or reject with session_not_found.
// Like streaming, the session must already exist in the runtime registry.
async function resolveLiveWrapper(
  sessionId: string,
  runtime: RuntimeManager,
): Promise<AgentSessionWrapper> {
  const wrapper = runtime.getSession(sessionId);
  if (!wrapper?.isAlive()) {
    throw new BackendError("session_not_found", "Session not found");
  }
  return wrapper;
}

export async function getSessionModel(
  sessionId: string,
  runtime: RuntimeManager,
): Promise<ModelState> {
  const wrapper = await resolveLiveWrapper(sessionId, runtime);
  const state = (await wrapper.send({ type: "get_state" })) as {
    model?: { id: string; provider: string };
    thinkingLevel?: string;
  } | undefined;
  return {
    model: state?.model ?? null,
    thinkingLevel: state?.thinkingLevel ?? "off",
  };
}

export async function configureModel(
  sessionId: string,
  patch: UpdateModelRequest,
  runtime: RuntimeManager,
): Promise<ModelState> {
  const wrapper = await resolveLiveWrapper(sessionId, runtime);

  // set_model resolves the model via the wrapper's runtime, retrying once;
  // a genuine miss surfaces as model_not_found rather than a raw SDK error.
  if (patch.model) {
    try {
      await wrapper.send({ type: "set_model", ...patch.model });
    } catch (error) {
      throw new BackendError("model_not_found", error instanceof Error ? error.message : String(error));
    }
  }
  if (typeof patch.thinkingLevel === "string") {
    await wrapper.send({ type: "set_thinking_level", level: patch.thinkingLevel });
  }
  // Re-read so the response reflects exactly what the wrapper applied
  // (set_thinking_level clamps xhigh→high on models that cannot support it).
  return getSessionModel(sessionId, runtime);
}
