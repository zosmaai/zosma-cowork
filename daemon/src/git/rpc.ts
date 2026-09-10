/**
 * Thin RPC dispatch for the daemon's Git/worktree operations.
 *
 * Faithful port of the web routes `app/api/git/*` and `app/api/worktrees/*`.
 * The route-level Next.js plumbing (NextRequest/NextResponse) is dropped; the
 * security gate lives in `./file-access.ts` (a faithful port of the same
 * module) and is preserved verbatim here. This module only selects an op,
 * validates its inputs, and applies the gate — no Git logic of its own.
 */
import { existsSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { allowFileRoot, getAllowedFileRoots, isFilePathAllowed, isExistingFilePathAllowed } from "./file-access.ts";
import { isWindowsAbsolutePath } from "./paths.ts";
import { getGitFileDiff, getGitStatus } from "./git-changes.ts";
import { addWorktree, findCurrentWorktreePath, listWorktrees, removeWorktree, resolveProject } from "./worktree.ts";
import { projectIdentityKey } from "./project-identity.ts";

// RPC op identifiers dispatched to the ported Git services below.
export const GIT_RPC_OPS = [
  "git:status",
  "git:diff",
  "cwd:validate",
  "worktrees:list",
  "worktrees:create",
  "worktrees:remove",
] as const;
export type GitRpcOp = (typeof GIT_RPC_OPS)[number];

export interface GitRpcRequest {
  type: string;
  cwd?: string;
  path?: string;
  branch?: string;
  force?: boolean;
}

export interface IpcResult {
  status: number;
  body: unknown;
}

function looksAbsolute(target: string): boolean {
  return target.startsWith("/") || isWindowsAbsolutePath(target);
}

function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

/** Same gate as `/api/worktrees` and `/api/files`: a candidate cwd must
 *  resolve lexically and on-disk inside an allowed root. */
async function cwdGate(cwd: string): Promise<IpcResult | null> {
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots) || !isExistingFilePathAllowed(cwd, roots)) {
    return { status: 403, body: { error: "Access denied" } };
  }
  return null;
}

function statDir(cwd: string): Result<Stats, number> {
  let stat: Stats;
  try {
    stat = statSync(cwd);
  } catch {
    return { code: 404 } as Result<Stats, number>;
  }
  if (!stat.isDirectory()) return { code: 400 } as Result<Stats, number>;
  return { value: stat } as Result<Stats, number>;
}

type Result<T, N> = { value: T } | { code: N };

/**
 * Dispatch a Git/worktree IPC op to the ported service, gated by the
 * file-access security. Returns an HTTP-like result the server turns into a
 * response. Unknown ops return 400 invalid_request.
 */
