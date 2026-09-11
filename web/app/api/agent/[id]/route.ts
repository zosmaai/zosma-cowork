import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { DaemonError, piPrompt, piCommand, piResume, piList } from "@/lib/daemon-client";

// POST /api/agent/[id] - Send a command to an existing session.
//
// Client cutover (roadmap item 6): this route now relays to the daemon over
// /ipc — it no longer runs an in-process pi session. The web keeps only the
// session-file index (resolveSessionPath) so a persisted session Cache on disk
// can be handed to `pi:resume` when the daemon doesn't have it live yet.
//
// Dispatch contract (mirrors the old AgentSessionWrapper.send surface):
//   prompt / steer / follow_up  -> pi:prompt  (text=message, mode mapped)
//   everything else (get_state, set_model, bash, reload, fork, ...) -> pi:command
const PROMPT_TYPES = new Set(["prompt", "steer", "follow_up"]);

function toDaemonMode(type: string, streamingBehavior?: string): "steer" | "follow_up" | undefined {
  if (streamingBehavior === "steer" || type === "steer") return "steer";
  if (streamingBehavior === "followUp" || type === "follow_up") return "follow_up";
  return undefined;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let commandType: string | undefined;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };
    commandType = typeof body.type === "string" ? body.type : undefined;

    const tryDispatch = async (): Promise<NextResponse> => {
      const isPrompt = PROMPT_TYPES.has(commandType ?? "");
      let result: unknown;
      try {
        if (isPrompt) {
          result = await piPrompt(id, {
            text: (body.message as string) ?? (body.text as string) ?? "",
            cid: body.cid as string | undefined,
            timedOut: body.timedOut as boolean | undefined,
            mode: toDaemonMode(commandType ?? "prompt", body.streamingBehavior as string | undefined),
            images: body.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined,
          });
        } else {
          result = await piCommand(id, body);
        }
        return NextResponse.json({ success: true, data: result });
      } catch (error) {
        const daemon = error instanceof DaemonError ? error : null;
        // Unknown to the daemon: hand the persisted session file over and retry.
        if (daemon && daemon.status === 400 && /unknown session/i.test(String(daemon.message))) {
          const filePath = await resolveSessionPath(id);
          if (!filePath) {
            return NextResponse.json({
              error: "Session not found",
              ...(isPrompt ? { code: "prompt_rejected", accepted: false } : {}),
            }, { status: 404 });
          }
          await piResume(id, filePath);
          return isPrompt
            ? NextResponse.json({ success: true, data: await piPrompt(id, {
                text: (body.message as string) ?? (body.text as string) ?? "",
                cid: body.cid as string | undefined,
                timedOut: body.timedOut as boolean | undefined,
                mode: toDaemonMode(commandType ?? "prompt", body.streamingBehavior as string | undefined),
                images: body.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined,
              }) })
            : NextResponse.json({ success: true, data: await piCommand(id, body) });
        }
        throw error;
      }
    };

    const res = await tryDispatch();
    if (res.status === 200) return res;

    // Fall-through unreachable (tryDispatch returns or throws); kept for shape.
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: message,
      ...(commandType === "prompt" || commandType === "steer" || commandType === "follow_up"
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: error instanceof DaemonError ? error.status : 500 });
  }
}

// GET /api/agent/[id] - Get current agent state (live session only).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const sessions = await piList();
    if (!sessions.some((s) => s.sessionId === id)) {
      return NextResponse.json({ running: false });
    }

    const state = await piCommand(id, { type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof DaemonError ? error.status : 500 },
    );
  }
}