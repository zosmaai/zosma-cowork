import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiSuccess(await getPiBackend().getCapabilities());
}