/**
 * Thin RPC dispatch for the daemon's read surface: session file reads
 * (list/details/context/thinking/rename/delete) plus the model/skills/plugins
 * catalog services. Port of `web/packages/pi-backend/*` read services — the
 * PiBackend facade the web tier used to host. The daemon owns these now so the
 * web process never imports the SDK read surface (roadmap item 6 end-to-end).
 *
 * All session paths are resolved through the session index + path caches and
 * gated by the same file-access security as the file/git services. Model,
 * skills and plugins ops take an optional `cwd` that is gated against the
 * allowed roots.
 *
 * Errors surface as `IpcResult` with a sibling `code` so the web relay can map
 * them to the client contract (session_not_found / model_not_found / ...).
 */
import {
  allowFileRoot,
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
} from "../git/file-access.ts";
import { toSlashPath } from "../git/paths.ts";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
  getSessionDetails,
  getSessionContext,
  getSessionThinking,
  getSessionEntries,
  listSessions,
  renameSession,
  deleteSession,
} from "./sessions.ts";
import { getModels, invalidateModelsCache } from "./models.ts";
import {
  listSkillsFromServices,
  installSkillFromServices,
  checkSkillUpdatesFromServices,
  updateSkillFromServices,
  searchSkillsFromServices,
  toggleSkillModelInvocation,
} from "./skills.ts";
import { readPluginsFromServices, managePluginsFromServices } from "./plugins.ts";
import { getProjectTrustStatus, trustProject } from "./lib/project-trust.ts";
import { getAgentDir, getPackageDir } from "@earendil-works/pi-coding-agent";
import { BackendError } from "./lib/errors.ts";
import type { IpcResult } from "../pi/rpc.ts";

export type { IpcResult };

// Semantic IpcResult helpers shared with the server dispatch.
export function okResult(data: unknown): IpcResult {
  return { status: 200, body: { ok: true, data } };
}

export function errResult(code: string, message: string, status = 400): IpcResult {
  return { status, body: { ok: false, error: message, code } };
}

export function errFromBackend(e: unknown): IpcResult {
  if (e instanceof BackendError) {
    const status = e.code === "session_not_found" || e.code === "entry_not_found" || e.code === "model_not_found" || e.code === "skill_not_found" || e.code === "thinking_block_not_found"
      ? 404
      : e.code === "access_denied"
        ? 403
        : 400;
    return errResult(e.code, e.message, status);
  }
  return { status: 500, body: { ok: false, error: e instanceof Error ? e.message : String(e), code: "internal_error" } };
}

export const READ_RPC_OPS = [
  "read:capabilities",
  "read:health",
  "read:allow-root",
  "read:project-trust",
  "read:invalidate-models",
  "read:pi-package-dir",
  "read:list-sessions",
  "read:session-details",
  "read:session-context",
  "read:session-thinking",
  "read:session-rename",
  "read:session-delete",
  "read:session-entries",
  "read:models",
  "read:skills-list",
  "read:skills-install",
  "read:skills-check",
  "read:skills-update",
  "read:skills-search",
  "read:skills-toggle",
  "read:plugins-list",
  "read:plugins-manage",
] as const;
export type ReadRpcOp = (typeof READ_RPC_OPS)[number];

export interface ReadRpcRequest {
  type: ReadRpcOp;
  sessionId?: string;
  cwd?: string;
  force?: boolean;
  deferThinking?: boolean;
  deferMedia?: boolean;
  leafId?: string;
  entryId?: string;
  blockIndex?: number;
  name?: string;
  source?: string;
  scope?: string;
  package?: string;
  filePath?: string;
  disableModelInvocation?: boolean;
  version?: string;
  query?: string;
  limit?: number;
  action?: string;
  root?: string;
  trust?: boolean;
}

export type ReadRpcResult = IpcResult;

