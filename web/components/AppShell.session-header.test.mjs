import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("uses a quiet session header with one desktop overflow menu", () => {
  for (const className of [
    "session-header",
    "session-header-title",
    "session-header-actions",
    "session-header-overflow-trigger",
    "session-header-overflow",
    "session-header-overflow-item",
  ]) {
    assert.match(source, new RegExp(`className="${className}"`));
  }
  assert.match(source, /const \[activeTopPanel, setActiveTopPanel\] = useState<[^>]*"overflow"/);
  assert.match(source, /headerOverflowButtonRef/);
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitem"/);
  assert.match(source, /handleViewFullHistory/);
  assert.match(source, /void handleAutoName/);
  assert.match(source, /handleSystemPromptToggle/);
  assert.match(source, /toggleTopPanel\("branches"/);
  assert.match(source, /toggleTopPanel\("session"/);
  assert.doesNotMatch(source, /renderSessionStatsButton/);
});

test("renders distinct existing-session and fresh-session header titles", () => {
  assert.match(source, /selectedSession\?\.name/);
  assert.match(source, /effectiveNewSessionCwd/);
  assert.match(source, /session-header-title/);
});

test("keeps mobile actions and file control accessible", () => {
  for (const action of ["history", "name", "branches", "system"]) {
    assert.match(source, new RegExp(`data-mobile-toolbar-action=(?:\\{mobile \\? )?"${action}"`));
  }
  assert.match(source, /hideInlineButton/);
  assert.match(source, /aria-controls="file-panel"/);
  assert.match(source, /aria-expanded=\{rightPanelOpen\}/);
});

test("keeps title and system callbacks in the overflow action wiring", () => {
  assert.match(source, /session-header-overflow-item[\s\S]*?handleViewFullHistory/);
  assert.match(source, /session-header-overflow-item[\s\S]*?void handleAutoName/);
  assert.match(source, /session-header-overflow-item[\s\S]*?handleSystemPromptToggle/);
});

test("uses live session stats and persisted metadata for details", () => {
  assert.match(source, /formatSessionDuration/);
  assert.match(source, /formatCompactTokenCount/);
  assert.match(source, /formatSessionCost/);
  assert.match(source, /getCacheHitRate/);
  for (const key of ["session.cwd", "session.projectRoot", "session.created", "session.modified"]) {
    assert.match(source, new RegExp(`translate\\("${key}"`));
  }
  assert.match(source, /!selectedSession \? \(/);
  assert.match(source, /session-details-new/);
});

test("keeps fork, in-session navigation, rename, delete, and export owners separate", async () => {
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(chatWindow, /onFork=\{sessionBusy \|\| isNew[\s\S]*?handleFork\}/);
  assert.match(chatWindow, /onNavigate=\{sessionBusy \? undefined : handleNavigate\}/);
  assert.match(sidebar, /method: "PATCH"/);
  assert.match(sidebar, /method: "DELETE"/);
  assert.match(sidebar, /if \(e\.shiftKey\)/);
  assert.match(source, /\/api\/sessions\/\$\{encodeURIComponent\(selectedSession\.id\)\}\/export\?inline=1/);
});
