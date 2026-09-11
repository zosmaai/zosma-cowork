import { resolve } from "path";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { daemonToBackend, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// List installed skills for a project for a headless client (ZOS-82), relayed
// to the daemon. The cwd is optional so a headless client can list the catalog
// without pointing at a filesystem directory; the loader reports
// project-trust status in the response rather than denying.
export async function GET(req: Request) {
  try {
    const requestedCwd = new URL(req.url).searchParams.get("cwd");
    const cwd = requestedCwd ? resolve(requestedCwd) : undefined;
    return apiSuccess(await piRead("skills-list", { cwd }));
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}
