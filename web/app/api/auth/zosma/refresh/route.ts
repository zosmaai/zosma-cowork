import { refreshZosmaModels, resolveDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/refresh — re-pull the entitled catalog with the
// existing key. No sign-in round trip.
export async function POST() {
  try {
    const result = await refreshZosmaModels(zosmaPiDir(), resolveDeps());
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to refresh models";
    const status = message === "Zosma Router is not configured" ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
