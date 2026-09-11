import { NextResponse } from "next/server";
import { daemonConfig, piCommand, piList, piResume } from "@/lib/daemon-client";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

// POST /api/sessions/[id]/auto-name — generate a session title via the daemon.
//
// Client cutover: title generation runs a temporary shadow Agent that shares
// the source session's provider config. It moved into the daemon (auto_name
// command) so the web process never spawns a Pi session. The daemon must have
// the session live; if it is cold (file exists but not live) we resume it
// first, mirroring the old in-process wake-up semantics.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    if (!daemonConfig()) {
      return NextResponse.json(
        { error: "Daemon not configured" },
        { status: 503 },
      );
    }

    let live = false;
    try {
      live = (await piList()).some((s) => s.sessionId === id || s.nativeSessionId === id);
    } catch {
      // Daemon down — fall through; piCommand below surfaces the error.
    }

    if (!live) {
      const filePath = await resolveSessionPath(id);
      if (!filePath) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 },
        );
      }
      await piResume(id, filePath);
    }

    const result = (await piCommand(id, { type: "auto_name" })) as {
      title?: string;
      usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number } | null;
    };
    return NextResponse.json({ title: result.title, usage: result.usage ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof Error && error.message.includes("unknown session") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}