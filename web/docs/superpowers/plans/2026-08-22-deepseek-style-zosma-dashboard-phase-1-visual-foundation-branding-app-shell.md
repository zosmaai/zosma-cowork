# DeepSeek-Style Zosma Dashboard Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Zosma branding, DeepSeek-derived visual tokens, and a responsive app shell while keeping every existing Pi-Web control and workflow functional.

**Architecture:** Keep `AppShell` and its current state ownership intact. Add one small reusable brand component, map DeepSeek’s pinned colors and geometry onto existing semantic CSS variables, and move only shell/tab presentation from inline styles into named global classes. Existing sidebar, chat, file viewer, settings, and API behavior remain unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4 global CSS, Node test runner, ImageMagick for checked-in icon generation.

**Roadmap:** [`docs/superpowers/roadmaps/2026-08-22-deepseek-style-zosma-dashboard-roadmap.md`](../roadmaps/2026-08-22-deepseek-style-zosma-dashboard-roadmap.md)

**Phase:** Phase 1: Visual Foundation, Branding, and App Shell

---

## Scope Guard

This plan changes visual foundations only. Preserve all current event handlers, state ownership, API calls, sidebar contents, chat rendering, composer controls, top-bar actions, file viewer behavior, and settings behavior.

Explicitly defer:

- Workspace search/grouping redesign to Phase 2.
- User/assistant messages, thinking, tool rows, and composer redesign to Phase 3.
- Header action consolidation and file-entry redesign to Phase 4.
- Settings modal consolidation to Phase 5.
- Session metrics relocation and final cross-screen parity pass to Phase 6.

