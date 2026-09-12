import { NextResponse } from "next/server";
import { daemonToBackend, piRead } from "@/lib/daemon-client";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  try {
    const result = await piRead("session-thinking", {
      sessionId: id,
      entryId,
      blockIndex: blockIndexParam === null ? undefined : Number(blockIndexParam),
    });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = backendErrorResponse(daemonToBackend(error) ?? error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
