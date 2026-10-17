import { disconnectZosmaAuth, productionDeps, signOutCookies, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/disconnect — revoke server-side (best-effort),
// remove the local provider, reload the registry, end this browser session.
export async function POST(req: Request) {
  try {
    await disconnectZosmaAuth(zosmaPiDir(), productionDeps());
    return Response.json({ ok: true }, { headers: signOutCookies(req) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to disconnect";
    return Response.json({ error: message }, { status: 500 });
  }
}
