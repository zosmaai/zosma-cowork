import { NextResponse } from "next/server";
import { autoNameSession } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await autoNameSession({ sessionId: id });
    return NextResponse.json({ title: result.title, usage: result.usage ?? null });
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
