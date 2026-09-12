import { completeZosmaAuth, resolveDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/complete — finish the flow from code+state delivered
// by the Tauri deep link or the manual-paste fallback.
export async function POST(req: Request) {
  let body: { code?: string; state?: string };
  try {
    body = (await req.json()) as { code?: string; state?: string };
  } catch {
    return Response.json({ error: "code and state required" }, { status: 400 });
  }
  if (typeof body?.code !== "string" || typeof body?.state !== "string") {
    return Response.json({ error: "code and state required" }, { status: 400 });
  }
  try {
    const result = await completeZosmaAuth(body.code, body.state, zosmaPiDir(), resolveDeps());
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to complete sign-in";
    // 400 for user-recoverable flow errors (expired, mismatch, missing body);
    // 502 when the remote auth server is the problem.
    const status = /no pending auth transaction|state mismatch|missing code or state/.test(message) ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
