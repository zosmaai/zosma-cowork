import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const url = (p) => new URL(`./session-sidebar/${p}`, import.meta.url);
const modelSource = await readFile(url("use-session-sidebar-model.ts"), "utf8");
const composerSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("projectFor prefers the shell-provided validated identity before session and worktree fallbacks", () => {
  const start = modelSource.indexOf("const projectFor = useCallback");
  const end = modelSource.indexOf("}, [validatedProject, worktreeState, allSessions, projectSelection]);", start);
  assert.notEqual(start, -1, "projectFor callback not found");
  assert.notEqual(end, -1, "projectFor callback end not found");
  const body = modelSource.slice(start, end);

  const validatedAt = body.indexOf("validatedProject?.cwd === cwd");
  const worktreeAt = body.indexOf("worktreeState && worktreeState.forCwd === cwd");
  const sessionsAt = body.indexOf("allSessions.find(");
  assert.ok(validatedAt >= 0, "validated identity check present");
  assert.ok(worktreeAt > validatedAt, "worktree fallback comes after validated identity");
  assert.ok(sessionsAt > worktreeAt, "session fallback comes last");
});

test("shell-provided folder callbacks drive new-workspace selection", () => {
  assert.match(composerSource, /onAddFolder\?: \(\) => void/);
  assert.match(composerSource, /onSelectFolder\?: \(path: string\) => void/);
  assert.match(composerSource, /validatedProject\?: ValidatedCwd \| null/);
});
