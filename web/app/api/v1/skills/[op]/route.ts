import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { BackendError } from "@/packages/pi-backend/errors";

export const dynamic = "force-dynamic";

// Skill management operations over /api/v1 (ZOS-82, slice 2). The handler is
// transport-neutral — no NextResponse, no spawn. The spawn + project-trust gated
// work lives in the pi-backend facade (web/packages/pi-backend/skills.ts).
const OP_PERMITTED = new Set(["install", "check", "update", "search"]);

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!OP_PERMITTED.has(op)) {
    return apiErrorResponse(
      new BackendError("invalid_request", `unknown skill operation: ${op}`),
    );
  }

  try {
    const body = await req.json();
    const backend = getPiBackend();
    switch (op) {
      case "install":
        return apiSuccess(
          await backend.installSkill({
            package: body.package,
            scope: body.scope,
            cwd: body.cwd,
          }),
        );
      case "check":
        return apiSuccess(
          await backend.checkSkillUpdates({
            package: body.package,
            scope: body.scope,
            cwd: body.cwd,
          }),
        );
      case "update":
        return apiSuccess(
          await backend.updateSkill({
            package: body.package,
            scope: body.scope,
            cwd: body.cwd,
          }),
        );
      case "search":
        return apiSuccess(await backend.searchSkills({ query: body.query, limit: body.limit }));
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
