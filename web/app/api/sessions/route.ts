import { NextResponse } from "next/server";
import { daemonToBackend, piRead } from "@/lib/daemon-client";
import { backendErrorResponse } from "@/lib/backend-error-response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const result = await piRead("list-sessions", { force });
    return NextResponse.json(
      result,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const mapped = backendErrorResponse(daemonToBackend(error) ?? error);
    if (mapped) return mapped;
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
