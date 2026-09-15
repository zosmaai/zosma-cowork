import { spawnSync } from "node:child_process";

type GitProbe = (command: string, args: string[]) => { status: number | null };

/**
 * Cheap dynamic Git probe. Detected per call (not import-time cached) so
 * installing Git later does not require restarting Cowork, and tests do not
 * depend on module-cache ordering.
 */
export function isGitAvailable(
  probe: GitProbe = (command, args) => spawnSync(command, args, { stdio: "ignore" }),
): boolean {
  try {
    return probe("git", ["--version"]).status === 0;
  } catch {
    return false;
  }
}