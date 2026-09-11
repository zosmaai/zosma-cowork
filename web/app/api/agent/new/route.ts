import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { allowFileRoot } from "@/lib/file-access";
import { invalidateSessionListCache } from "@/lib/session-reader";
import { DaemonError, piAllowRoot, piStart, piPrompt, piCommand } from "@/lib/daemon-client";

// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session on the daemon (cutover: no in-process runtime).
// Most calls immediately send the first command; type:"ensure_session" only
// creates the session so clients can query commands. Returns pi's real session
// id plus the model/thinking state selected at startup.
export async function POST(req: Request) {
  let commandType: string | undefined;
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;
    commandType = typeof command.type === "string" ? command.type : undefined;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({
        error: "cwd is required",
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({
        error: `Directory does not exist: ${cwd}`,
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 400 });
    }

    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: unknown; [key: string]: unknown };
    if ((provider && !modelId) || (!provider && modelId)) {
      throw new Error("provider and modelId must be provided together");
    }

    // Daemon handles session creation; one-time unique key avoids UID reuse.
    const tempKey = `__new__${randomUUID()}`;
    const handle = await piStart(cwd, tempKey, {
      ...(provider && modelId ? { model: { provider, modelId } } : {}),
      ...(thinkingLevel ? { thinkingLevel: String(thinkingLevel) } : {}),
      ...(toolNames ? { toolNames } : {}),
    });
    const realSessionId = handle.sessionId;

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files, and grant
    // the same root to the daemon so pi:start's file gate admits this cwd.
    allowFileRoot(cwd);
    await piAllowRoot(cwd);
    invalidateSessionListCache();

    const state = await piCommand(realSessionId, { type: "get_state" }) as {
      model?: { id: string; provider: string };
      thinkingLevel?: string;
    };

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({
        success: true,
        sessionId: realSessionId,
        data: null,
        model: state.model
          ? { provider: state.model.provider, modelId: state.model.id }
          : null,
        thinkingLevel: state.thinkingLevel,
      });
    }

    // First command: prompt -> pi:prompt, else (ensure_session already handled) -> pi:command.
    const isPrompt = promptCommand.type === "prompt" || promptCommand.type === "steer" || promptCommand.type === "follow_up";
    const result = isPrompt
      ? await piPrompt(realSessionId, {
          text: (promptCommand.message as string) ?? (promptCommand.text as string) ?? "",
          cid: promptCommand.cid as string | undefined,
          images: promptCommand.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined,
        })
      : await piCommand(realSessionId, promptCommand);

    return NextResponse.json({
      success: true,
      sessionId: realSessionId,
      data: result,
      model: state.model
        ? { provider: state.model.provider, modelId: state.model.id }
        : null,
      thinkingLevel: state.thinkingLevel,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(commandType === "prompt"
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: error instanceof DaemonError ? error.status : 500 });
  }
}