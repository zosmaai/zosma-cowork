import { authenticateWithKey, resolveDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/api-key — degraded sign-in: paste a router key
// directly. Works even where the /v1/cowork/* PKCE endpoints are not
// deployed (Task 0 finding: production LiteLLM proxy has none).
export async function POST(req: Request) {
  let body: { apiKey?: string };
  try {
    body = (await req.json()) as { apiKey?: string };
  } catch {
    return Response.json({ error: "apiKey required" }, { status: 400 });
  }
  if (typeof body?.apiKey !== "string") {
    return Response.json({ error: "apiKey required" }, { status: 400 });
  }
  try {
    const result = await authenticateWithKey(body.apiKey, zosmaPiDir(), resolveDeps());
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to save API key";
    const status = message === "missing API key" ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
