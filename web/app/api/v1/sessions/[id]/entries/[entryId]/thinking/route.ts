import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  try {
    const data = await getPiBackend().getSessionThinking({
      sessionId: id,
      entryId,
      blockIndex:
        blockIndexParam === null ? Number.NaN : Number(blockIndexParam),
    });
    return apiSuccess(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
