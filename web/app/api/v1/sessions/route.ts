import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    return apiSuccess(await getPiBackend().listSessions({ force }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
