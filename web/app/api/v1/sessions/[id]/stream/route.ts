import { apiErrorResponse } from "@/lib/api-envelope";
import { DaemonError, daemonStream } from "@/lib/daemon-client";
import { BackendError } from "@/lib/backend-errors";

export const dynamic = "force-dynamic";

// POST /api/v1/sessions/{id}/stream — SSE of agent output.
//
// Client cutover: the daemon owns the live session, so this route relays the
// daemon's `/ipc/stream` (watch mode: hold until the current/next turn ends)
// byte-for-byte back to the browser. The browser's client contract is
// unchanged (`data:` frames of agent events); session history still comes
// from the web's file read (`/api/v1/sessions/{id}/context`), which needs no
// live runtime. Aborting the browser connection cancels the daemon watch.
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  try {
    // Watch mode: no embedded turn, the daemon pushes live events only.
    const upstream = await daemonStream({ type: "pi:stream", sessionId: id });
    if (!upstream.ok || !upstream.body) {
      throw new DaemonError(
        `Daemon stream ${upstream.status}`,
        upstream.status,
        "daemon_stream_failed",
      );
    }
    const relay = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const upstreamReader = upstream.body!.getReader();
        const abortHandler = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        };
        req.signal.addEventListener("abort", abortHandler, { once: true });

        void (async () => {
          try {
            for (;;) {
              const { done, value } = await upstreamReader.read();
              if (done || closed) break;
              controller.enqueue(value);
            }
          } catch {
            /* upstream dropped */
          } finally {
            if (!closed) {
              closed = true;
              try { controller.close(); } catch { /* already closed */ }
            }
          }
        })();
      },
      cancel() {
        // Client went away — signal the daemon watch is over.
      },
    });
    return new Response(relay, { headers: SSE_HEADERS });
  } catch (error) {
    // Daemon 404 = unknown session. Preserve the pre-cutover client contract
    // (session_not_found) instead of leaking the daemon's wire status.
    if (error instanceof DaemonError && error.status === 404) {
      return apiErrorResponse(new BackendError("session_not_found", "Session not found"));
    }
    return apiErrorResponse(error);
  }
}