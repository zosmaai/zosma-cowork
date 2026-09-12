import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const viewportHookSource = await readFile(new URL("../hooks/useViewportHeight.ts", import.meta.url), "utf8");

test("configures iOS standalone mode to use the full screen", () => {
  assert.match(layoutSource, /statusBarStyle: "black-translucent"/);
  assert.match(layoutSource, /viewportFit: "cover"/);
  assert.match(layoutSource, /interactiveWidget: "resizes-content"/);
});

test("tracks the visual viewport while the software keyboard is open", () => {
assert.match(appShellSource, /useViewportHeight\(\)/);
assert.match(appShellSource, /className="app-shell"/);
assert.match(appShellSource, /className="app-shell-toolbar"/);
assert.match(cssSource, /\.app-shell \{[\s\S]*?padding-left: env\(safe-area-inset-left\);[\s\S]*?padding-right: env\(safe-area-inset-right\);/);
assert.match(cssSource, /\.sidebar-container \{[\s\S]*?padding-top: env\(safe-area-inset-top\);[\s\S]*?padding-bottom: env\(safe-area-inset-bottom\);/);
assert.match(cssSource, /\.app-shell-toolbar \{[\s\S]*?height: calc\(var\(--shell-header-height\) \+ env\(safe-area-inset-top\)\);[\s\S]*?padding-top: env\(safe-area-inset-top\);/);
assert.match(cssSource, /\.file-panel-header \{[\s\S]*?height: calc\(var\(--shell-header-height\) \+ env\(safe-area-inset-top\)\);[\s\S]*?padding-top: env\(safe-area-inset-top\);/);
assert.match(cssSource, /\.app-shell \{[\s\S]*?height: var\(--app-viewport-height, 100dvh\);/);
assert.match(appShellSource, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
  assert.match(viewportHookSource, /window\.visualViewport/);
  assert.match(viewportHookSource, /window\.requestAnimationFrame\(update\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("resize", scheduleUpdate\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("focusout", scheduleUpdate\)/);
  assert.match(viewportHookSource, /--app-viewport-height/);
  assert.match(viewportHookSource, /window\.scrollTo\(0, 0\)/);
  assert.match(cssSource, /height: var\(--app-viewport-height, 100dvh\)/);
  assert.match(cssSource, /left: env\(safe-area-inset-left\)/);
  assert.match(chatWindowSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
});

test("contains chat content and inputs within the mobile viewport", () => {
  assert.match(cssSource, /\.markdown-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/);
  assert.match(cssSource, /\.markdown-code-block \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/);
  assert.match(chatWindowSource, /overflow-x-hidden overflow-y-auto/);
  assert.match(chatInputSource, /flex: 1,\s*minWidth: 0,\s*width: "100%",/);
});

test("prevents iOS focus zoom from widening the layout", () => {
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?textarea,[\s\S]*?input,[\s\S]*?select \{\s*font-size: 16px !important;/);
});
