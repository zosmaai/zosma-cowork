import { NextResponse } from "next/server";
import { getSessionThinking } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  try {
    const result = await getSessionThinking({
      sessionId: id,
      entryId,
      blockIndex: blockIndexParam === null ? Number.NaN : Number(blockIndexParam),
    });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
