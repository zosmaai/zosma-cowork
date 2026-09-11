import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { DaemonError, piList, piCommand } from "@/lib/daemon-client";
import { resolveSessionPath } from "@/lib/session-reader";
import { BackendError } from "@/lib/backend-errors";

// GET /api/v1/agent/{id}/state — daemon-backed (cutover). A session is
// "running" only when the daemon has it live; agent state comes from the
// advanced-control surface (`pi:command get_state`) on the daemon session.
// Unknown sessions (no daemon entry AND no session file) keep the 404
// session_not_found client contract; persisted-but-cold sessions are
// running:false.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sessions = await piList();
    if (!sessions.some((s) => s.sessionId === id)) {
      if (!(await resolveSessionPath(id))) {
        return apiErrorResponse(new BackendError("session_not_found", `Session not found: ${id}`));
      }
      return apiSuccess({ running: false });
    }
    const state = await piCommand(id, { type: "get_state" });
    return apiSuccess({ running: true, state });
  } catch (error) {
    if (error instanceof DaemonError) {
      return apiErrorResponse(new BackendError("startup_failed", error.message));
    }
    return apiErrorResponse(error);
  }
}