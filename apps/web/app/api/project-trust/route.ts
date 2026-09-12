import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { legacyDaemonError, piRead } from "@/lib/daemon-client";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

async function validateCwd(value: unknown): Promise<
  { cwd: string } | { response: NextResponse }
> {
  if (typeof value !== "string" || !value.trim()) {
    return { response: NextResponse.json({ error: "cwd required" }, { status: 400 }) };
  }

  const cwd = resolve(value);
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return { response: NextResponse.json({ error: "cwd must be a directory" }, { status: 400 }) };
    }
  } catch {
    return { response: NextResponse.json({ error: "Directory does not exist" }, { status: 400 }) };
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { cwd };
}

// GET /api/project-trust?cwd=<path> — status relay to daemon read:project-trust.
export async function GET(req: Request) {
  const result = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if ("response" in result) return result.response;
  try {
    return NextResponse.json(await piRead("project-trust", { cwd: result.cwd }));
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}

// POST /api/project-trust — record a trust decision (daemon-persisted in the
// shared SDK trust store). Live sessions are daemon-owned and the SDK consults
// trust markers per tool call, so no in-process destroy is needed.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const result = await validateCwd(body.cwd);
    if ("response" in result) return result.response;

    const status = await piRead("project-trust", { cwd: result.cwd, trust: true }) as {
      requiresTrust: boolean;
      trusted: boolean;
    };
    if (!status.requiresTrust) {
      return NextResponse.json({ error: "This project has no resources that require trust" }, { status: 409 });
    }
    invalidateModelsCache();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}