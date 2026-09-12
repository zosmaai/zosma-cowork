import { NextResponse } from "next/server";
import { legacyDaemonError, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// POST /api/skills/check  body: { cwd: string; package?: string; scope?: "global" | "project" }
// Relay to daemon read:skills-check (update-availability via the ported
// skill-updates service; package/scope narrow to one install).
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; package?: unknown; scope?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const pkg = typeof body.package === "string" ? body.package : undefined;
    const scope = body.scope === "global" || body.scope === "project" ? body.scope : undefined;
    return NextResponse.json(
      await piRead("skills-check", { cwd, package: pkg, scope }),
    );
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}
