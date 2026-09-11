import { daemonConfig, daemonStream, piList, piResume } from "@/lib/daemon-client";
import { createDaemonAgentEventStream } from "@/lib/daemon-agent-stream";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

// GET /api/agent/[id]/events - SSE stream of agent events.
//
// Client cutover: the daemon owns the live session, so this route opens a
// daemon `/ipc/stream` watch and bridges its normalized frames back to the
// browser's agent-event wire contract (see daemon-agent-stream.ts). When the
// session is not live yet but its file exists, we ask the daemon to resume it
// first (same wake-up the old in-process runtime performed), keeping
// connection-level spawn semantics.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  try {
    const configured = daemonConfig();
    if (!configured) {
      return new Response("Daemon not configured", { status: 503 });
    }

    let live = false;
    try {
      const sessions = await piList(configured);
      live = sessions.some((s) => s.sessionId === id);
    } catch {
      // Daemon down — fall through to the stream attempt; it will surface the
      // real error below.
    }

    if (!live && !req.signal.aborted) {
      const filePath = await resolveSessionPath(id);
      if (!filePath) {
        return new Response("Session not found", { status: 404 });
      }
      await piResume(id, filePath, configured);
    }

    if (req.signal.aborted) return new Response(null, { status: 204 });

    const upstream = await daemonStream(
      { type: "pi:stream", sessionId: id },
      configured,
    );
    if (!upstream.ok || !upstream.body) {
      if (upstream.status === 404 || upstream.status === 400) {
        return new Response("Session not found", { status: 404 });
      }
      return new Response(`Daemon stream ${upstream.status}`, { status: 502 });
    }

    const stream = createDaemonAgentEventStream(req, { sessionId: id }, upstream.body);
    return new Response(stream, { headers: SSE_HEADERS });
  } catch {
    // Unknown-session resume failures etc. surface as a plain 404 reconnect
    // signal; the EventSource retry loop will reattach once the daemon knows
    // the session (e.g. after /api/agent/[id] resumes it on prompt).
    return new Response("Session not found", { status: 404 });
  }
}