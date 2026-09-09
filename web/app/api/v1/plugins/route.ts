import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { BackendError } from "@/packages/pi-backend/errors";
import type { PluginAction, PluginScope } from "@/packages/pi-backend/contracts";

export const dynamic = "force-dynamic";

// Plugin management surface over /api/v1 (ZOS-82): list installed
// extensions/skills/prompts/themes, or install/update/remove/disable/enable a
// package through the transport-neutral pi-backend facade. The handler is
// transport-neutral — no NextResponse, no spawn, no SDK import. The
// file-access + project-trust gating lives in the pi-backend facade.

const PLUGIN_ACTIONS = new Set<string>(["install", "remove", "update", "disable", "enable"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  try {
    return apiSuccess(
      await getPiBackend().listPlugins(cwd ? { cwd } : {}),
    );
  } catch (error) {
    return apiErrorResponse(error);
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
    const input = {
      action: body.action as PluginAction,
      source: body.source,
      scope: body.scope as PluginScope,
      cwd: body.cwd,
    };
    return apiSuccess(await getPiBackend().managePlugin(input));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
