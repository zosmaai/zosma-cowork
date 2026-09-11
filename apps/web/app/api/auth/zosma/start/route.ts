import { startZosmaAuth, productionDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/start — kick off the PKCE sign-in.
// Body (optional): { redirectUri?: string } — loopback callback URL forwarded
// to the auth server for browser completion.
export async function POST(req: Request) {
  let body: { redirectUri?: string } = {};
  try {
    body = (await req.json()) as { redirectUri?: string };
  } catch {
    // Missing/empty body is fine.
  }
  try {
    const result = await startZosmaAuth(zosmaPiDir(), productionDeps(), {
      redirectUri: body.redirectUri,
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to start sign-in";
    return Response.json({ error: message }, { status: 502 });
  }
}
