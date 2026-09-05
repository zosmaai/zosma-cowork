import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(path, import.meta.url), "utf8");
const readBinary = (path) => readFile(new URL(path, import.meta.url));

const [
  brandSource,
  layoutSource,
  manifestSource,
  appShellSource,
  sidebarSource,
  chatWindowSource,
  offlineSource,
  enSource,
  zhSource,
] = await Promise.all([
  readText("./ZosmaBrand.tsx"),
  readText("../app/layout.tsx"),
  readText("../app/manifest.ts"),
  readText("./AppShell.tsx"),
  readText("./SessionSidebar.tsx"),
  readText("./ChatWindow.tsx"),
  readText("../public/offline.html"),
  readText("../lib/i18n/messages/en.ts"),
  readText("../lib/i18n/messages/zh-CN.ts"),
]);

const [logo, favicon, icon192, icon512, appleIcon] = await Promise.all([
  readBinary("../public/zosma-logo.png"),
  readBinary("../app/favicon.ico"),
  readBinary("../public/icons/icon-192.png"),
  readBinary("../public/icons/icon-512.png"),
  readBinary("../public/icons/apple-touch-icon.png"),
]);

const cssSource = await readText("../app/globals.css");
const chatInputSource = await readText("./ChatInput.tsx");

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test("checks in Zosma logo, favicon, and install icons", () => {
  assert.deepEqual([...logo.subarray(0, 8)], pngSignature);
  assert.deepEqual([...favicon.subarray(0, 4)], [0x00, 0x00, 0x01, 0x00]);
  assert.deepEqual([...icon192.subarray(0, 8)], pngSignature);
  assert.deepEqual([...icon512.subarray(0, 8)], pngSignature);
  assert.deepEqual([...appleIcon.subarray(0, 8)], pngSignature);
  assert.ok(logo.length > 10_000);
});

test("uses zosma.ai in browser and install metadata", () => {
  assert.match(layoutSource, /title: "zosma\.ai"/);
  assert.match(layoutSource, /applicationName: "zosma\.ai"/);
  assert.match(layoutSource, /url: "\/favicon\.ico"/);
  assert.match(manifestSource, /name: "zosma\.ai"/);
  assert.match(manifestSource, /short_name: "zosma\.ai"/);
  assert.match(appShellSource, /`\$\{activeCwdName\} - zosma\.ai`/);
  assert.match(sidebarSource, /<ZosmaBrand \/>/);
  assert.match(chatWindowSource, /<ZosmaBrand className="new-session-brand" \/>/);
  assert.match(offlineSource, /<title>zosma\.ai is offline<\/title>/);
  assert.match(offlineSource, /Reconnect to the local zosma\.ai server/);
  assert.match(enSource, /"appUpdate\.releaseNotes": "zosma\.ai v\{version\}/);
  assert.match(zhSource, /"appUpdate\.releaseNotes": "zosma\.ai v\{version\}/);
});

test("brand component exposes text identity and treats the repeated image as decorative", () => {
  assert.match(brandSource, /aria-label="zosma\.ai"/);
  assert.match(brandSource, /src="\/zosma-logo\.png"/);
  assert.match(brandSource, /alt=""/);
  assert.match(brandSource, />zosma\.ai<\/span>/);
});

test("defines and applies the DeepSeek-derived light and dark shell tokens", () => {
  assert.match(cssSource, /--bg: #ffffff;/);
  assert.match(cssSource, /--bg-panel: #f9fafb;/);
  assert.match(cssSource, /--surface-elevated: #ffffff;/);
  assert.match(cssSource, /--shell-content-max-width: 748px;/);
  assert.match(cssSource, /--shell-header-height: 48px;/);
  assert.match(cssSource, /--radius-panel: 22px;/);
  assert.match(cssSource, /--motion-slow: 300ms;/);
  assert.match(cssSource, /html\.dark \{[\s\S]*?--bg: #151517;/);
  assert.match(cssSource, /html\.dark \{[\s\S]*?--bg-panel: #1b1b1c;/);
  assert.match(chatWindowSource, /maxWidth: "var\(--shell-content-max-width\)"/);
  assert.match(chatWindowSource, /maxWidth: "var\(--shell-composer-max-width\)"/);
  assert.match(chatInputSource, /maxWidth: "var\(--shell-composer-max-width\)"/);
  assert.doesNotMatch(chatWindowSource, /max-w-\[820px\]|maxWidth: 820/);
  assert.doesNotMatch(chatInputSource, /maxWidth: 820/);
});

test("uses semantic classes for the app shell regions", () => {
  assert.match(appShellSource, /className="app-shell"/);
  assert.match(appShellSource, /className="app-shell-center"/);
  assert.match(appShellSource, /className="app-shell-topbar"/);
  assert.match(appShellSource, /className="app-shell-toolbar"/);
  assert.match(appShellSource, /className="app-shell-chat"/);
  assert.match(appShellSource, /className="file-panel-header"/);
  assert.match(cssSource, /\.app-shell \{[\s\S]*?background: var\(--surface-base\);/);
  assert.match(cssSource, /\.app-shell-toolbar \{[\s\S]*?--shell-header-height/);
  assert.match(cssSource, /\.sidebar-overlay-backdrop\.is-open/);
  assert.match(cssSource, /\.right-panel-container \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/);
});

const tabBarSource = await readText("./TabBar.tsx");
test("file tabs use separate accessible select and close controls", () => {
  assert.match(tabBarSource, /role="tablist"/);
  assert.match(tabBarSource, /role="tab"/);
  assert.match(tabBarSource, /aria-selected=\{isActive\}/);
  assert.match(tabBarSource, /className="file-tab-main"/);
  assert.match(tabBarSource, /className="file-tab-close"/);
  assert.doesNotMatch(tabBarSource, /useState/);
  assert.match(cssSource, /\.file-tabs \{/);
  assert.match(cssSource, /\.file-tab\.is-active::after/);
});
