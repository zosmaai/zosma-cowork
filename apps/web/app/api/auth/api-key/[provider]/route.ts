import { NextResponse } from "next/server";
import { legacyDaemonError, piAuth } from "@/lib/daemon-client";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — auth status relay (never the actual key)
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    return NextResponse.json(await piAuth("api-key-status", { provider }));
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
// The daemon runs the API-key login (auto-selecting the key option) and
// persists the credential to the shared auth.json, bypassing the unbounded
// catalog refresh — same semantics as the old web-side flow.
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    await piAuth("api-key-login", { provider, apiKey: apiKey.trim() });
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    await piAuth("remove-api-key", { provider });
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}