Use DeepSeek Harness commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` only as a visual reference. Do not import its packages or copy its component architecture.

## Known Lint Baseline Exception

The untouched repository currently has 15 ESLint errors, all from `react-hooks/preserve-manual-memoization`: six in `components/ChatInput.tsx`, five in `components/ChatMinimap.tsx`, two in `components/SessionSidebar.tsx`, and two in `hooks/useAgentSession.ts`. Fixing those React Compiler findings is outside this visual phase. Each lint gate below compares a sorted multiset of stable fingerprints: repository-relative file path, `ruleId`, normalized `message.message`, and occurrence count. Normalization strips line/column values and the React Compiler source excerpt so harmless line shifts do not create false failures; any new warning, error, rule, or semantic message still fails the gate. TypeScript and the complete Node test suite must still exit `0`.

## File Map

**Create:**

- `components/ZosmaBrand.tsx`: reusable Delta Leonis mark plus `zosma.ai` wordmark.
- `components/ZosmaShell.test.mjs`: source/asset contract checks for branding, tokens, shell classes, and tabs.
- `public/zosma-logo.png`: project-owned copy of approved flipped Delta Leonis artwork.

**Replace generated binary assets:**

- `app/favicon.ico`: exact Zosma website favicon.
- `public/icons/icon-192.png`: PWA icon generated from approved Delta Leonis artwork.
- `public/icons/icon-512.png`: PWA icon generated from approved Delta Leonis artwork.
- `public/icons/apple-touch-icon.png`: Apple icon generated from approved Delta Leonis artwork.

**Modify:**

- `app/layout.tsx`: Zosma metadata, favicon declaration, theme colors.
- `app/manifest.ts`: Zosma PWA identity and colors.
- `app/globals.css`: brand styles, DeepSeek-derived semantic variables, shell geometry, focus/motion rules, tab styles.
- `components/SessionSidebar.tsx`: replace animated Pi title with reusable Zosma brand while retaining version reveal.
- `components/ChatWindow.tsx`: replace empty-session Pi identity with Zosma brand and apply the shared 748px transcript/780px empty-composer width axis; do not restyle messages or controls.
- `components/ChatInput.tsx`: apply the shared 780px composer width cap without changing composer internals.
- `components/AppShell.tsx`: Zosma document title and semantic shell class names; retain all behavior.
- `components/TabBar.tsx`: semantic classes and separate accessible tab/close buttons.
- `components/MobilePwaLayout.test.mjs`: assert safe-area geometry in CSS classes instead of removed inline styles.
- `lib/panel-layout.ts`: match pinned DeepSeek sidebar width contract.
- `lib/panel-layout.test.mjs`: lock the new sidebar width constants.
- `lib/i18n/messages/en.ts`: Zosma update-link copy.
- `lib/i18n/messages/zh-CN.ts`: Zosma update-link copy.
- `public/offline.html`: Zosma name, colors, and icon.

Do not modify `package.json`, backend routes, session persistence, or the untracked `pnpm-lock.yaml`.

---

### Task 0: Capture the Existing ESLint Baseline

**Files:**
- Verify only; no source changes.

- [ ] **Step 1: Save the current ESLint JSON before modifying source**

Run:

```bash
node_modules/.bin/eslint . --format json > /tmp/zosma-phase1-eslint-baseline.json || test $? -eq 1
```

Expected: ESLint exits `1` and writes valid JSON.

- [ ] **Step 2: Verify the baseline is exactly the known 15-error set**

Run:

```bash
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const got={};for(const row of rows)for(const message of row.messages.filter((item)=>item.severity===2)){const file=path.relative(process.cwd(),row.filePath);got[file]??={};const rule=message.ruleId??"unknown";got[file][rule]=(got[file][rule]??0)+1}assert.deepEqual(got,{"components/ChatInput.tsx":{"react-hooks/preserve-manual-memoization":6},"components/ChatMinimap.tsx":{"react-hooks/preserve-manual-memoization":5},"components/SessionSidebar.tsx":{"react-hooks/preserve-manual-memoization":2},"hooks/useAgentSession.ts":{"react-hooks/preserve-manual-memoization":2}});console.log("ESLint baseline: 15 known errors")' /tmp/zosma-phase1-eslint-baseline.json
```

Expected: prints `ESLint baseline: 15 known errors` and exits `0`. If this assertion fails, stop and update the plan from the new repository baseline rather than masking an unknown failure.

---

### Task 1: Check In Zosma Identity and PWA Assets

**Files:**
- Create: `components/ZosmaBrand.tsx`
- Create: `components/ZosmaShell.test.mjs`
- Create: `public/zosma-logo.png`
- Replace: `app/favicon.ico`
- Replace: `public/icons/icon-192.png`
- Replace: `public/icons/icon-512.png`
- Replace: `public/icons/apple-touch-icon.png`
- Modify: `app/layout.tsx:1-60`
- Modify: `app/manifest.ts:1-31`
- Modify: `components/SessionSidebar.tsx:307-390,900-930`
- Modify: `components/ChatWindow.tsx:1-20,670-690`
- Modify: `components/AppShell.tsx:893-906`
- Modify: `lib/i18n/messages/en.ts:1-15`
- Modify: `lib/i18n/messages/zh-CN.ts:1-15`
- Modify: `public/offline.html:1-90`
- Modify: `app/globals.css:1-100`

- [ ] **Step 1: Write the failing branding contract test**

Create `components/ZosmaShell.test.mjs` with:

```js
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
```

- [ ] **Step 2: Run the branding test and verify it fails**

Run:

```bash
node --test components/ZosmaShell.test.mjs
```

Expected: FAIL with `ENOENT` for `components/ZosmaBrand.tsx` or `public/zosma-logo.png`.

- [ ] **Step 3: Copy approved source assets into project-owned paths**

Run from repository root:

```bash
cp "$HOME/Downloads/delta-leonis-logo-flipped.png" public/zosma-logo.png
cp "$HOME/code/zosmaai/zosma-ai-website/src/app/favicon.ico" app/favicon.ico
magick "$HOME/Downloads/delta-leonis-logo-flipped.png" -resize 192x192 -background '#0b8df8' -gravity center -extent 192x192 public/icons/icon-192.png
magick "$HOME/Downloads/delta-leonis-logo-flipped.png" -resize 512x512 -background '#0b8df8' -gravity center -extent 512x512 public/icons/icon-512.png
magick "$HOME/Downloads/delta-leonis-logo-flipped.png" -resize 180x180 -background '#0b8df8' -gravity center -extent 180x180 public/icons/apple-touch-icon.png
```

Verify generated formats and dimensions:

```bash
file app/favicon.ico public/zosma-logo.png public/icons/icon-192.png public/icons/icon-512.png public/icons/apple-touch-icon.png
```

Expected: ICO resource for `app/favicon.ico`; PNG images sized 936×938, 192×192, 512×512, and 180×180 respectively.

- [ ] **Step 4: Add the reusable brand component**

Create `components/ZosmaBrand.tsx`:

```tsx
interface ZosmaBrandProps {
  className?: string;
}

export function ZosmaBrand({ className }: ZosmaBrandProps) {
  return (
    <span
      className={`zosma-brand${className ? ` ${className}` : ""}`}
      aria-label="zosma.ai"
    >
      <img
        className="zosma-brand-mark"
        src="/zosma-logo.png"
        alt=""
        width={28}
        height={28}
      />
      <span className="zosma-brand-name">zosma.ai</span>
    </span>
  );
}
```

Add these rules after the theme-variable blocks near the top of `app/globals.css`:

```css
.zosma-brand {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
  color: var(--text);
}

.zosma-brand-mark {
  display: block;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: 8px;
  object-fit: cover;
}

