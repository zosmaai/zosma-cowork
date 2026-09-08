import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  try {
    const context = await getPiBackend().getSessionContext({
      sessionId: id,
      leafId: url.searchParams.get("leafId") ?? undefined,
      deferThinking: url.searchParams.has("deferThinking"),
      deferMedia: url.searchParams.has("deferMedia"),
    });
    return apiSuccess(context);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
