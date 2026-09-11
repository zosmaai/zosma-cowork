import { NextResponse } from "next/server";
import { legacyDaemonError, piAuth } from "@/lib/daemon-client";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

// POST /api/auth/logout/[provider] — remove the stored OAuth credential.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  try {
    await piAuth("logout", { provider });
    invalidateModelsCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}