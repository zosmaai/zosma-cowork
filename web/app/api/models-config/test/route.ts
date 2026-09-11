import { NextResponse } from "next/server";
import { piAuth } from "@/lib/daemon-client";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// POST /api/models-config/test — the daemon runs the one-shot completion
// against the provider (ModelRuntime + completeSimple), so a credential/LLM
// round-trip never touches the web process. Success/failure both answer 200
// with {ok, latencyMs, status, responseText|error}, as before.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ ok: false, error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json(
      { ok: false, error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  try {
    const body = await req.json() as {
      providerName?: unknown;
      provider?: unknown;
      model?: unknown;
    };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ ok: false, error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ ok: false, error: "provider is required" }, { status: 400 });
    if (!isRecord(body.model)) return NextResponse.json({ ok: false, error: "model is required" }, { status: 400 });

    return NextResponse.json(
      await piAuth("test-model", {
        providerName,
        providerConfig: body.provider,
        modelConfig: body.model,
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}