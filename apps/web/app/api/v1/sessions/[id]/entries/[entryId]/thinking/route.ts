import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { daemonToBackend, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  try {
    return apiSuccess(
      await piRead("session-thinking", {
        sessionId: id,
        entryId,
        blockIndex: blockIndexParam === null ? undefined : Number(blockIndexParam),
      }),
    );
  } catch (error) {
    return apiErrorResponse(daemonToBackend(error) ?? error);
  }
}
