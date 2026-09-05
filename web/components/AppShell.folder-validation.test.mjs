import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function callbackBody(name, nextName) {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`\n  const ${nextName}`, start);
  assert.notEqual(start, -1, `${name} callback not found`);
  assert.notEqual(end, -1, `${nextName} callback not found after ${name}`);
  return source.slice(start, end);
}

test("initial ?cwd= validation reads project identity and installs validatedProject before selecting the cwd", () => {
  const start = source.indexOf("const requestedCwd = initialNavigation.requestedCwd");
  const end = source.indexOf("return () => controller.abort();", start);
  assert.notEqual(start, -1, "initial cwd effect not found");
  assert.notEqual(end, -1, "initial cwd effect end not found");
  const body = source.slice(start, end);
  assert.match(body, /projectRoot\?: string/, "response typing must include projectRoot");
  assert.match(body, /projectKey\?: string/, "response typing must include projectKey");
  assert.match(body, /!data\.cwd\s+\|\|\s+!data\.projectRoot\s+\|\|\s+!data\.projectKey/, "must require all three identity values");
  const validatedAt = body.indexOf("setValidatedProject({");
  const cwdSelectedAt = body.indexOf("setNewSessionCwd(data.cwd)");
  assert.notEqual(validatedAt, -1, "validatedProject not installed on initial validation");
  assert.ok(validatedAt < cwdSelectedAt, "validatedProject must be installed before selecting the cwd");
  assert.match(body.slice(validatedAt), /cwd: data\.cwd,[\s\S]*root: data\.projectRoot,[\s\S]*key: data\.projectKey,/);
});

test("commitAddFolder validates, installs identity, and always dispatches to handleComposerCwdChange without handleCwdChange", () => {
  const body = callbackBody("commitAddFolder", "openAddFolder");
  assert.match(body, /fetch\("\/api\/cwd\/validate"/);
  assert.match(body, /JSON\.stringify\(\{ cwd: path \}\)/);
  assert.match(body, /setValidatedProject\(\{/);
  assert.match(body, /handleComposerCwdChange\(data\.cwd, data\.projectRoot, data\.projectKey\)/);
  assert.doesNotMatch(body, /handleCwdChange\(/, "commitAddFolder must never call handleCwdChange");
});

test("handleComposerCwdChange resets fresh-composer state and never restores workspace context", () => {
  const body = callbackBody("handleComposerCwdChange", "commitAddFolder");
  assert.match(body, /invalidateWorkspaceRestore\(\);/);
  assert.match(body, /setActiveCwd\(cwd\)/);
  assert.match(body, /activeProjectKeyRef\.current = newProject;/);
  assert.match(body, /setSelectedSession\(null\)/);
  assert.match(body, /setNewSessionCwd\(cwd\)/);
  assert.match(body, /setBranchTree\(\[\]\)/);
  assert.match(body, /setSystemPrompt\(null\)/);
  assert.match(body, /setActiveTopPanel\(null\)/);
  assert.match(body, /if \(currentProject !== newProject\) \{[\s\S]*?setFileTabs\(\[\]\);/);
  assert.match(body, /router\.replace\("\/"/);
  assert.doesNotMatch(body, /restoreWorkspaceContext\(/);
});

test("sidebar receives the effective new-session cwd fallback chain", () => {
  assert.match(
    source,
    /selectedCwd=\{selectedSession\?\.cwd \?\? effectiveNewSessionCwd \?\? null\}/,
  );
});

test("handleSessionCreated consumes the transient validated folder", () => {
  const body = callbackBody("handleSessionCreated", "handleAgentEnd");
  assert.match(body, /setValidatedProject\(\(current\) => consumeValidatedCwd\(current, session\.cwd\)\)/);
});

test("shell owns one DirectoryPicker and hands Add Folder callbacks and identity to the sidebar", () => {
  const mounts = source.match(/<DirectoryPicker/g) ?? [];
  assert.equal(mounts.length, 1, "exactly one DirectoryPicker instance in the shell");
  assert.match(source, /onAddFolder=\{openAddFolder\}/);
  assert.match(source, /onSelectFolder=\{commitAddFolder\}/);
  assert.match(source, /validatedProject=\{validatedProject\}/);
});

test("composer/Add Folder share the non-restoring callback while sidebar selection keeps handleCwdChange", () => {
  const sidebarMount = source.slice(source.indexOf("<SessionSidebar"), source.indexOf("onOpenFile={handleOpenFile}"));
  assert.match(sidebarMount, /onCwdChange=\{handleCwdChange\}/);
  const commitBody = callbackBody("commitAddFolder", "openAddFolder");
  assert.match(commitBody, /handleComposerCwdChange\(/);
  assert.doesNotMatch(commitBody, /restoreWorkspaceContext\(/);
});
