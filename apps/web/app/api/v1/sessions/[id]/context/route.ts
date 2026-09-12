import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { daemonToBackend, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  try {
    return apiSuccess(
      await piRead("session-context", {
        sessionId: id,
        leafId: url.searchParams.get("leafId") ?? undefined,
        deferThinking: url.searchParams.has("deferThinking"),
        deferMedia: url.searchParams.has("deferMedia"),
      }),
    );
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}
