import { saveRouterConfig, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// PUT /api/auth/zosma/config — persist a self-hosted router base-URL override.
// Body: { authBaseUrl: string, routerBaseUrl: string }
export async function PUT(req: Request) {
  let body: { authBaseUrl?: string; routerBaseUrl?: string };
  try {
    body = (await req.json()) as { authBaseUrl?: string; routerBaseUrl?: string };
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }
  if (typeof body?.authBaseUrl !== "string" || typeof body?.routerBaseUrl !== "string") {
    return Response.json(
      { error: "authBaseUrl and routerBaseUrl are required" },
      { status: 400 },
    );
  }
  try {
    const saved = saveRouterConfig(zosmaPiDir(), {
      authBaseUrl: body.authBaseUrl,
      routerBaseUrl: body.routerBaseUrl,
    });
    return Response.json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid configuration";
    return Response.json({ error: message }, { status: 400 });
  }
}
