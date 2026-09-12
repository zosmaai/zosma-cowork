import { completeZosmaAuth, resolveDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// GET /api/auth/zosma/callback?code&state — loopback redirect target.
// The auth server (when it honors redirect_uri) sends the user's browser
// here; we complete the flow server-side and bounce back to the app root
// with a `zosma` result param. AppShell opens the Models panel from that
// param (Task 11B). A plain 302 Response is used (not NextResponse)
// because route unit tests run under plain node + jiti, where next/server
// has no runtime.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const bounce = (zosma: "success" | "error", extra: Record<string, string> = {}) => {
    const next = new URL("/", req.url);
    next.searchParams.set("zosma", zosma);
    for (const [k, v] of Object.entries(extra)) next.searchParams.set(k, v);
    return new Response(null, { status: 302, headers: { Location: next.toString() } });
  };

  if (!code || !state) {
    return bounce("error", { message: "missing code or state in redirect" });
  }

  try {
    const result = await completeZosmaAuth(code, state, zosmaPiDir(), resolveDeps());
    return bounce("success", { models: String(result.modelCount) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to complete sign-in";
    return bounce("error", { message });
  }
}
