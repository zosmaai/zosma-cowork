import { resolve } from "path";
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

// List the available model catalog for a headless client. The cwd is used
// only for project-trust gating inside the model loader; it is optional so a
// headless client can list the catalog without pointing at a filesystem
// directory (no cwd probe / filesystem stat).
export async function GET(req: Request) {
  try {
    const requestedCwd = new URL(req.url).searchParams.get("cwd");
    const cwd = requestedCwd ? resolve(requestedCwd) : process.cwd();
    return apiSuccess(await getPiBackend().getModels({ cwd }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}