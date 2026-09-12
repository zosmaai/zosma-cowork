import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const loader = await readFile(new URL("./ZosmaLoadingState.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("uses a branded loading placeholder when no workspace is selected", () => {
  assert.match(source, /<ZosmaLoadingState label=\{translate\("i18n\.loading"\)\} \/>/);
  assert.match(source, /!initialSessionRestored \? \([\s\S]*?<ZosmaLoadingState label=\{translate\("chat\.loadingSession"\)\} \/>/);
  assert.match(chatWindow, /return <ZosmaLoadingState label=\{t\("chat\.loadingSession"\)\} \/>/);
  assert.match(loader, /className="workspace-placeholder"/);
  assert.match(loader, /className="workspace-placeholder-brand"/);
  assert.match(loader, /className="workspace-placeholder-logo/);
  assert.match(loader, /className="workspace-placeholder-name">Zosma Harness<\/span>/);
  assert.match(loader, /className="workspace-placeholder-loading"/);
  assert.match(loader, /className="workspace-placeholder-dots"/);
  assert.doesNotMatch(source, /translate\("workspace\.getStarted"\)/);
  assert.doesNotMatch(source, /translate\("workspace\.selectProject"\)/);
  assert.doesNotMatch(source, /translate\("workspace\.addModels"\)/);
});

test("styles branded loading placeholder without JSX inline styles", () => {
  assert.match(styles, /\.workspace-placeholder\s*\{/);
  assert.match(styles, /\.workspace-placeholder-dots\s*\{/);
  assert.match(styles, /@keyframes workspace-placeholder-dot/);
});
