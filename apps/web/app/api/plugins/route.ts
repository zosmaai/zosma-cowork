import { NextResponse } from "next/server";
import { legacyDaemonError, piRead } from "@/lib/daemon-client";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

const PLUGIN_ACTIONS: ReadonlySet<string> = new Set<PluginAction>([
  "install",
  "remove",
  "update",
  "disable",
  "enable",
]);

// GET /api/plugins?cwd=<path> — relay to daemon read:plugins-list. The daemon
// resolves packages through its settings + package-manager flow (resource
// counts, disabled state, version metadata, diagnostics).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    return NextResponse.json(await piRead("plugins-list", { cwd }));
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}

// POST /api/plugins — body: { action, source, scope, cwd }. Relay to daemon
// read:plugins-manage; the daemon performs the package-manager mutation,
// enforces the project-trust + root gates, and re-reads the listing (the
// response is the full updated PluginsResponse, as before).
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      action?: string;
      source?: string;
      scope?: string;
      cwd?: string;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });
    if (!PLUGIN_ACTIONS.has(body.action)) {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }
    const source = body.source?.trim();
    if (body.action !== "update" && !source) {
      return NextResponse.json({ error: "source required" }, { status: 400 });
    }
    return NextResponse.json(
      await piRead("plugins-manage", {
        action: body.action,
        source,
        scope: body.scope,
        cwd: body.cwd,
      }),
    );
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}
