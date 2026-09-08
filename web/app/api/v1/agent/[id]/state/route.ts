import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await getPiBackend().getAgentState({ sessionId: id });
    return apiSuccess(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
