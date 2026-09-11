import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { daemonToBackend, piRead } from "@/lib/daemon-client";
import { BackendError } from "@/lib/backend-errors";

export const dynamic = "force-dynamic";

// Skill management operations over /api/v1 (ZOS-82, slice 2), relayed to the
// daemon. The handler is transport-neutral; the spawn + project-trust gated
// work lives in the daemon's read:skills-* ops.
const OP_PERMITTED = new Set(["install", "check", "update", "search"]);

const OP_TO_READ = {
  install: "skills-install",
  check: "skills-check",
  update: "skills-update",
  search: "skills-search",
} as const;

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  if (!OP_PERMITTED.has(op)) {
    return apiErrorResponse(
      new BackendError("invalid_request", `unknown skill operation: ${op}`),
    );
  }

  try {
    const body = await req.json() as {
      package?: string;
      scope?: string;
      cwd?: string;
      query?: string;
      limit?: number;
    };
    const readOp = OP_TO_READ[op as keyof typeof OP_TO_READ];
    switch (readOp) {
      case "skills-search":
        return apiSuccess(
          await piRead(readOp, { query: body.query, limit: body.limit }),
        );
      default:
        return apiSuccess(
          await piRead(readOp, {
            source: body.package,
            scope: body.scope,
            cwd: body.cwd,
          }),
        );
    }
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}
