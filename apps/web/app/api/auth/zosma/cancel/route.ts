import { cancelZosmaAuth, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/cancel — abandon the in-progress sign-in.
// Deletes the pending PKCE transaction only; never touches the provider.
export async function POST() {
  await cancelZosmaAuth(zosmaPiDir());
  return Response.json({ ok: true });
}
