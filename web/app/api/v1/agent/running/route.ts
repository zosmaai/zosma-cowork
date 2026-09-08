import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET() {
  const runningSessionIds = await getPiBackend().getRunningSessionIds();
  return apiSuccess({ runningSessionIds }, {
    headers: { "Cache-Control": "no-store" },
  });
}
