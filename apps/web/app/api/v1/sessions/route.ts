import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { daemonToBackend, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    return apiSuccess(await piRead("list-sessions", { force }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}