.zosma-brand-name {
  overflow: hidden;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-title-button {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font: inherit;
}

.brand-title-button:focus-visible {
  border-radius: 8px;
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.brand-version {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
}

.new-session-brand .zosma-brand-mark {
  width: 32px;
  height: 32px;
  flex-basis: 32px;
  border-radius: 9px;
}

.new-session-brand .zosma-brand-name {
  font-size: 22px;
  line-height: 28px;
}
```

- [ ] **Step 5: Replace visible Pi identity while preserving version reveal and update behavior**

In `components/SessionSidebar.tsx`, add:

```tsx
import { ZosmaBrand } from "./ZosmaBrand";
```

Delete `SCRAMBLE_CHARS`, `useScramble()`, and `PiWebTitle()`. Replace them with:

```tsx
function BrandTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}`;

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    setShowVersion((current) => {
      const next = !current;
      if (next) {
        revertTimerRef.current = setTimeout(() => setShowVersion(false), 3000);
      }
      return next;
    });
  }, []);

  useEffect(() => () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
  }, []);

  return (
    <button
      type="button"
      className="brand-title-button"
      onClick={handleClick}
      aria-label={showVersion ? version : "zosma.ai"}
      title={showVersion ? "zosma.ai" : version}
    >
      {showVersion ? <span className="brand-version">{version}</span> : <ZosmaBrand />}
    </button>
  );
}
```

Replace the sidebar header use:

```tsx
<BrandTitle />
```

In `components/ChatWindow.tsx`, add:

```tsx
import { ZosmaBrand } from "./ZosmaBrand";
```

Replace the empty-session `π` and `Pi Web` spans with:

```tsx
<ZosmaBrand className="new-session-brand" />
```

Keep `NewSessionUpdateLink` directly after the brand.

In `components/AppShell.tsx`, replace the title expression with:

```tsx
const windowTitle = activeCwdName ? `${activeCwdName} - zosma.ai` : "zosma.ai";
```

In both locale files, change only the visible update string:

```ts
"appUpdate.releaseNotes": "zosma.ai v{version} is available. View release notes",
```

```ts
"appUpdate.releaseNotes": "zosma.ai v{version} 可用，查看更新说明",
```

Do not rename storage keys, package names, API identifiers, logging prefixes, or test fixture paths containing `pi-web`.

- [ ] **Step 6: Update browser and install metadata**

Replace the metadata object in `app/layout.tsx` with:

```tsx
export const metadata: Metadata = {
  title: "zosma.ai",
  description: "zosma.ai interface for the Pi coding agent",
  applicationName: "zosma.ai",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/favicon.ico",
        type: "image/x-icon",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "zosma.ai",
  },
  formatDetection: {
    telephone: false,
  },
};
```

Update only the `themeColor` values in the existing viewport object:

```tsx
themeColor: [
  { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  { media: "(prefers-color-scheme: dark)", color: "#151517" },
],
```

Replace `app/manifest.ts` with:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "zosma.ai",
    short_name: "zosma.ai",
    description: "Local zosma.ai interface for the Pi coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#151517",
    theme_color: "#151517",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
```

In `public/offline.html`, make these exact replacements:

```html
<meta name="theme-color" content="#151517" />
<title>zosma.ai is offline</title>
```

```css
background: #151517;
color: #f9fafb;
```

```html
<img src="/icons/icon-192.png" alt="" />
<h1>zosma.ai is offline</h1>
<p>Reconnect to the local zosma.ai server, then try again.</p>
```

- [ ] **Step 7: Run focused checks**

Run:

```bash
node --test components/ZosmaShell.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: both commands PASS.

- [ ] **Step 8: Commit Zosma identity**

```bash
git add app/favicon.ico app/layout.tsx app/manifest.ts app/globals.css components/ZosmaBrand.tsx components/ZosmaShell.test.mjs components/SessionSidebar.tsx components/ChatWindow.tsx components/AppShell.tsx lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts public/zosma-logo.png public/icons/icon-192.png public/icons/icon-512.png public/icons/apple-touch-icon.png public/offline.html
git commit -m "feat: apply Zosma product identity"
```

---

### Task 2: Add DeepSeek-Derived Theme Tokens and Shell Geometry

**Files:**
- Modify: `components/ZosmaShell.test.mjs`
- Modify: `app/globals.css:1-110,1218-1417`
- Modify: `components/ChatWindow.tsx:665-705`
- Modify: `components/ChatInput.tsx:1378-1385`
- Modify: `lib/panel-layout.ts:1-10`
- Modify: `lib/panel-layout.test.mjs:1-45`

- [ ] **Step 1: Extend tests with token and sidebar geometry contracts**

Add the additional source inputs in `components/ZosmaShell.test.mjs`:

```js
const cssSource = await readText("../app/globals.css");
const chatInputSource = await readText("./ChatInput.tsx");
```

Add:

```js
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
```

In `lib/panel-layout.test.mjs`, include the constants in the import:

```js
const {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampPanelWidth,
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
} = await jiti.import("./panel-layout.ts");
```

Add:

```js
test("uses the pinned DeepSeek sidebar width contract", () => {
  assert.equal(SIDEBAR_DEFAULT_WIDTH, 280);
  assert.equal(SIDEBAR_MIN_WIDTH, 264);
  assert.equal(SIDEBAR_MAX_WIDTH, 420);
});
```

- [ ] **Step 2: Run tests and verify the old values fail**

Run:

```bash
node --test components/ZosmaShell.test.mjs
node --experimental-strip-types --test lib/panel-layout.test.mjs
```

Expected: FAIL because the new semantic tokens do not exist and sidebar constants remain `260`, `180`, and `480`.

- [ ] **Step 3: Replace the existing light/dark variable blocks**

Keep the existing `@theme` mapping. Replace the first `:root` and `html.dark` blocks in `app/globals.css` with:

```css
:root {
  color-scheme: light;
  --bg: #ffffff;
  --bg-panel: #f9fafb;
  --bg-hover: rgba(38, 49, 72, 0.06);
  --bg-selected: #ebeef2;
  --border: rgba(0, 0, 0, 0.10);
  --text: #0f1115;
  --text-muted: #61666b;
  --text-dim: #81858c;
  --accent: #4176e6;
  --accent-hover: #5686fe;
  --user-bg: #edf3fe;
  --assistant-bg: #ffffff;
  --tool-bg: #f9fafb;
  --bg-subtle: #f5f6f7;

  --surface-base: #ffffff;
  --surface-sidebar: #f9fafb;
  --surface-elevated: #ffffff;
  --surface-overlay: #ffffff;
  --interactive-hover: rgba(38, 49, 72, 0.06);
  --interactive-active: rgba(38, 49, 72, 0.10);
  --border-subtle: rgba(0, 0, 0, 0.04);
  --border-strong: rgba(0, 0, 0, 0.12);
  --overlay-mask: rgba(0, 0, 0, 0.24);
  --shadow-lv1: 0 2px 4px rgba(0, 0, 0, 0.05);
  --shadow-lv2: 0 4px 12px rgba(0, 0, 0, 0.02), 0 2px 8px rgba(0, 0, 0, 0.04);
  --shadow-lv3: 0 0 1px rgba(0, 0, 0, 0.20), 0 0 4px rgba(0, 0, 0, 0.02), 0 12px 32px rgba(0, 0, 0, 0.08);

  --radius-control: 12px;
  --radius-panel: 22px;
  --shell-content-max-width: 748px;
  --shell-composer-max-width: 780px;
  --shell-header-height: 48px;
  --motion-fast: 100ms;
  --motion-normal: 200ms;
  --motion-slow: 300ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}

html.dark {
  color-scheme: dark;
  --bg: #151517;
  --bg-panel: #1b1b1c;
  --bg-hover: rgba(255, 255, 255, 0.08);
  --bg-selected: #43454a;
  --border: rgba(255, 255, 255, 0.12);
  --text: #f9fafb;
  --text-muted: #cfd3d6;
  --text-dim: #adb2b8;
  --accent: #679efe;
  --accent-hover: #4176e6;
  --user-bg: #2c2c2e;
  --assistant-bg: #151517;
  --tool-bg: #232324;
  --bg-subtle: #232324;

  --surface-base: #151517;
  --surface-sidebar: #1b1b1c;
  --surface-elevated: #2c2c2e;
  --surface-overlay: #353638;
  --interactive-hover: rgba(255, 255, 255, 0.08);
  --interactive-active: rgba(255, 255, 255, 0.14);
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-strong: rgba(255, 255, 255, 0.16);
  --overlay-mask: rgba(0, 0, 0, 0.50);
  --shadow-lv1: 0 2px 4px rgba(0, 0, 0, 0.18);
  --shadow-lv2: 0 4px 12px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.16);
  --shadow-lv3: 0 0 1px rgba(255, 255, 255, 0.08), 0 12px 32px rgba(0, 0, 0, 0.36);
}
```

Keep the later `--font-mono` declaration. Update the `html, body` font stack to match the reference without adding a webfont:

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
```

Add shared native-control and focus treatment after `* { box-sizing: border-box; }`:

```css
button,
input,
textarea,
select {
  font: inherit;
}

button,
a,
[role="button"],
[role="tab"] {
  -webkit-tap-highlight-color: transparent;
}

button:focus-visible,
a:focus-visible,
[role="button"]:focus-visible,
[role="tab"]:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

At the end of `app/globals.css`, add:

```css
@media (prefers-reduced-motion: reduce) {
  html:focus-within {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: Adopt the reference sidebar width contract**

In `lib/panel-layout.ts`, replace only the sidebar constants:

```ts
export const SIDEBAR_DEFAULT_WIDTH = 280;
export const SIDEBAR_MIN_WIDTH = 264;
export const SIDEBAR_MAX_WIDTH = 420;
```

Do not copy DeepSeek’s collapsed desktop rail. Zosma’s current desktop close behavior remains until Phase 2 redesigns workspace navigation.

- [ ] **Step 5: Apply the shared transcript and composer width axis**

In `components/ChatWindow.tsx`, replace the empty-session wrapper:

```tsx
<div className="w-full" style={{ maxWidth: "var(--shell-composer-max-width)" }}>
```

Replace the transcript content wrapper with:

```tsx
<div
  ref={messageContentRef}
  style={{
    width: "100%",
    minWidth: 0,
    maxWidth: "var(--shell-content-max-width)",
    margin: "0 auto",
  }}
>
```

In `components/ChatInput.tsx`, replace the outer `maxWidth: 820` wrapper value with:

```tsx
<div style={{ maxWidth: "var(--shell-composer-max-width)", margin: "0 auto" }}>
```

These are geometry-only substitutions. Do not alter message rendering, composer content, or responsive padding.

- [ ] **Step 6: Run focused and regression checks**

Run:

```bash
node --test components/ZosmaShell.test.mjs
node --experimental-strip-types --test lib/panel-layout.test.mjs
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint . --format json > /tmp/zosma-phase1-eslint-task2.json || test $? -eq 1
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const normalize=(value)=>value.replace(/\r\n/g,"\n").replace(/\n\n(?:[A-Za-z]:)?[\\/][^\n]*:\d+:\d+\n[\s\S]*$/," ").replace(/\b(?:line|column)\s+\d+\b/gi,(match)=>match.replace(/\d+/,"#")).replace(/\s+/g," ").trim();const fingerprints=(file)=>{const counts=new Map();for(const row of JSON.parse(fs.readFileSync(file,"utf8")))for(const message of row.messages.filter((item)=>item.severity>0)){const key=JSON.stringify([path.relative(process.cwd(),row.filePath),message.ruleId??"unknown",normalize(message.message)]);counts.set(key,(counts.get(key)??0)+1)}return [...counts].sort(([a],[b])=>a.localeCompare(b))};assert.deepEqual(fingerprints(process.argv[2]),fingerprints(process.argv[1]));console.log("ESLint stable fingerprints unchanged from baseline")' /tmp/zosma-phase1-eslint-baseline.json /tmp/zosma-phase1-eslint-task2.json
```

Expected: tests and TypeScript PASS; the comparison prints `ESLint stable fingerprints unchanged from baseline`. ESLint itself still exits `1` only for the 15 documented baseline errors.

- [ ] **Step 7: Commit visual tokens and geometry**

```bash
git add app/globals.css components/ZosmaShell.test.mjs components/ChatWindow.tsx components/ChatInput.tsx lib/panel-layout.ts lib/panel-layout.test.mjs
git commit -m "style: add DeepSeek shell foundations"
```

---

### Task 3: Move App Shell Geometry into Semantic Classes

**Files:**
- Modify: `components/ZosmaShell.test.mjs`
- Modify: `components/MobilePwaLayout.test.mjs:1-45`
- Modify: `components/AppShell.tsx:1558-2250`
- Modify: `app/globals.css:1218-1417`

- [ ] **Step 1: Add failing shell-structure and safe-area assertions**

Add to `components/ZosmaShell.test.mjs`:

```js
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
```

In `components/MobilePwaLayout.test.mjs`, replace inline-style assertions inside `tracks the visual viewport while the software keyboard is open` with:

```js
assert.match(appShellSource, /useViewportHeight\(\)/);
assert.match(appShellSource, /className="app-shell"/);
assert.match(appShellSource, /className="app-shell-toolbar"/);
assert.match(cssSource, /\.app-shell \{[\s\S]*?padding-left: env\(safe-area-inset-left\);[\s\S]*?padding-right: env\(safe-area-inset-right\);/);
assert.match(cssSource, /\.sidebar-container \{[\s\S]*?padding-top: env\(safe-area-inset-top\);[\s\S]*?padding-bottom: env\(safe-area-inset-bottom\);/);
assert.match(cssSource, /\.app-shell-toolbar \{[\s\S]*?height: calc\(var\(--shell-header-height\) \+ env\(safe-area-inset-top\)\);[\s\S]*?padding-top: env\(safe-area-inset-top\);/);
assert.match(cssSource, /\.file-panel-header \{[\s\S]*?height: calc\(var\(--shell-header-height\) \+ env\(safe-area-inset-top\)\);[\s\S]*?padding-top: env\(safe-area-inset-top\);/);
assert.match(cssSource, /\.app-shell \{[\s\S]*?height: var\(--app-viewport-height, 100dvh\);/);
assert.match(appShellSource, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
```

Keep the existing viewport-hook, chat-window bottom inset, markdown overflow, and iOS input zoom assertions unchanged.

- [ ] **Step 2: Run source-contract tests and verify they fail**

Run:

```bash
node --test components/ZosmaShell.test.mjs components/MobilePwaLayout.test.mjs
```

Expected: FAIL because the new classes do not exist and safe-area geometry still lives inline.

- [ ] **Step 3: Apply semantic class names without changing handlers or conditional rendering**

In `components/AppShell.tsx`, replace only presentation wrappers.

Root shell:

```tsx
<div className="app-shell">
```

Sidebar backdrop:

```tsx
<div
  className={`sidebar-overlay-backdrop${sidebarOpen ? " is-open" : ""}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
  onClick={() => setSidebarOpen(false)}
/>
```

Sidebar container keeps only its dynamic CSS variable inline:

```tsx
<div
  ref={sidebarResizer.panelRef}
  id="session-sidebar"
  className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
  style={{
    "--sidebar-width": `${sidebarResizer.width}px`,
  } as React.CSSProperties}
>
  {sidebarContent}
</div>
```

Center and header wrappers:

```tsx
<div className="app-shell-center">
  <div ref={topBarRef} className="app-shell-topbar">
    <div className="app-shell-toolbar">
```

Chat surface:

```tsx
<div className="app-shell-chat">
```

Right panel keeps only its dynamic width inline:

```tsx
<div
  ref={rightPanelResizer.panelRef}
  id="file-panel"
  className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
  style={{
    "--right-panel-width": `${rightPanelResizer.width}px`,
  } as React.CSSProperties}
>
```

Right panel children:

```tsx
<div className="file-panel-header">
  <div className="file-panel-tabs">
```

```tsx
<div className="file-panel-body">
```

Do not change any buttons, callbacks, panels, session-state branches, or modal mounts in this task.

- [ ] **Step 4: Add shell class rules and update existing responsive rules**

Add before the existing resize-handle rules in `app/globals.css`:

```css
.app-shell {
  display: flex;
  width: 100%;
  height: var(--app-viewport-height, 100dvh);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  overflow: hidden;
  background: var(--surface-base);
}

.app-shell-center {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-base);
}

.app-shell-topbar {
  position: relative;
  z-index: 10;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--surface-base) 94%, transparent);
}

.app-shell-toolbar {
  position: relative;
  display: flex;
  align-items: center;
  height: calc(var(--shell-header-height) + env(safe-area-inset-top));
  padding-top: env(safe-area-inset-top);
  border-bottom: 1px solid var(--border-subtle);
}

.app-shell-chat {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-base);
}

.sidebar-overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 199;
  border: 0;
  background: var(--overlay-mask);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion-normal) var(--ease-standard);
}

.sidebar-overlay-backdrop.is-open {
  opacity: 1;
  pointer-events: auto;
}

.sidebar-container {
  z-index: 200;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-sidebar);
}

.right-panel-container {
  display: flex;
  min-width: 0;
  flex-shrink: 0;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border-strong);
  background: var(--surface-base);
}

.file-panel-header {
  display: flex;
  align-items: center;
  height: calc(var(--shell-header-height) + env(safe-area-inset-top));
  padding-top: env(safe-area-inset-top);
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-base);
}

.file-panel-tabs {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.file-panel-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
}
```

In the existing desktop sidebar rules, use the phase token and new fallback:

```css
.sidebar-container {
  position: relative;
  overflow: hidden;
  transition: width var(--motion-slow) var(--ease-standard), min-width var(--motion-slow) var(--ease-standard);
}

.sidebar-container.sidebar-open {
  width: var(--sidebar-width, 280px);
  min-width: var(--sidebar-width, 280px);
}

.sidebar-container > * {
  width: var(--sidebar-width, 280px);
  min-width: var(--sidebar-width, 280px);
}
```

Use `var(--motion-slow) var(--ease-standard)` for right-panel width/transform transitions and `var(--motion-normal) var(--ease-standard)` for overlay opacity. Keep the existing desktop/compact/mobile breakpoints and open/closed behavior unchanged.

Move these existing mobile-pending rules from the component-local `<style>` block into the existing `@media (max-width: 640px)` block in `app/globals.css`:

```css
.sidebar-overlay-backdrop.sidebar-mobile-pending {
  opacity: 0 !important;
  pointer-events: none !important;
}

.sidebar-container.sidebar-mobile-pending.sidebar-open {
  transform: translateX(calc(-100% - env(safe-area-inset-left)));
  box-shadow: none;
}
```

Remove only those moved rules from the component-local `<style>` block. Leave session-info animation and mobile session-stat container queries for their owning later phases.

- [ ] **Step 5: Run focused tests, typecheck, and lint**

Run:

```bash
node --test components/ZosmaShell.test.mjs components/MobilePwaLayout.test.mjs
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint . --format json > /tmp/zosma-phase1-eslint-task3.json || test $? -eq 1
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const normalize=(value)=>value.replace(/\r\n/g,"\n").replace(/\n\n(?:[A-Za-z]:)?[\\/][^\n]*:\d+:\d+\n[\s\S]*$/," ").replace(/\b(?:line|column)\s+\d+\b/gi,(match)=>match.replace(/\d+/,"#")).replace(/\s+/g," ").trim();const fingerprints=(file)=>{const counts=new Map();for(const row of JSON.parse(fs.readFileSync(file,"utf8")))for(const message of row.messages.filter((item)=>item.severity>0)){const key=JSON.stringify([path.relative(process.cwd(),row.filePath),message.ruleId??"unknown",normalize(message.message)]);counts.set(key,(counts.get(key)??0)+1)}return [...counts].sort(([a],[b])=>a.localeCompare(b))};assert.deepEqual(fingerprints(process.argv[2]),fingerprints(process.argv[1]));console.log("ESLint stable fingerprints unchanged from baseline")' /tmp/zosma-phase1-eslint-baseline.json /tmp/zosma-phase1-eslint-task3.json
```

Expected: tests and TypeScript PASS; the comparison prints `ESLint stable fingerprints unchanged from baseline`.

- [ ] **Step 6: Commit semantic shell structure**

```bash
git add app/globals.css components/AppShell.tsx components/MobilePwaLayout.test.mjs components/ZosmaShell.test.mjs
git commit -m "style: establish Zosma app shell"
```

---

### Task 4: Restyle the File Tab Strip Without Losing Interaction

**Files:**
- Modify: `components/ZosmaShell.test.mjs`
- Modify: `components/TabBar.tsx:1-118`
- Modify: `app/globals.css`

- [ ] **Step 1: Add failing tab semantics and styling assertions**

Add `tabBarSource` to the `Promise.all` inputs in `components/ZosmaShell.test.mjs`:

```js
const tabBarSource = await readText("./TabBar.tsx");
```

Add:

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test components/ZosmaShell.test.mjs
```

Expected: FAIL because `TabBar` still uses inline styles and local hover state.

- [ ] **Step 3: Replace `components/TabBar.tsx` with semantic markup**

Use this complete file:

```tsx
"use client";

import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();

  return (
    <div className="file-tabs" role="tablist" aria-label={t("files.explorer")}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`file-tab${isActive ? " is-active" : ""}`}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              onCloseTab(tab.id);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className="file-tab-main"
              title={tab.filePath}
              onClick={() => onSelectTab(tab.id)}
            >
              <span className="file-tab-icon" aria-hidden="true">
                {getFileIcon(tab.label, 13)}
              </span>
              <span className="file-tab-label">{tab.label}</span>
            </button>
            <button
              type="button"
              className="file-tab-close"
              onClick={() => onCloseTab(tab.id)}
              title={t("i18n.close")}
              aria-label={`${t("i18n.close")} ${tab.label}`}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Add DeepSeek-style tab-strip CSS**

Add to `app/globals.css` near the shell classes:

```css
.file-tabs {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.file-tabs::-webkit-scrollbar {
  display: none;
}

.file-tab {
  position: relative;
  display: flex;
  min-width: 80px;
  max-width: 200px;
  height: 100%;
  flex: 0 0 auto;
  align-items: stretch;
  color: var(--text-dim);
}

.file-tab::after {
  position: absolute;
  right: 10px;
  bottom: 0;
  left: 10px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
  content: "";
}

.file-tab.is-active {
  color: var(--accent);
}

.file-tab.is-active::after {
  background: var(--accent);
}

.file-tab-main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 12px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.file-tab:hover {
  background: var(--interactive-hover);
}

.file-tab-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  opacity: 0.75;
}

.file-tab.is-active .file-tab-icon {
  opacity: 1;
}

.file-tab-label {
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-tab-close {
  display: inline-flex;
  width: 28px;
  height: 28px;
  margin: auto 4px auto 0;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}

.file-tab-close:hover,
.file-tab-close:focus-visible {
  background: var(--interactive-hover);
  color: var(--text);
}
```

- [ ] **Step 5: Run focused and full automated checks**

Run:

```bash
node --test components/ZosmaShell.test.mjs components/MobilePwaLayout.test.mjs
node_modules/.bin/tsc --noEmit
npm test
node_modules/.bin/eslint . --format json > /tmp/zosma-phase1-eslint-task4.json || test $? -eq 1
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const normalize=(value)=>value.replace(/\r\n/g,"\n").replace(/\n\n(?:[A-Za-z]:)?[\\/][^\n]*:\d+:\d+\n[\s\S]*$/," ").replace(/\b(?:line|column)\s+\d+\b/gi,(match)=>match.replace(/\d+/,"#")).replace(/\s+/g," ").trim();const fingerprints=(file)=>{const counts=new Map();for(const row of JSON.parse(fs.readFileSync(file,"utf8")))for(const message of row.messages.filter((item)=>item.severity>0)){const key=JSON.stringify([path.relative(process.cwd(),row.filePath),message.ruleId??"unknown",normalize(message.message)]);counts.set(key,(counts.get(key)??0)+1)}return [...counts].sort(([a],[b])=>a.localeCompare(b))};assert.deepEqual(fingerprints(process.argv[2]),fingerprints(process.argv[1]));console.log("ESLint stable fingerprints unchanged from baseline")' /tmp/zosma-phase1-eslint-baseline.json /tmp/zosma-phase1-eslint-task4.json
```

Expected: focused tests, TypeScript, and the full test suite PASS; the comparison prints `ESLint stable fingerprints unchanged from baseline`.

- [ ] **Step 6: Commit the tab-strip foundation**

```bash
git add app/globals.css components/TabBar.tsx components/ZosmaShell.test.mjs
git commit -m "style: align file tabs with Zosma shell"
```

---

### Task 5: Verify the Phase Boundary and Visual Baseline

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Verify repository state and avoid the untracked lockfile**

Run:

```bash
git status --short
git diff --check HEAD~4..HEAD
```

Expected: no tracked changes. `?? pnpm-lock.yaml` may remain and must not be added.

- [ ] **Step 2: Run the complete automated gate**

Run:

```bash
node_modules/.bin/tsc --noEmit
npm test
node_modules/.bin/eslint . --format json > /tmp/zosma-phase1-eslint-final.json || test $? -eq 1
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const normalize=(value)=>value.replace(/\r\n/g,"\n").replace(/\n\n(?:[A-Za-z]:)?[\\/][^\n]*:\d+:\d+\n[\s\S]*$/," ").replace(/\b(?:line|column)\s+\d+\b/gi,(match)=>match.replace(/\d+/,"#")).replace(/\s+/g," ").trim();const fingerprints=(file)=>{const counts=new Map();for(const row of JSON.parse(fs.readFileSync(file,"utf8")))for(const message of row.messages.filter((item)=>item.severity>0)){const key=JSON.stringify([path.relative(process.cwd(),row.filePath),message.ruleId??"unknown",normalize(message.message)]);counts.set(key,(counts.get(key)??0)+1)}return [...counts].sort(([a],[b])=>a.localeCompare(b))};assert.deepEqual(fingerprints(process.argv[2]),fingerprints(process.argv[1]));console.log("ESLint stable fingerprints unchanged from baseline")' /tmp/zosma-phase1-eslint-baseline.json /tmp/zosma-phase1-eslint-final.json
```

Expected: TypeScript and tests exit `0`; the lint comparison prints `ESLint stable fingerprints unchanged from baseline`. The raw ESLint command exits `1` only for the documented pre-existing 15 errors.

Do not run `next build`; project instructions prohibit it during development because it pollutes `.next/`.

- [ ] **Step 3: Start the development server for manual comparison**

Run:

```bash
npm run dev
```

Expected: Next.js serves the app at `http://127.0.0.1:30141`.

- [ ] **Step 4: Compare shell states against the pinned DeepSeek reference**

Open Zosma Harness and sibling DeepSeek Harness at commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Check:

1. Light theme: white conversation canvas, subtle bluish sidebar, quiet borders, 280px default sidebar.
2. Centered geometry: transcript content caps at 748px; empty and active composers cap at 780px while shrinking cleanly on narrow viewports.
3. Dark theme: `#151517` base, `#1b1b1c` sidebar, readable muted text, restrained borders.
4. Zosma logo and `zosma.ai` appear in sidebar and empty-session identity with no visible Pi Web or DeepSeek branding.
5. Browser tab, install metadata, offline page, favicon, Apple icon, and PWA icons use Zosma identity.
6. Desktop sidebar open/close and resize still work.
7. File panel opens, closes, resizes on wide desktop, and overlays on compact desktop with its header/body filling the column.
8. File tabs select, close, middle-click close, scroll horizontally, and show keyboard focus.
9. Existing theme, language, branches, title generation, system prompt, session details, file toggle, and settings buttons remain reachable.
10. Mobile sidebar drawer, backdrop, safe areas, top toolbar, and full-screen file panel remain usable at 390×844.
11. Reduced-motion mode removes shell transitions without hiding state changes.

Phase 1 is complete when these shell states match directionally and all existing workflows remain functional. Do not tune messages, composer, thinking/tool rows, workspace hierarchy, settings layout, or metrics here; those belong to later phases.