export async function handleReadRpc(request: ReadRpcRequest): Promise<ReadRpcResult> {
  try {
    switch (request.type) {
      case "read:capabilities": {
        return okResult({
          apiVersion: "v1",
          commandTransports: ["http"],
          eventTransports: ["sse"],
          features: {
            concurrentSessions: true,
            prompt: true,
            abort: true,
            steering: true,
            followUp: true,
            sessionBranches: true,
            bash: true,
            extensions: true,
          },
        });
      }
      case "read:health": {
        return okResult({ status: "ok", apiVersion: "v1", piVersion: VERSION });
      }
      case "read:allow-root": {
        if (typeof request.root !== "string" || !request.root) {
          return errResult("invalid_request", "root is required");
        }
        allowFileRoot(request.root);
        // Bust the short-TTL roots cache so gated ops see the root now,
        // not after the next 5s expiry.
        await getAllowedFileRoots(undefined, true);
        return okResult({ ok: true });
      }
      case "read:invalidate-models": {
        invalidateModelsCache();
        return okResult({ ok: true });
      }
      case "read:pi-package-dir": {
        return okResult({ packageDir: getPackageDir() });
      }
      case "read:project-trust": {
        if (!request.cwd) return errResult("cwd_required", "cwd required");
        const agentDir = getAgentDir();
        if (request.trust === true) return okResult(trustProject(request.cwd, agentDir));
        return okResult(getProjectTrustStatus(request.cwd, agentDir));
      }
      case "read:list-sessions": {
        const result = await listSessions({ force: request.force ?? false });
        return okResult(result);
      }
      case "read:session-details": {
        if (!request.sessionId) return errResult("session_not_found", "Session not found", 404);
        const result = await getSessionDetails({
          sessionId: request.sessionId,
          deferThinking: request.deferThinking ?? false,
          deferMedia: request.deferMedia ?? false,
        });
        return okResult(result);
      }
      case "read:session-context": {
        if (!request.sessionId) return errResult("session_not_found", "Session not found", 404);
        const result = await getSessionContext({
          sessionId: request.sessionId,
          leafId: request.leafId,
          deferThinking: request.deferThinking ?? false,
          deferMedia: request.deferMedia ?? false,
        });
        return okResult(result);
      }
      case "read:session-thinking": {
        if (!request.sessionId) return errResult("session_not_found", "Session not found", 404);
        if (!request.entryId || !Number.isSafeInteger(request.blockIndex) || (request.blockIndex ?? 0) < 0) {
          return errResult("invalid_request", "Valid entryId and blockIndex are required");
        }
        const result = await getSessionThinking({
          sessionId: request.sessionId,
          entryId: request.entryId,
          blockIndex: request.blockIndex!,
        });
        return okResult(result);
      }
      case "read:session-rename": {
        if (!request.sessionId) return errResult("session_not_found", "Session not found", 404);
        if (typeof request.name !== "string") return errResult("invalid_request", "name is required");
        const result = await renameSession({ sessionId: request.sessionId, name: request.name });
        return okResult(result);
      }
      case "read:session-delete": {
        if (!request.sessionId) return errResult("session_not_found", "Session not found", 404);
        const result = await deleteSession({ sessionId: request.sessionId });
        return okResult(result);
      }
      case "read:session-entries": {
        if (!request.filePath) return errResult("invalid_request", "filePath is required");
        const roots = await getAllowedFileRoots();
        const inAgentDir = toSlashPath(request.filePath).startsWith(toSlashPath(getAgentDir()) + "/");
        const inRoots =
          isFilePathAllowed(request.filePath, roots) &&
          isExistingFilePathAllowed(request.filePath, roots);
        if (!inAgentDir && !inRoots) return errResult("access_denied", "Access denied", 403);
        return okResult({ entries: getSessionEntries(request.filePath) });
      }
      case "read:models": {
        // Catalog parity with the old web route: the models list is not
        // root-gated (project-trust status is reported inside the response).
        const result = await getModels(request.cwd ?? "");
        return okResult(result);
      }
      case "read:skills-list": {
        // No rpc-level gate: parity with the old web route (project-trust
        // status is reported inside the response, not denied).
        const result = await listSkillsFromServices(request.cwd);
        return okResult(result);
      }
      case "read:skills-install": {
        if (typeof request.source !== "string") return errResult("invalid_request", "source is required");
        const result = await installSkillFromServices({
          package: request.source,
          scope: request.scope as never,
          cwd: request.cwd,
        });
        return okResult(result);
      }
      case "read:skills-check": {
        if (!request.cwd) return errResult("cwd_required", "cwd required");
        const result = await checkSkillUpdatesFromServices({
          cwd: request.cwd,
          package: request.package,
          scope: request.scope as never,
        });
        return okResult(result);
      }
      case "read:skills-update": {
        if (!request.name && !request.source) return errResult("invalid_request", "name or source is required");
        if (request.name && !request.cwd && !request.scope) return errResult("cwd_required", "cwd and scope are required for named updates");
        const result = await updateSkillFromServices({
          package: (request.source ?? request.name) as string,
          scope: request.scope as never,
          cwd: request.cwd as string,
        });
        return okResult(result);
      }
      case "read:skills-search": {
        if (typeof request.query !== "string") return errResult("invalid_request", "query is required");
        const result = await searchSkillsFromServices({
          query: request.query,
          limit: request.limit,
        });
        return okResult(result);
      }
      case "read:skills-toggle": {
        if (typeof request.filePath !== "string" || !request.filePath) {
          return errResult("invalid_request", "filePath is required");
        }
        const result = await toggleSkillModelInvocation({
          filePath: request.filePath,
          disableModelInvocation: request.disableModelInvocation === true,
        });
        return okResult(result);
      }
      case "read:plugins-list": {
        // Gate lives in readPluginsFromServices (cwd required + root gate) —
        // original web semantics.
        const result = await readPluginsFromServices(request.cwd);
        return okResult(result);
      }
      case "read:plugins-manage": {
        if (!request.action) return errResult("invalid_request", "action is required");
        const result = await managePluginsFromServices({
          action: request.action as never,
          source: request.source,
          scope: request.scope as never,
          cwd: request.cwd,
        });
        return okResult(result);
      }
      default: {
        return { status: 404, body: { ok: false, error: "unknown op" } };
      }
    }
  } catch (e) {
    return errFromBackend(e);
  }
}