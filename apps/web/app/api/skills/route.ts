import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { legacyDaemonError, piRead } from "@/lib/daemon-client";

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path> — relay to daemon read:skills-list. The daemon
// loads skills through the same resource loader as AgentSession startup
// (settings skill paths, package skills, .agents/skills).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await piRead("skills-list", { cwd }));
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}

// PATCH /api/skills — toggle disable-model-invocation on a SKILL.md file.
// The daemon does the surgical frontmatter edit (formatting preserved) with
// the same root gates (allowed roots + agent dir + ~/.agents/skills).
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { filePath?: string; disableModelInvocation?: boolean };
    if (!body.filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    const data = await piRead("skills-toggle", {
      filePath: body.filePath,
      disableModelInvocation: body.disableModelInvocation === true,
    });
    return NextResponse.json(data);
  } catch (e) {
    const { status, error } = legacyDaemonError(e);
    return NextResponse.json({ error }, { status });
  }
}
