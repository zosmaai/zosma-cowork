import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { daemonToBackend, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return apiSuccess(await piRead("capabilities"));
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}
