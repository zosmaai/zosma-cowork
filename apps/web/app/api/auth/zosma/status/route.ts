import { getZosmaStatus, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// GET /api/auth/zosma/status — read-only sign-in state for the UI.
export async function GET() {
  try {
    return Response.json(getZosmaStatus(zosmaPiDir()));
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read status";
    return Response.json({ error: message }, { status: 500 });
  }
}
