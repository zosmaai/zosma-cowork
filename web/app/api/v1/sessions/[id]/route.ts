import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const searchParams = new URL(req.url).searchParams;
    const data = await getPiBackend().getSessionDetails({
      sessionId: id,
      deferThinking: searchParams.has("deferThinking"),
      deferMedia: searchParams.has("deferMedia"),
    });
    return apiSuccess(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
