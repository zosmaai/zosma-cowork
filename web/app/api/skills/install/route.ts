import { NextResponse } from "next/server";
import { legacyDaemonError, piRead } from "@/lib/daemon-client";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// POST /api/skills/install  body: { package: string; scope: "global" | "project"; cwd?: string }
// Relay to daemon read:skills-install — the daemon runs `npx skills add` with
// the same args/timeout and enforces the project-scope gates (file-access
// roots + project trust) itself.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { package?: string; scope?: string; cwd?: string };
    if (!body.package?.trim()) return NextResponse.json({ error: "package required" }, { status: 400 });
    return NextResponse.json(
      await piRead("skills-install", {
        source: body.package.trim(),
        scope: body.scope,
        cwd: body.cwd,
      }),
    );
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}
