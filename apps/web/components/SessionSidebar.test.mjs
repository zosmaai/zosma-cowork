import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const url = (p) => new URL(`./session-sidebar/${p}`, import.meta.url);
const modelSource = await readFile(url("use-session-sidebar-model.ts"), "utf8");
const clientSource = await readFile(new URL("../lib/api-v1-client.ts", import.meta.url), "utf8");
const sessionItemSource = await readFile(url("session-item.tsx"), "utf8");
const workspacePanelSource = await readFile(url("workspace-panel.tsx"), "utf8");
const sessionItem = sessionItemSource.slice(sessionItemSource.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItem,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItem, /const handleKeyDown/);
  assert.doesNotMatch(sessionItem, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItem, /tabIndex=\{0\}/);
  assert.match(sessionItem, /<button type="button" className="session-row-main"/, "session selection is a native button");
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(modelSource, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(modelSource, /getRunningSessionIds\(/);
  assert.match(modelSource, /document\.visibilityState !== "visible"/);
  assert.match(modelSource, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(modelSource, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(modelSource, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    sessionItem,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    sessionItem,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItem,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItem, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItem,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("lifecycle refreshes stay cache-friendly; only explicit actions force a rescan", () => {
  assert.match(modelSource, /listSessions\(force\)/);
  assert.match(clientSource, /cache: "no-store"/);
  // Lifecycle churn (session created / agent ended) must NOT force a disk
  // re-scan: the daemon merges fresh sessions into its cache via the
  // supplemental registry. Only the explicit Refresh button and the
  // background-task sweep force one.
  assert.match(modelSource, /loadSessions\(isFirst, false\)/);
  assert.match(workspacePanelSource, /onClick=\{\(\) => loadSessions\(false, true\)\}/);
  assert.match(modelSource, /loadSessions\(false, completedInBackground\.length > 0\);[\s\S]*?onBackgroundTaskDone/);
  assert.match(modelSource, /loadSessions\(false, completedInBackground\.length > 0\)/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItem, /if \(session\.transient\) return;/);
  assert.match(sessionItem, /\{hovered && !session\.transient && \(/);
});
