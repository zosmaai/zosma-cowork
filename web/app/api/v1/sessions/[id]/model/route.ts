import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import type { UpdateModelRequest } from "@/packages/pi-backend/contracts";

export const dynamic = "force-dynamic";

// GET  /api/v1/sessions/{id}/model  — current model + thinking level
// PATCH /api/v1/sessions/{id}/model  — select model and/or change thinking-level
//
// Transport-neutral boundary reads the live session through the pi-backend
// facade. session_not_found when the session is not live.

async function readBody(req: Request): Promise<UpdateModelRequest> {
  if (!req.body) return {};
  try {
    return (await req.json()) as UpdateModelRequest;
  } catch {
    return {};
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    return apiSuccess(await getPiBackend().getSessionModel(id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const patch = await readBody(req);
    return apiSuccess(await getPiBackend().configureModel(id, patch));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
