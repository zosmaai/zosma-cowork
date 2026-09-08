import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  try {
    const context = await getSessionContext({
      sessionId: id,
      leafId: url.searchParams.get("leafId") ?? undefined,
      deferThinking: url.searchParams.has("deferThinking"),
      deferMedia: url.searchParams.has("deferMedia"),
    });
    return NextResponse.json({ context });
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
