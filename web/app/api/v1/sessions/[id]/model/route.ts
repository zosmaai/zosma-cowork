import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { DaemonError, daemonConfig, piCommand, piList } from "@/lib/daemon-client";
import { BackendError } from "@/lib/backend-errors";
import type { UpdateModelRequest } from "@/lib/api-contracts";

export const dynamic = "force-dynamic";

// GET  /api/v1/sessions/{id}/model  — current model + thinking level
// PATCH /api/v1/sessions/{id}/model  — select model and/or change thinking-level
//
// Client cutover: the daemon owns live sessions, so this route speaks to the
// daemon's get_state / set_model / set_thinking_level commands. session_not_found
// when the daemon does not know the session (same contract as the old
// live-wrapper-only surface).

type DaemonState = {
  model?: { id?: string; provider?: string };
  thinkingLevel?: string;
};

function toModelState(state: DaemonState) {
  return {
    model: state.model?.provider && state.model.id
      ? { id: state.model.id, provider: state.model.provider }
      : null,
    thinkingLevel: state.thinkingLevel ?? "off",
  };
}

/** Daemon 400 unknown-session errors become session_not_found; keep others. */
function unwrapUnknownSession(error: unknown): never {
  if (error instanceof DaemonError) {
    throw new BackendError("session_not_found", error.message);
  }
  throw error;
}

async function isLive(id: string): Promise<boolean> {
  const sessions = await piList();
  return sessions.some((s) => s.sessionId === id);
}

async function readBody(req: Request): Promise<UpdateModelRequest> {
  if (!req.body) return {};
  try {
    return (await req.json()) as UpdateModelRequest;
  } catch {
    return {};
  }
}

function requireDaemon(): void {
  if (!daemonConfig()) {
    throw new BackendError(
      "startup_failed",
      "Daemon not configured — start it with `npm run dev:all`",
    );
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    requireDaemon();
    if (!(await isLive(id))) {
      throw new BackendError("session_not_found", "Session not found");
    }
    let state: DaemonState;
    try {
      state = (await piCommand(id, { type: "get_state" })) as DaemonState;
    } catch (error) {
      unwrapUnknownSession(error);
    }
    return apiSuccess(toModelState(state!));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    requireDaemon();
    if (!(await isLive(id))) {
      throw new BackendError("session_not_found", "Session not found");
    }
    const patch = await readBody(req);
    if (patch.model) {
      try {
        await piCommand(id, { type: "set_model", ...patch.model });
      } catch (error) {
        if (error instanceof DaemonError) {
          throw new BackendError("model_not_found", error.message);
        }
        throw error;
      }
    }
    if (typeof patch.thinkingLevel === "string") {
      try {
        await piCommand(id, { type: "set_thinking_level", level: patch.thinkingLevel });
      } catch (error) {
        unwrapUnknownSession(error);
      }
    }
    let state: DaemonState;
    try {
      state = (await piCommand(id, { type: "get_state" })) as DaemonState;
    } catch (error) {
      unwrapUnknownSession(error);
    }
    return apiSuccess(toModelState(state!));
  } catch (error) {
    return apiErrorResponse(error);
  }
}