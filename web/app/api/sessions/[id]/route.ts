import { NextResponse } from "next/server";
import { daemonConfig, daemonToBackend, piClose, piList, piRead } from "@/lib/daemon-client";
import { backendErrorResponse } from "@/lib/backend-error-response";

// Session details (daemon read), rename (daemon read), delete (close live
// session on the daemon first, then delete the session file on the daemon).

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = new URL(req.url).searchParams;
  try {
    const details = await piRead("session-details", {
      sessionId: id,
      deferThinking: searchParams.has("deferThinking"),
      deferMedia: searchParams.has("deferMedia"),
    });
    return NextResponse.json(details);
  } catch (error) {
    const mapped = backendErrorResponse(daemonToBackend(error) ?? error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: unknown };
    if (typeof name !== "string" || !name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    await piRead("session-rename", { sessionId: id, name });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = backendErrorResponse(daemonToBackend(error) ?? error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Live sessions are daemon-owned; close on the daemon first so its
    // SessionStore mapping dies with the session, then delete the file.
    try {
      if (daemonConfig()) {
        const live = (await piList()).some((s) => s.sessionId === id || s.nativeSessionId === id);
        if (live) await piClose(id);
      }
    } catch {
      // Daemon down — deletion still proceeds; the file is authoritative.
    }
    await piRead("session-delete", { sessionId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = backendErrorResponse(daemonToBackend(error) ?? error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
