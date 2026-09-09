import { resolve } from "path";
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

// List installed skills for a project for a headless client (ZOS-82). The cwd
// is optional so a headless client can list the catalog without pointing at a
// filesystem directory; the loader reports project-trust status in the
// response rather than denying (parity with the models catalog route).
export async function GET(req: Request) {
  try {
    const requestedCwd = new URL(req.url).searchParams.get("cwd");
    const cwd = requestedCwd ? resolve(requestedCwd) : undefined;
    return apiSuccess(await getPiBackend().listSkills({ cwd }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