export async function handleGitRpc(req: GitRpcRequest): Promise<IpcResult> {
  switch (req.type) {
    case "git:status": {
      const cwd = req.cwd?.trim() ?? "";
      if (!cwd || !looksAbsolute(cwd)) return { status: 400, body: { error: "cwd must be an absolute path" } };
      const roots = await getAllowedFileRoots();
      if (!isFilePathAllowed(cwd, roots)) return { status: 403, body: { error: "Access denied" } };
      const stat = statDir(cwd);
      if ("code" in stat) return { status: stat.code, body: { error: stat.code === 404 ? "Directory not found" : "Not a directory" } };
      if (!isExistingFilePathAllowed(cwd, roots)) return { status: 403, body: { error: "Access denied" } };
      return { status: 200, body: await getGitStatus(cwd) };
    }
    case "git:diff": {
      const cwd = req.cwd?.trim() ?? "";
      const filePath = req.path?.trim() ?? "";
      if (!cwd || !looksAbsolute(cwd)) return { status: 400, body: { error: "cwd must be an absolute path" } };
      if (!filePath || !looksAbsolute(filePath)) return { status: 400, body: { error: "path must be an absolute path" } };
      const roots = await getAllowedFileRoots();
      if (!isFilePathAllowed(cwd, roots) || !isFilePathAllowed(filePath, roots)) {
        return { status: 403, body: { error: "Access denied" } };
      }
      // The cwd must resolve inside an allowed root. The file itself may no
      // longer exist when Git reports it as deleted; getGitFileDiff verifies
      // that the requested path belongs to this repository and its status.
      if (!isExistingFilePathAllowed(cwd, roots)) return { status: 403, body: { error: "Access denied" } };
      return { status: 200, body: await getGitFileDiff(cwd, filePath) };
    }
    case "cwd:validate": {
      const raw = req.cwd?.trim() ?? "";
      if (!raw) return { status: 400, body: { error: "Path is required" } };
      const normalizedCwd = normalizeCwd(raw);
      let stat: Stats;
      try {
        stat = statSync(normalizedCwd);
      } catch {
        return { status: 400, body: { error: `Directory does not exist: ${raw}` } };
      }
      if (!stat.isDirectory()) return { status: 400, body: { error: `Path is not a directory: ${raw}` } };
      allowFileRoot(normalizedCwd);
      const project = await resolveProject(normalizedCwd);
      return {
        status: 200,
        body: {
          success: true,
          cwd: normalizedCwd,
          projectRoot: project.projectRoot,
          projectKey: projectIdentityKey(project.projectRoot),
        },
      };
    }
    case "worktrees:list": {
      const cwd = req.cwd ?? "";
      if (!cwd) return { status: 400, body: { error: "cwd is required" } };
      const denied = await cwdGate(cwd);
      if (denied) return denied;
      const project = await resolveProject(cwd);
      let worktrees: Awaited<ReturnType<typeof listWorktrees>> = [];
      let currentWorktreePath: string | null = null;
      let isGit = true;
      try {
        // For a removed-worktree cwd (session of a deleted worktree), fall back
        // to the inferred project root so the switcher still shows the project.
        worktrees = await listWorktrees(existsSync(cwd) ? cwd : project.projectRoot);
        currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
      } catch {
        isGit = false;
      }
      // Every listed path is a git-verified worktree of this project; allow the
      // file explorer to browse them even before they have any session (the
      // in-memory allowlist from addWorktree does not survive server restarts).
      for (const w of worktrees) allowFileRoot(w.path);
      return {
        status: 200,
        body: {
          projectRoot: project.projectRoot,
          projectKey: projectIdentityKey(project.projectRoot),
          isGit,
          isTopLevel: project.isTopLevel,
          currentWorktreePath,
          worktrees,
        },
      };
    }
    case "worktrees:create": {
      const cwd = req.cwd ?? "";
      const branch = req.branch ?? "";
      if (!cwd || typeof cwd !== "string") return { status: 400, body: { error: "cwd is required" } };
      if (!branch || typeof branch !== "string") return { status: 400, body: { error: "branch is required" } };
      const denied = await cwdGate(cwd);
      if (denied) return denied;
      if (!existsSync(cwd)) return { status: 400, body: { error: `Directory does not exist: ${cwd}` } };
      const result = await addWorktree(cwd, branch);
      return { status: 200, body: result };
    }
    case "worktrees:remove": {
      const cwd = req.cwd ?? "";
      const worktreePath = req.path ?? "";
      if (!cwd || typeof cwd !== "string") return { status: 400, body: { error: "cwd is required" } };
      if (!worktreePath || typeof worktreePath !== "string") return { status: 400, body: { error: "path is required" } };
      const denied = await cwdGate(cwd);
      if (denied) return denied;
      try {
        await removeWorktree(cwd, worktreePath, req.force === true);
        return { status: 200, body: { success: true } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // git refuses to remove dirty worktrees without --force; surface that so
        // the caller can offer a force-remove confirmation.
        const dirty = /contains modified or untracked files|is dirty/i.test(message);
        return { status: dirty ? 409 : 400, body: { error: message, dirty } };
      }
    }
    default:
      return { status: 400, body: { error: "invalid_request", detail: "unknown op" } };
  }
}
