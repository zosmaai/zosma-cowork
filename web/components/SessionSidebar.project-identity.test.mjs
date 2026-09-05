import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("projectFor prefers the shell-provided validated identity before session and worktree fallbacks", () => {
  const start = source.indexOf("const projectFor = useCallback");
  const end = source.indexOf("}, [validatedProject, worktreeState, allSessions, projectSelection]);", start);
  assert.notEqual(start, -1, "projectFor callback not found");
  assert.notEqual(end, -1, "projectFor callback end not found");
  const body = source.slice(start, end);

  const validatedAt = body.indexOf("validatedProject?.cwd === cwd");
  const worktreeAt = body.indexOf("worktreeState && worktreeState.forCwd === cwd");
  const sessionsAt = body.indexOf("allSessions.find(");
  assert.ok(validatedAt >= 0, "validated identity check present");
  assert.ok(worktreeAt > validatedAt, "worktree fallback comes after validated identity");
  assert.ok(sessionsAt > worktreeAt, "session fallback comes last");
});

test("shell-provided folder callbacks drive new-workspace selection", () => {
  assert.match(source, /onAddFolder\?: \(\) => void/);
  assert.match(source, /onSelectFolder\?: \(path: string\) => void/);
  assert.match(source, /validatedProject\?: ValidatedCwd \| null/);
});
