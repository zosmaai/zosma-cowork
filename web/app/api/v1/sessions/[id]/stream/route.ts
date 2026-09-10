import { createAgentEventStream } from "@/lib/agent-event-stream";
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiErrorResponse } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

// POST /api/v1/sessions/{id}/stream — SSE of agent output (tokens, thinking,
// tool-call events). Transport-neutral boundary reuses the exact same streaming
// primitive the UI uses, so wire output matches UI parity. Abort/steer/followUp
// operate on the same live wrapper that owns this event channel, so they flow
// through the stream and stay isolated per session.
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  try {
    const session = await getPiBackend().getSessionStream(id);
    const stream = createAgentEventStream(req, id, Promise.resolve(session));
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
