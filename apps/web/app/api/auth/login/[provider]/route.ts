import { NextResponse } from "next/server";
import { daemonConfig, daemonIpc, requireConfig } from "@/lib/daemon-client";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

type LoginEvent = Record<string, unknown>;

// POST /api/auth/login/[provider] — the UI relays a redirect URL / auth code
// for a pending manual-code prompt in the daemon's login session.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const { authId, token, code } = await req.json() as {
    authId?: string;
    token?: string;
    code?: string;
  };

  if (!authId || !token || !code) {
    return Response.json({ error: "authId, token and code required" }, { status: 400 });
  }

  try {
    const { status, body } = await daemonIpc({
      type: "auth:login-callback",
      authId,
      token,
      code,
      provider,
    });
    if (status >= 400) {
      return Response.json({ error: String(body.error ?? "callback failed") }, { status });
    }
    return Response.json({ ok: true, provider });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// GET /api/auth/login/[provider] — SSE stream for the OAuth flow.
// The daemon runs ModelRuntime.login; this route polls auth:login-status and
// forwards the queued events with the exact wire shape the UI expects
// (select_request / prompt_request / auth / device_code / progress /
// success / error / cancelled), terminating when the session is done.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  requireConfig();

  const encode = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  const encoder = new TextEncoder();
  const closed = new AbortController();
  req.signal.addEventListener("abort", () => closed.abort());

  const start = await daemonIpc({ type: "auth:login-start", provider });
  if (start.status >= 400) {
    return Response.json(
      { error: String(start.body.error ?? "login start failed") },
      { status: start.status },
    );
  }
  const authId = (start.body as { data?: { authId?: string } }).data?.authId;
  if (!authId) {
    return Response.json({ error: "login start failed: no authId" }, { status: 500 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: LoginEvent) => {
        try {
          controller.enqueue(encoder.encode(encode(event)));
        } catch {
          // controller already closed
        }
      };

      try {
        for (;;) {
          if (closed.signal.aborted) {
            void daemonIpc({ type: "auth:login-cancel", authId }).catch(() => {});
            break;
          }
          const { status, body } = await daemonIpc({ type: "auth:login-status", authId });
          if (status >= 400) {
            push({ type: "error", message: String(body.error ?? "login status failed") });
            break;
          }
          const data = (body as { data?: { events?: LoginEvent[]; done?: boolean; ok?: boolean; error?: string } }).data;
          for (const event of data?.events ?? []) push(event);
          if (data?.done) {
            if (data.ok) invalidateModelsCache();
            if (data.error) push({ type: "error", message: data.error });
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (e) {
        push({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      closed.abort();
      void daemonIpc({ type: "auth:login-cancel", authId }).catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}