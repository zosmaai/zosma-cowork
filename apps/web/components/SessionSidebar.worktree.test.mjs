import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const url = (p) => new URL(`./session-sidebar/${p}`, import.meta.url);
const modelSource = await readFile(url("use-session-sidebar-model.ts"), "utf8");

test("uses the server-resolved current worktree identity", () => {
  assert.match(modelSource, /currentWorktreePath: string \| null/);
  assert.match(
    modelSource,
    /const currentWorktree =[\s\S]*?worktreeState\.currentWorktreePath[\s\S]*?worktree\.path === worktreeState\.currentWorktreePath/,
  );
  assert.match(modelSource, /if \(currentWorktreePath === path\) setSelectedCwd\(worktreeState\.projectRoot\)/);
  assert.doesNotMatch(modelSource, /const isCurrent = wt\.path === selectedCwd/);
});
