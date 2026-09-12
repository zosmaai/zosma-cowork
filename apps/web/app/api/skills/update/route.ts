import { NextResponse } from "next/server";
import { legacyDaemonError, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// POST /api/skills/update  body: { cwd: string; package: string; scope: "global" | "project" }
// Relay to daemon read:skills-update (npx update + refreshed listing).
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; package?: unknown; scope?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const pkg = typeof body.package === "string" ? body.package : "";
    const scope = body.scope === "global" || body.scope === "project" ? body.scope : undefined;
    if (!cwd || !pkg || !scope) {
      return NextResponse.json({ error: "cwd, package, and scope are required" }, { status: 400 });
    }
    return NextResponse.json(
      await piRead("skills-update", { source: pkg, scope, cwd }),
    );
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}
