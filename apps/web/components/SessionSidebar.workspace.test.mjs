import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const url = (p) => new URL(`./session-sidebar/${p}`, import.meta.url);
const modelSource = await readFile(url("use-session-sidebar-model.ts"), "utf8");
const workspacePanelSource = await readFile(url("workspace-panel.tsx"), "utf8");
const sessionItemSource = await readFile(url("session-item.tsx"), "utf8");
const sessionItem = sessionItemSource.slice(sessionItemSource.indexOf("function SessionItem("));
const sessionTreeItemSource = sessionItemSource.slice(sessionItemSource.indexOf("function SessionTreeItem("));

function callbackBody(name, endMarker) {
  const start = modelSource.indexOf(`const ${name} = useCallback`);
  const end = modelSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${name} callback not found`);
  assert.notEqual(end, -1, `${name} callback end not found`);
  return modelSource.slice(start, end);
}

test("sidebar no longer owns folder validation", () => {
  assert.doesNotMatch(modelSource, /\/api\/cwd\/validate/);
  assert.doesNotMatch(modelSource, /commitCustomPath/);
  assert.doesNotMatch(modelSource, /setValidatedProject\(/, "no sidebar-owned validatedProject state");
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
  assert.doesNotMatch(workspacePanelSource, /role="tree"/);
  assert.doesNotMatch(workspacePanelSource, /role="treeitem"/);
  assert.doesNotMatch(workspacePanelSource, /role="menu"/);
  assert.doesNotMatch(workspacePanelSource, /role="menuitem"/);
  assert.match(workspacePanelSource, /<div className="workspace-row"/);
  assert.match(workspacePanelSource, /aria-expanded=\{isExpanded\} aria-controls=\{groupId\}/);
  assert.match(workspacePanelSource, /aria-current=\{isSelected \? "page" : undefined\}/);
  assert.match(workspacePanelSource, /aria-label=\{t\("sidebar\.workspaces"\)\}/);
});

test("session select is a native button without nested interactive controls", () => {
  assert.match(sessionItem, /<button type="button" className="session-row-main"/);
  const mainStart = sessionItem.indexOf('<button type="button" className="session-row-main"');
  const tagEnd = sessionItem.indexOf(">", mainStart);
  const mainEnd = sessionItem.indexOf("</button>", mainStart);
  assert.ok(mainStart >= 0 && mainEnd > mainStart, "main session select button found");
  assert.doesNotMatch(sessionItem.slice(tagEnd, mainEnd), /<button/, "no nested button inside the session select button");
});

test("search drives searchWorkspaces with selected, running, and unread context", () => {
  assert.match(
    modelSource,
    /searchWorkspaces\(workspaceInputs, workspaceQuery, \{[\s\S]*?selectedWorkspaceKey: projectFor\(explorerCwd\)\?\.key,[\s\S]*?selectedSessionId,[\s\S]*?runningSessionIds,[\s\S]*?unreadSessionIds,\s*\}\)/,
  );
});

test("query expansion is effective and never writes the stored expansion set", () => {
  assert.match(workspacePanelSource, /row\.hasQueryMatch \|\| expandedWorkspaceKeys\.has\(row\.key\)/);
  const searchBlock = modelSource.slice(
    modelSource.indexOf("const visibleWorkspaces"),
    modelSource.indexOf("const hasQueryMatches"),
  );
  assert.doesNotMatch(searchBlock, /setExpandedWorkspaceKeys/);
});

test("search force-expands fork hierarchies through the recursive rows", () => {
  assert.match(sessionTreeItemSource, /forceExpanded=\{/);
  assert.match(sessionTreeItemSource, /\{hasChildren && \(forceExpanded \|\| !collapsed\) && \(/);
});

test("empty search result offers clearing the query", () => {
  assert.match(workspacePanelSource, /<div role="status"/);
  assert.match(workspacePanelSource, /onClick=\{\(\) => model\.setWorkspaceQuery\(""\)\}/);
  assert.match(workspacePanelSource, /clearLabel=\{t\("sidebar\.clearSearch"\)}/);
  assert.match(workspacePanelSource, /message=\{t\("sidebar\.noWorkspaceMatches"\)}/);
});

test("workspace activity counts derive from the unfiltered session set", () => {
  assert.match(modelSource, /getProjectActivity\(allSessions, runningSessionIds, unreadSessionIds\)/);
});

test("the transient workspace row keeps the exact validated cwd", () => {
  assert.match(modelSource, /transientWorkspace\(validatedProject \?\? null, recentProjects\)/);
  assert.match(modelSource, /\.\.\.\(pending \? \[\{ \.\.\.pending, sessions: \[\] \}\] : \[\]\)/);
});

test("re-selecting the active workspace only ensures expansion and never rewrites cwd", () => {
  const body = callbackBody("handleWorkspaceSelect", "\n  },");
  const guardAt = body.indexOf("row.key === explorerProject?.key");
  assert.ok(guardAt >= 0, "already-selected guard present");
  const between = body.slice(guardAt, body.indexOf("setSelectedCwd("));
  assert.doesNotMatch(between, /setSelectedCwd\(/);
  assert.match(between, /return;/, "already-selected branch returns before any cwd change");
});

test("worktree switcher renders inside the workspace list and collapse closes its dropdown", () => {
  const switcherAt = workspacePanelSource.indexOf("{showWorktreeSwitcher &&");
  const sessionsAt = workspacePanelSource.indexOf("\"workspace-sessions\"");
  assert.ok(sessionsAt >= 0 && switcherAt > sessionsAt, "worktree switcher moved inside the workspace sessions");
  assert.match(
    modelSource,
    /if \(selectedWorkspaceKey && !selectedRowVisible\) \{\s*setWtDropdownOpen\(false\);/,
  );
});

test("session action guards remain intact", () => {
  assert.match(sessionItem, /if \(session\.transient\) return;/);
  assert.match(sessionItem, /if \(e\.shiftKey\) \{/);
  assert.match(sessionItem, /dispatchSessionRowContextMenu\(\{/);
  assert.match(sessionItem, /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/);
});
