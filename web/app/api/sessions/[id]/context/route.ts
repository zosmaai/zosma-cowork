import { NextResponse } from "next/server";
import { daemonToBackend, piRead } from "@/lib/daemon-client";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  try {
    const context = await piRead("session-context", {
      sessionId: id,
      leafId: url.searchParams.get("leafId") ?? undefined,
      deferThinking: url.searchParams.has("deferThinking"),
      deferMedia: url.searchParams.has("deferMedia"),
    });
    return NextResponse.json({ context });
  } catch (error) {
    const mapped = backendErrorResponse(daemonToBackend(error) ?? error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
