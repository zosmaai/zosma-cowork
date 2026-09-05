import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const selectorSource = source.slice(source.indexOf("function NewSessionWorkspaceSelector("));

test("selector renders only inside the empty composer and only with a cwd", () => {
  const emptyBlockStart = source.indexOf("isEmptyNew ? (");
  const mountAt = source.indexOf("<NewSessionWorkspaceSelector");
  assert.notEqual(emptyBlockStart, -1, "empty composer branch present");
  assert.notEqual(mountAt, -1, "selector mounted");
  assert.ok(mountAt > emptyBlockStart, "selector mounted inside the empty composer branch");
  assert.match(source, /newSessionCwd && onComposerWorkspaceSelect && \(/, "mount requires newSessionCwd");
  assert.match(source, /cwd=\{newSessionCwd\}/);
});

test("selector receives currentProjectKey, validatedProject, and the non-restoring callback", () => {
  assert.match(source, /currentProjectKey\?: string \| null;/);
  assert.match(source, /validatedProject\?: ValidatedCwd \| null/);
  assert.match(source, /onComposerWorkspaceSelect\?: \(cwd: string, root: string, key: string\) => void;/);
  assert.match(source, /onComposerAddFolder\?: \(\) => void;/);
  assert.match(source, /currentProjectKey=\{currentProjectKey \?\? null\}/);
  assert.match(source, /validatedProject=\{validatedProject \?\? null\}/);
  assert.match(source, /onSelect=\{onComposerWorkspaceSelect\}/);
  assert.match(source, /onAddFolder=\{onComposerAddFolder( \?\? \(\(\) => \{\}\))?\}/);
});

test("selector lists recent projects plus a transient row only when not session-derived", () => {
  assert.match(selectorSource, /getRecentProjects\(/);
  assert.match(selectorSource, /transientWorkspace\(validatedProject, recent\)/);
  assert.match(selectorSource, /recent\.map\(\(project\) => \(\{ key: project\.key, root: project\.root, cwd: project\.root \}\)\)/);
  assert.match(selectorSource, /key: transient\.key, root: transient\.root, cwd: transient\.cwd/);
});

test("current selection compares workspace keys, not raw paths", () => {
  assert.match(selectorSource, /workspace\.key === currentProjectKey/);
  assert.doesNotMatch(selectorSource, /root === cwd|cwd === root/);
});

test("clicking the already-current key only closes the popover", () => {
  const pickAt = selectorSource.indexOf("const pick = ");
  assert.notEqual(pickAt, -1, "pick handler present");
  const pickBody = selectorSource.slice(pickAt, selectorSource.indexOf("};", pickAt));
  const closeAt = pickBody.indexOf("setOpen(false)");
  const guardAt = pickBody.indexOf("if (workspace.key === currentProjectKey) return;");
  const selectAt = pickBody.indexOf("onSelect(");
  assert.ok(closeAt >= 0 && guardAt > closeAt && selectAt > guardAt, "close, then guard, then select");
});

test("derived workspaces send (root, root, key) and transient sends (cwd, root, key)", () => {
  const pickAt = selectorSource.indexOf("const pick = ");
  const pickBody = selectorSource.slice(pickAt, selectorSource.indexOf("};", pickAt));
  assert.match(pickBody, /onSelect\(workspace\.cwd, workspace\.root, workspace\.key\)/);
});

test("add folder delegates to the shell", () => {
  assert.match(selectorSource, /onClick=\{\(\) => onAddFolder\(\)\}/);
});

test("trigger exposes aria-expanded/aria-controls and the popover uses no menu roles", () => {
  assert.match(selectorSource, /aria-expanded=\{open\} aria-controls="composer-workspace-popover"/);
  assert.doesNotMatch(selectorSource, /role="menu"|role="menuitem"|role="tree"|role="treeitem"/);
});

test("workspace popover is anchored and scrolls without expanding the page", () => {
  assert.match(selectorSource, /style=\{\{ position: "relative", marginLeft: 16, marginRight: 16 \}\}/);
  assert.match(selectorSource, /maxHeight: "max\(120px, min\(360px, calc\(100dvh - 250px\)\)\)"/);
  assert.match(selectorSource, /overflowY: "auto"/);
});

test("escape closes the popover and restores trigger focus", () => {
  assert.match(selectorSource, /e\.key === "Escape"/);
  const escapeAt = selectorSource.indexOf('e.key === "Escape"');
  const block = selectorSource.slice(escapeAt, escapeAt + 200);
  assert.match(block, /setOpen\(false\)/);
  assert.match(block, /triggerRef\.current\?\.focus\(\)/);
  assert.match(selectorSource, /document\.addEventListener\("keydown", /);
});

test("loading, error, and empty states do not block add folder", () => {
  assert.match(selectorSource, /t\("composer\.workspacesLoading"\)/);
  assert.match(selectorSource, /t\("composer\.workspacesError"\)/);
  assert.match(selectorSource, /t\("composer\.workspacesEmpty"\)/);
  const addFolderAt = selectorSource.indexOf("() => onAddFolder()");
  const emptyAt = selectorSource.indexOf('t("composer.workspacesEmpty")');
  assert.ok(addFolderAt > emptyAt, "add folder button renders after the state branches");
});

test("selector fetches the session list once per mount", () => {
  assert.match(selectorSource, /fetch\("\/api\/sessions"\)/);
  assert.match(selectorSource, /cancelled = true/);
});
