import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { daemonToBackend, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const searchParams = new URL(req.url).searchParams;
    return apiSuccess(
      await piRead("session-details", {
        sessionId: id,
        deferThinking: searchParams.has("deferThinking"),
        deferMedia: searchParams.has("deferMedia"),
      }),
    );
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}
