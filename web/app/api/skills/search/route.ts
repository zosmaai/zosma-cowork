import { NextResponse } from "next/server";
import { legacyDaemonError, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// POST /api/skills/search  body: { query: string, limit?: number }
// Relay to daemon read:skills-search (skills.sh API with `npx skills find`
// fallback, same limit clamping).
export async function POST(req: Request) {
  try {
    const body = await req.json() as { query?: string; limit?: unknown };
    if (!body.query?.trim()) return NextResponse.json({ error: "query required" }, { status: 400 });
    return NextResponse.json(
      await piRead("skills-search", { query: body.query.trim(), limit: body.limit }),
    );
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}
