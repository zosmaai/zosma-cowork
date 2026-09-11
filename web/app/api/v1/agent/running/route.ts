import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { DaemonError, piList } from "@/lib/daemon-client";
import { BackendError } from "@/lib/backend-errors";

export const dynamic = "force-dynamic";

// GET /api/v1/agent/running — daemon-backed (cutover): the daemon owns the
// live session set now, so running ids come from `pi:list`, not the web's
// in-process runtime. 503 when the daemon is absent (start it with dev:all).
export async function GET() {
  try {
    const sessions = await piList();
    const runningSessionIds = sessions
      .filter((s) => s.state === "running")
      .map((s) => s.sessionId);
    return apiSuccess({ runningSessionIds }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof DaemonError) {
      return apiErrorResponse(new BackendError("startup_failed", error.message));
    }
    return apiErrorResponse(error);
  }
}