import { NextResponse } from "next/server";
import { deleteSession, getSessionDetails, renameSession } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = new URL(req.url).searchParams;
  try {
    const details = await getSessionDetails({
      sessionId: id,
      deferThinking: searchParams.has("deferThinking"),
      deferMedia: searchParams.has("deferMedia"),
    });
    return NextResponse.json(details);
  } catch (error) {
    const mapped = backendErrorResponse(error);
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
    await renameSession({ sessionId: id, name: name as string });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = backendErrorResponse(error);
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
    await deleteSession({ sessionId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
