import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { daemonToBackend, piRead } from "@/lib/daemon-client";
import { BackendError } from "@/lib/backend-errors";

export const dynamic = "force-dynamic";

// Plugin management surface over /api/v1 (ZOS-82), relayed to the daemon:
// list installed extensions/skills/prompts/themes, or install/update/remove/
// disable/enable a package. The file-access + project-trust gating lives in
// the daemon's read:plugins-* ops.

const PLUGIN_ACTIONS = new Set<string>(["install", "remove", "update", "disable", "enable"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd") ?? undefined;
  try {
    return apiSuccess(await piRead("plugins-list", { cwd }));
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}

// POST /api/v1/plugins body: { action, source?, scope?, cwd }
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      action?: string;
      source?: string;
      scope?: string;
      cwd?: string;
    };
    if (!body.action || !PLUGIN_ACTIONS.has(body.action)) {
      return apiErrorResponse(
        new BackendError("invalid_request", `unsupported plugin action: ${body.action}`),
      );
    }
    return apiSuccess(
      await piRead("plugins-manage", {
        action: body.action,
        source: body.source,
        scope: body.scope,
        cwd: body.cwd,
      }),
    );
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}
