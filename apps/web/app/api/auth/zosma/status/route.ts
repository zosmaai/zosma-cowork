import { getZosmaStatus, readSessionCookie, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// GET /api/auth/zosma/status — read-only sign-in state for the UI.
// `signedIn` is per-browser: it reflects this request's session cookie, not
// just whether the machine has a router key.
export async function GET(req: Request) {
  try {
    const token = readSessionCookie(req.headers.get("cookie"));
    return Response.json(getZosmaStatus(zosmaPiDir(), { sessionToken: token }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read status";
    return Response.json({ error: message }, { status: 500 });
  }
}
