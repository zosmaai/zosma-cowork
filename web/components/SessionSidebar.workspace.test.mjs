import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

function callbackBody(name, endMarker) {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${name} callback not found`);
  assert.notEqual(end, -1, `${name} callback end not found`);
  return source.slice(start, end);
}

test("sidebar no longer owns folder validation", () => {
  assert.doesNotMatch(source, /\/api\/cwd\/validate/);
  assert.doesNotMatch(source, /commitCustomPath/);
  assert.doesNotMatch(source, /setValidatedProject\(/, "no sidebar-owned validatedProject state");
});

test("projectFor prefers the shell-provided validated identity before session and worktree fallbacks", () => {
  const body = callbackBody("projectFor", "}, [validatedProject, worktreeState, allSessions, projectSelection]);");
  const validatedAt = body.indexOf("validatedProject?.cwd === cwd");
  const worktreeAt = body.indexOf("worktreeState && worktreeState.forCwd === cwd");
  const sessionsAt = body.indexOf("allSessions.find(");
  assert.ok(validatedAt >= 0, "validated identity check present");
  assert.ok(worktreeAt > validatedAt, "worktree fallback comes after validated identity");
  assert.ok(sessionsAt > worktreeAt, "session fallback comes last");
});

test("workspace browser uses native controls without partial tree or menu roles", () => {
  assert.doesNotMatch(source, /role="tree"/);
  assert.doesNotMatch(source, /role="treeitem"/);
  assert.doesNotMatch(source, /role="menu"/);
  assert.doesNotMatch(source, /role="menuitem"/);
  assert.match(source, /<div className="workspace-row"/);
  assert.match(source, /aria-expanded=\{isExpanded\} aria-controls=\{groupId\}/);
  assert.match(source, /aria-current=\{isSelected \? "page" : undefined\}/);
  assert.match(source, /aria-label=\{t\("sidebar\.workspaces"\)\}/);
});

test("session select is a native button without nested interactive controls", () => {
  assert.match(sessionItemSource, /<button type="button" className="session-row-main"/);
  const mainStart = sessionItemSource.indexOf('<button type="button" className="session-row-main"');
  const tagEnd = sessionItemSource.indexOf(">", mainStart);
  const mainEnd = sessionItemSource.indexOf("</button>", mainStart);
  assert.ok(mainStart >= 0 && mainEnd > mainStart, "main session select button found");
  assert.doesNotMatch(sessionItemSource.slice(tagEnd, mainEnd), /<button/, "no nested button inside the session select button");
});

test("search drives searchWorkspaces with selected, running, and unread context", () => {
  assert.match(
    source,
    /searchWorkspaces\(workspaceInputs, workspaceQuery, \{[\s\S]*?selectedWorkspaceKey: selectedProject\?\.key,[\s\S]*?selectedSessionId,[\s\S]*?runningSessionIds,[\s\S]*?unreadSessionIds,\s*\}\)/,
  );
});

test("query expansion is effective and never writes the stored expansion set", () => {
  assert.match(source, /row\.hasQueryMatch \|\| expandedWorkspaceKeys\.has\(row\.key\)/);
  const searchBlock = source.slice(
    source.indexOf("const visibleWorkspaces"),
    source.indexOf("const hasQueryMatches"),
  );
  assert.doesNotMatch(searchBlock, /setExpandedWorkspaceKeys/);
});

test("search force-expands fork hierarchies through the recursive rows", () => {
  assert.match(source, /forceExpanded=\{/);
  assert.match(source, /\{hasChildren && \(forceExpanded \|\| !collapsed\) && \(/);
});

test("empty search result offers clearing the query", () => {
  assert.match(
    source,
    /<div role="status"[\s\S]*?t\("sidebar\.noWorkspaceMatches"\)[\s\S]*?onClick=\{\(\) => setWorkspaceQuery\(""\)\}[\s\S]*?t\("sidebar\.clearSearch"\)/,
  );
});

test("workspace activity counts derive from the unfiltered session set", () => {
  assert.match(source, /getProjectActivity\(allSessions, runningSessionIds, unreadSessionIds\)/);
});

test("the transient workspace row keeps the exact validated cwd", () => {
  assert.match(source, /transientWorkspace\(validatedProject \?\? null, recentProjects\)/);
  assert.match(source, /\.\.\.\(pending \? \[\{ \.\.\.pending, sessions: \[\] \} \] : \[\]\)/);
});

test("re-selecting the active workspace only ensures expansion and never rewrites cwd", () => {
  const body = callbackBody("handleWorkspaceSelect", "\n  }, [");
  const guardAt = body.indexOf("row.key === selectedProject?.key");
  assert.ok(guardAt >= 0, "already-selected guard present");
  const between = body.slice(guardAt, body.indexOf("setSelectedCwd("));
  assert.doesNotMatch(between, /setSelectedCwd\(/);
  assert.match(between, /return;/, "already-selected branch returns before any cwd change");
});

test("worktree switcher renders inside the workspace list and collapse closes its dropdown", () => {
  const listAt = source.indexOf("visibleWorkspaces.map(");
  const switcherAt = source.indexOf("{showWorktreeSwitcher && (() => {");
  assert.ok(listAt >= 0 && switcherAt > listAt, "worktree switcher moved inside the workspace rows");
  assert.match(
    source,
    /if \(selectedWorkspaceKey && !selectedRowVisible\) \{\s*setWtDropdownOpen\(false\);/,
  );
});

test("session action guards remain intact", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /if \(e\.shiftKey\) \{/);
  assert.match(sessionItemSource, /dispatchSessionRowContextMenu\(\{/);
  assert.match(sessionItemSource, /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/);
});
