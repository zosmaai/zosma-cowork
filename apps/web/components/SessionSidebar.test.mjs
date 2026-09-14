import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const url = (p) => new URL(`./session-sidebar/${p}`, import.meta.url);
const modelSource = await readFile(url("use-session-sidebar-model.ts"), "utf8");
const clientSource = await readFile(new URL("../lib/api-v1-client.ts", import.meta.url), "utf8");
const sessionItemSource = await readFile(url("session-item.tsx"), "utf8");
const workspacePanelSource = await readFile(url("workspace-panel.tsx"), "utf8");
const agentSource = await readFile(new URL("../services/agent.service.ts", import.meta.url), "utf8");
const sessionItem = sessionItemSource.slice(sessionItemSource.indexOf("function SessionItem("));

test("rename + delete resolve through the react-call dialogs", () => {
  assert.match(sessionItem, /RenameSessionDialog\.call\(\{ initialName: firstLabel \}\)/);
  assert.match(sessionItem, /if \(name\) void doRename\(name\);/);
  assert.match(sessionItem, /DeleteSessionDialog\.call\(\{ title \}\)/);
  assert.match(sessionItem, /if \(confirmed\) void performDelete\(\);/);
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItem, /const handleKeyDown/);
  assert.doesNotMatch(sessionItem, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItem, /tabIndex=\{0\}/);
  assert.match(sessionItem, /<button type="button" className="session-row-main"/, "session selection is a native button");
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(modelSource, /new EventSource\("\/api\/agent\/running\/events"\)/);
  // Polling moved to a TanStack Query refetchInterval (auto-paused while the
  // tab is hidden unless refetchIntervalInBackground is set).
  assert.match(modelSource, /agentService\.runningQueryOptions\(\)/);
  assert.match(agentSource, /getRunningSessionIds\(\)/);
  assert.match(agentSource, /refetchInterval/);
  assert.doesNotMatch(agentSource, /refetchIntervalInBackground/);
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

test("does not persist an unchanged fallback title", () => {
  assert.match(
    sessionItem,
    /if \(name === \(session\.name \?\? ""\) \|\| name === title\) return;/,
  );
});

test("offers the downstream context-menu hook on a session row", () => {
  assert.match(sessionItem, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(sessionItem, /onContextMenu=\{handleContextMenu\}/);
});

test("lifecycle refreshes stay cache-friendly; only explicit actions force a rescan", () => {
  assert.match(clientSource, /export function listSessions\s*\(.*force/);
  assert.match(clientSource, /cache: "no-store"/);
  // Lifecycle churn (session created / agent ended) must NOT force a disk
  // re-scan. TanStack invalidation marks the cached reads stale and the
  // mounted sidebar refetches (deduped). Only the explicit Refresh button and
  // the background-task sweep force one.
  assert.match(modelSource, /invalidateQueries\(\{ queryKey: TAGS\.sessions\.all \}\)/);
  assert.match(modelSource, /void force;/);
  assert.match(workspacePanelSource, /onClick=\{\(\) => loadSessions\(false, true\)\}/);
  assert.match(modelSource, /onBackgroundTaskDone\?\.\(\)/);
});
test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItem, /if \(session\.transient\) return;/);
  assert.match(sessionItem, /\{\(hovered \|\| menuOpen\) && !session\.transient && \(/);
});
