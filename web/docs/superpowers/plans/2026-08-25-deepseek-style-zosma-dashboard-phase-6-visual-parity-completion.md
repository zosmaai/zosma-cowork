# DeepSeek-Style Zosma Dashboard Visual Parity Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 6 by converting the remaining Pi extension-host surfaces to the established DeepSeek-style Zosma presentation and proving final responsive, theme, accessibility, and behavioral parity.

**Architecture:** Preserve Pi's existing `ctx.ui.*` to RPC/SSE to React compatibility path. Extract inline notice and blocking-extension renderers from `ChatWindow.tsx`, reuse the focus-trap pattern from `SettingsShell.tsx`, and route existing widget placements to real above-editor and below-editor regions. Add one environment-gated project extension fixture for deterministic browser acceptance; the browser remains the renderer and no React value crosses RPC.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4 entrypoint plus `app/globals.css`, Node test runner, Jiti, React server rendering, Pi project extensions

**Roadmap:** `docs/superpowers/roadmaps/2026-08-22-deepseek-style-zosma-dashboard-roadmap.md`

**Phase:** Phase 6: Metrics, Responsive Hardening, and Visual Parity — completion after the metrics/header tasks

---

## Current State

At `aa557de`, identity, shell, workspaces, conversation flow, composer, Pi actions, files, settings, and composer metrics are implemented. This plan supersedes only the unexecuted visual-audit portion of `docs/superpowers/plans/2026-08-23-deepseek-style-zosma-dashboard-phase-6-metrics-responsive-visual-parity.md`.

Concrete remaining mismatches:

- `NoticeShelf` is a large inline-styled card instead of a DSH toast.
- Blocking extension dialogs and ANSI custom panels use old 8px inline panels and do not trap/restore focus.
- The hidden custom-panel capture textarea is programmatically focused but remains in the default tab order.
- Extension status/widgets look like an IDE footer.
- `widgetPlacement` is represented by an arrow instead of physical placement.
- Overlay states lack a deterministic browser fixture and final screenshots.

## Scope Guard

Preserve without behavioral or protocol changes:

- `lib/rpc-manager.ts:createExtensionUiContext()`.
- `lib/types.ts:ExtensionUiRequest`.
- `hooks/useAgentSession.ts` event routing.
- Dialog response shapes, timeouts, terminal keyboard conversion, IME, bracketed paste, Ctrl+C, ANSI rendering, status sorting, widget updates, and update cleanup.
- Pi sessions, branches, files, worktrees, settings APIs, and current markdown stack.

Do not add DeepSeek packages, Cordis, remote slots, a declarative surface protocol, browser ESM extensions, a component library, `clsx`, Shiki, `anser`, `setHeader`, `setFooter`, working indicators, autocomplete, editor replacement, theme APIs, or tool-expanded state.

Never run `next build`.

## Reference Files

Pinned DSH commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

- `../deepseek-harness/packages/client/ui-primitives/src/Modal.module.css`
- `../deepseek-harness/packages/client/ui-primitives/src/Button.module.css`
- `../deepseek-harness/packages/client/ui-primitives/src/Input.module.css`
- `../deepseek-harness/packages/client/ui-primitives/src/Toast.module.css`
- `../deepseek-harness/packages/client/ui-primitives/src/TerminalBlock.module.css`
- `../deepseek-harness/packages/client/ui-primitives/src/DisclosureRow.module.css`
- `../deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`
- `../deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css`

## File Map

Create:

- `components/NoticeShelf.tsx`
- `components/NoticeShelf.test.mjs`
- `components/ExtensionOverlays.tsx`
- `components/ExtensionOverlays.test.mjs`
- `.pi/extensions/zosma-ui-audit.ts`
- `components/ExtensionVisualFixture.test.mjs`

Modify:

- `components/ChatWindow.tsx`
- `components/ExtensionStatusBar.tsx`
- `components/ExtensionStatusBar.test.mjs`
- `components/ExtensionWidgets.tsx`
- `components/ExtensionWidgets.test.mjs`
- `components/SessionMetricsLine.test.mjs`
- `app/globals.css`

Do not modify:

- `lib/rpc-manager.ts`
- `lib/types.ts`
- `hooks/useAgentSession.ts`
- `lib/ansi.ts`
- `lib/terminal-input.ts`
- API routes, `package.json`, or lockfiles

## Safe Edit Protocol

Before changing `ChatWindow.tsx` or `app/globals.css`:

```bash
sha256sum components/ChatWindow.tsx app/globals.css
wc -c -l components/ChatWindow.tsx app/globals.css
cp components/ChatWindow.tsx /tmp/phase6-ChatWindow.$(date +%s).bak
cp app/globals.css /tmp/phase6-globals.$(date +%s).bak
```

Use the `write` tool for complete new files and bounded exact replacement for existing files. Do not use shell heredocs or Python string replacement. Re-read every changed region, then run:

```bash
git diff --check
node_modules/.bin/tsc --noEmit
```

Expected: no output.

---

### Task 0: Freeze Baseline

**Files:** None

- [ ] **Step 1: Verify repository state**

```bash
git rev-parse --short HEAD
git status --short
git -C ../deepseek-harness rev-parse HEAD
git -C ../deepseek-harness status --short
```

Expected: no tracked Zosma changes; existing untracked plan files and `pnpm-lock.yaml` remain untouched; DSH is pinned and clean.

- [ ] **Step 2: Capture tests and lint fingerprint**

```bash
npm test
node_modules/.bin/tsc --noEmit
set +e
npm run lint > /tmp/phase6-eslint-baseline.log 2>&1
status=$?
printf 'lint_status=%s\n' "$status"
grep -Eo '[0-9]+ problems? \([0-9]+ errors?, [0-9]+ warnings?\)' /tmp/phase6-eslint-baseline.log | tail -1
```

Expected at plan time: 692 tests pass, TypeScript passes, lint reports only the existing 15 `react-hooks/preserve-manual-memoization` errors and zero warnings. Stop on any other result.

- [ ] **Step 3: Prepare audit storage**

```bash
mkdir -p /tmp/zosma-phase6-completion/{reference,before,after,notes}
printf '%s\n' 'viewport,theme,state,reference,current,result' > /tmp/zosma-phase6-completion/notes/audit.csv
```

No commit.

---
### Task 1: Replace Inline Notice Cards with DSH-Style Toasts

**Files:**
- Create: `components/NoticeShelf.tsx`
- Create: `components/NoticeShelf.test.mjs`
- Modify: `components/ChatWindow.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the failing test**

Create `components/NoticeShelf.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { NoticeShelf } = await jiti.import("./NoticeShelf.tsx");

function render(notices, floating = false) {
  return renderToStaticMarkup(
    React.createElement(NoticeShelf, { notices, floating }),
  );
}

test("renders nothing without notices", () => {
  assert.equal(render([]), "");
});

test("renders typed accessible notices without inline presentation", () => {
  const html = render([
    { id: "info", message: "Connected", type: "info" },
    { id: "warning", message: "Check configuration", type: "warning" },
    { id: "error", message: "Connection failed", type: "error" },
    { id: "success", message: "Saved", type: "success" },
  ]);

  assert.match(html, /class="notice-shelf"/);
  for (const type of ["info", "warning", "error", "success"]) {
    assert.match(html, new RegExp(`notice-shelf-item is-${type}`));
  }
  assert.match(html, /role="alert"[^>]*aria-atomic="true"/);
  assert.equal((html.match(/role="status"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /style=/);
});

test("marks floating and exiting states", () => {
  const html = render([
    { id: "done", message: "Done", type: "success", exiting: true },
  ], true);

  assert.match(html, /notice-shelf is-floating/);
  assert.match(html, /notice-shelf-item is-success is-exiting/);
  assert.match(html, /notice-shelf-dot/);
  assert.match(html, /notice-shelf-text/);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test components/NoticeShelf.test.mjs
```

Expected: FAIL because `NoticeShelf.tsx` does not exist.

- [ ] **Step 3: Implement the semantic renderer**

Create `components/NoticeShelf.tsx`:

```tsx
"use client";

import type { NoticeItem } from "@/hooks/useAgentSession";

export function NoticeShelf({
  notices,
  floating = false,
}: {
  notices: NoticeItem[];
  floating?: boolean;
}) {
  if (notices.length === 0) return null;

  return (
    <div className={`notice-shelf${floating ? " is-floating" : ""}`}>
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={`notice-shelf-item is-${notice.type}${notice.exiting ? " is-exiting" : ""}`}
          role={notice.type === "error" ? "alert" : "status"}
          aria-atomic="true"
        >
          <span className="notice-shelf-dot" aria-hidden="true" />
          <span className="notice-shelf-text">{notice.message}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Move ownership out of `ChatWindow`**

Add:

```tsx
import { NoticeShelf } from "./NoticeShelf";
```

Remove `NoticeItem` from the `useAgentSession` type import. Keep the existing `<NoticeShelf notices={notices} floating />` call. Delete the local `NoticeShelf` function in full.

- [ ] **Step 5: Add semantic toast tokens**

Add beside the existing state tokens in `:root`:

```css
  --state-warning: #d97706;
  --state-info: #4176e6;
  --toast-bg: #43454a;
  --toast-text: #ffffff;
```

Add beside the existing state tokens in `html.dark`:

```css
  --state-warning: #f7ad31;
  --state-info: #679efe;
  --toast-bg: #43454a;
  --toast-text: #ffffff;
```

- [ ] **Step 6: Replace old notice keyframes with complete toast CSS**

```css
.notice-shelf {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  pointer-events: none;
}
.notice-shelf.is-floating { margin-bottom: 0; }
.notice-shelf-item {
  display: flex;
  box-sizing: border-box;
  width: fit-content;
  max-width: min(560px, calc(100vw - 48px));
  min-height: 46px;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--toast-bg);
  color: var(--toast-text);
  box-shadow: var(--shadow-lv3);
  font-size: 14px;
  line-height: 22px;
  animation: notice-shelf-in var(--motion-normal) var(--ease-standard) both;
}
.notice-shelf-item.is-exiting {
  animation: notice-shelf-out 180ms ease-in forwards;
}
.notice-shelf-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--state-info);
}
.notice-shelf-item.is-warning .notice-shelf-dot { background: var(--state-warning); }
.notice-shelf-item.is-error .notice-shelf-dot { background: var(--state-error); }
.notice-shelf-item.is-success .notice-shelf-dot { background: var(--state-success); }
.notice-shelf-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes notice-shelf-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes notice-shelf-out {
  to { opacity: 0; transform: translateY(-4px); }
}
@media (max-width: 640px) {
  .notice-shelf-item {
    max-width: calc(100vw - 24px);
    padding: 10px 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .notice-shelf-item { animation: none; }
  .notice-shelf-item.is-exiting { opacity: 0; }
}
```

- [ ] **Step 7: Verify GREEN and integrity**

```bash
node --test components/NoticeShelf.test.mjs hooks/useAgentSession.test.mjs
grep -n "function NoticeShelf\|fontSize: 18\|notice.message" components/ChatWindow.tsx || true
git diff --check
node_modules/.bin/tsc --noEmit
```

Expected: tests pass; grep, diff check, and TypeScript emit no output.

- [ ] **Step 8: Commit**

```bash
git add components/NoticeShelf.tsx components/NoticeShelf.test.mjs components/ChatWindow.tsx app/globals.css
git commit -m "style: align extension notices with Zosma shell"
```

---
### Task 2: Extract Blocking Extension Overlays with Focus Containment

**Files:**
- Create: `components/ExtensionOverlays.tsx`
- Create: `components/ExtensionOverlays.test.mjs`
- Modify: `components/ChatWindow.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing render and focus-owner contracts**

Create `components/ExtensionOverlays.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ExtensionCustomPanel, ExtensionDialog } = await jiti.import("./ExtensionOverlays.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(component, props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(component, props)),
  );
}
const onRespond = () => {};

test("renders select as a labelled modal", () => {
  const html = render(ExtensionDialog, {
    request: {
      type: "extension_ui_request",
      id: "select-1",
      method: "select",
      title: "Choose model",
      options: ["Fast", "Accurate"],
    },
    onRespond,
  });
  assert.match(html, /extension-overlay-mask/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  assert.match(html, /extension-dialog-option/);
  assert.match(html, /data-overlay-autofocus="true"/);
  assert.match(html, />Fast</);
});

test("renders confirm, input, and editor variants", () => {
  const confirm = render(ExtensionDialog, {
    request: {
      type: "extension_ui_request",
      id: "confirm-1",
      method: "confirm",
      title: "Run command",
      message: "This changes files.",
    },
    onRespond,
  });
  assert.match(confirm, /extension-dialog-message/);
  assert.match(confirm, />Confirm</);

  const input = render(ExtensionDialog, {
    request: {
      type: "extension_ui_request",
      id: "input-1",
      method: "input",
      title: "Name",
      placeholder: "Session name",
    },
    onRespond,
  });
  assert.match(input, /extension-dialog-input/);
  assert.match(input, /placeholder="Session name"/);

  const editor = render(ExtensionDialog, {
    request: {
      type: "extension_ui_request",
      id: "editor-1",
      method: "editor",
      title: "Edit prompt",
      prefill: "Existing prompt",
    },
    onRespond,
  });
  assert.match(editor, /extension-dialog-editor/);
  assert.match(editor, />Existing prompt<\/textarea>/);
});

test("renders custom ANSI UI with a non-tabbable capture textarea", () => {
  const html = render(ExtensionCustomPanel, {
    request: {
      type: "extension_ui_request",
      id: "custom-1",
      method: "custom",
      lines: ["\u001b[31mFailure\u001b[0m", "Press Escape"],
    },
    onInput: () => {},
  });
  assert.match(html, /extension-custom-panel/);
  assert.match(html, /extension-custom-capture/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /extension-custom-output/);
  assert.match(html, /Failure/);
});

test("owns focus, terminal input, restoration, and Tab containment", async () => {
  const source = await readFile(new URL("./ExtensionOverlays.tsx", import.meta.url), "utf8");
  for (const token of [
    "FOCUSABLE_SELECTOR",
    "previousFocusRef",
    "requestAnimationFrame",
    "handleOverlayKeyDown",
    "dialog.contains(document.activeElement)",
    "previousFocusRef.current?.focus()",
    "toTerminalKeyData(event)",
    "asBracketedPaste(text)",
    "event.nativeEvent.isComposing",
    'onInput(request, "\\x03")',
    "normalizeCustomPanelLines(request.lines)",
  ]) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test components/ExtensionOverlays.test.mjs
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Create the focus helper and shared request types**

Start `components/ExtensionOverlays.tsx` with:

```tsx
"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import type { ExtensionUiRequest } from "@/lib/types";

const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]):not([tabindex='-1']), [tabindex]:not([tabindex='-1'])";

export type ExtensionDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;
export type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;
type ExtensionDialogResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };

function useOverlayFocus(
  dialogRef: RefObject<HTMLElement | null>,
  identity: string,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const declared = dialog.querySelector<HTMLElement>("[data-overlay-autofocus='true']");
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (initialFocusRef?.current ?? declared ?? first ?? dialog).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [dialogRef, identity, initialFocusRef]);

  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [dialogRef]);
}
```

This is the same focus policy already used by `SettingsShell`: record previous focus, focus the declared first control after mount, trap Tab, and restore on unmount.

- [ ] **Step 4: Implement `ExtensionDialog`**

Use the existing request/response behavior, but replace inline styles with semantic classes. Required structure:

```tsx
export function ExtensionDialog({ request, onRespond }: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: ExtensionDialogResponse) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleOverlayKeyDown = useOverlayFocus(dialogRef, request.id);
  const [value, setValue] = useState(
    request.method === "editor" ? request.prefill ?? "" : "",
  );

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const cancel = () => onRespond(request, { cancelled: true });
  const submit = () => request.method === "confirm"
    ? onRespond(request, { confirmed: true })
    : onRespond(request, { value });

  return (
    <div className="extension-overlay">
      <div className="extension-overlay-mask" aria-hidden="true" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="extension-dialog"
        onKeyDown={(event) => {
          handleOverlayKeyDown(event);
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
        }}
      >
        <header className="extension-dialog-header">
          <div className="extension-dialog-heading">
            <h2 id={titleId} className="extension-dialog-title">{request.title}</h2>
            <span className="extension-dialog-kicker">{t("chat.extensionRequest")}</span>
          </div>
          <button type="button" className="extension-dialog-close" onClick={cancel} aria-label={t("chat.cancel")}>×</button>
        </header>
        <div className="extension-dialog-body">
          {request.method === "confirm" && <p className="extension-dialog-message">{request.message}</p>}
          {request.method === "select" && (
            <div className="extension-dialog-options">
              {request.options.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  data-overlay-autofocus={index === 0 ? "true" : undefined}
                  className="extension-dialog-option"
                  onClick={() => onRespond(request, { value: option })}
                >{option}</button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              id={fieldId}
              data-overlay-autofocus="true"
              className="extension-dialog-input"
              value={value}
              placeholder={request.placeholder}
              aria-label={request.title}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              id={fieldId}
              data-overlay-autofocus="true"
              className="extension-dialog-editor"
              value={value}
              aria-label={request.title}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
              }}
            />
          )}
        </div>
        <footer className="extension-dialog-actions">
          <button type="button" className="extension-dialog-button is-secondary" onClick={cancel}>{t("chat.cancel")}</button>
          {request.method === "confirm" && (
            <button type="button" data-overlay-autofocus="true" className="extension-dialog-button is-primary" onClick={submit}>{t("chat.confirm")}</button>
          )}
          {(request.method === "input" || request.method === "editor") && (
            <button type="button" className="extension-dialog-button is-primary" onClick={submit}>{t("chat.submit")}</button>
          )}
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `ExtensionCustomPanel` without changing terminal semantics**

Move `renderAnsiLine` and the current IME/key/paste handlers from `ChatWindow.tsx`. Add `dialogRef`, call `useOverlayFocus(dialogRef, request.id, inputRef)`, put `tabIndex={-1}` on both dialog and hidden capture textarea, and call the returned handler from the dialog's `onKeyDown`.

Required shell:

```tsx
function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

export function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
const inputRef = useRef<HTMLTextAreaElement>(null);
const composingRef = useRef(false);
const displayLines = normalizeCustomPanelLines(request.lines);
const handleOverlayKeyDown = useOverlayFocus(dialogRef, request.id, inputRef);

useEffect(() => {
  inputRef.current?.focus();
}, [request.id]);

return (
<div className="extension-overlay">
  <div className="extension-overlay-mask" aria-hidden="true" />
  <div
    ref={dialogRef}
    tabIndex={-1}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    className="extension-custom-panel"
    onKeyDown={handleOverlayKeyDown}
    onClick={(event) => {
      if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
    }}
  >
    <textarea
      ref={inputRef}
      tabIndex={-1}
      className="extension-custom-capture"
      aria-label={t("chat.extensionInput")}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onKeyDown={(event) => {
        if (composingRef.current || event.nativeEvent.isComposing) return;
        const data = toTerminalKeyData(event);
        if (!data) return;
        event.preventDefault();
        event.stopPropagation();
        onInput(request, data);
      }}
      onInput={(event) => {
        if (composingRef.current || event.nativeEvent.isComposing) return;
        const text = event.currentTarget.value;
        event.currentTarget.value = "";
        if (text) onInput(request, text);
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const input = event.currentTarget;
        queueMicrotask(() => {
          const text = input.value;
          input.value = "";
          if (text) onInput(request, text);
        });
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text");
        if (text) onInput(request, asBracketedPaste(text));
      }}
    />
    <header className="extension-custom-header">
      <h2 id={titleId} className="extension-custom-title">{t("chat.extensionPanel")}</h2>
      <button type="button" className="extension-custom-close" onClick={() => onInput(request, "\x03")}>{t("chat.close")}</button>
    </header>
    <pre className="extension-custom-output">
      {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
        <Fragment key={index}>
          {renderAnsiLine(line, `line-${index}`)}
          {index < allLines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
      </pre>
    </div>
  </div>
  );
}
```

The code above is the complete terminal-input and render body; do not remove any handler.

- [ ] **Step 6: Integrate and remove old ownership**

Import `ExtensionDialog` and `ExtensionCustomPanel` into `ChatWindow.tsx`. Remove `Fragment`, `ReactNode`, `normalizeCustomPanelLines`, `parseAnsiLine`, `asBracketedPaste`, and `toTerminalKeyData` imports from `ChatWindow.tsx`. Delete both local overlay components and their request aliases.

- [ ] **Step 7: Add DSH modal CSS**

Add semantic rules for:

```css
.extension-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
.extension-overlay-mask { position: absolute; inset: 0; background: var(--overlay-mask); backdrop-filter: blur(2px); }
.extension-dialog, .extension-custom-panel { position: relative; z-index: 1; display: flex; min-width: 0; flex-direction: column; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 24px; background: var(--surface-elevated); box-shadow: var(--shadow-lv3); }
.extension-dialog { width: min(560px, 100%); max-height: min(760px, calc(100dvh - 48px)); }
.extension-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 14px 12px 24px; }
.extension-dialog-title { margin: 0; color: var(--text); font-size: 16px; font-weight: 500; line-height: 24px; }
.extension-dialog-kicker { color: var(--text-dim); font-size: 12px; line-height: 18px; }
.extension-dialog-close { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; }
.extension-dialog-close:hover { background: var(--interactive-hover); color: var(--text); }
.extension-dialog-body { min-height: 0; overflow-y: auto; padding: 8px 24px 20px; }
.extension-dialog-message { margin: 0; color: var(--text-muted); font-size: 14px; line-height: 22px; white-space: pre-wrap; }
.extension-dialog-options { display: grid; gap: 6px; }
.extension-dialog-option { min-height: 40px; padding: 9px 12px; border: 0; border-radius: 12px; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.extension-dialog-option:hover { background: var(--interactive-hover); }
.extension-dialog-input, .extension-dialog-editor { box-sizing: border-box; width: 100%; border: 1px solid var(--border); border-radius: 12px; outline: none; background: var(--surface-base); color: var(--text); font-size: 14px; }
.extension-dialog-input { height: 40px; padding: 0 12px; }
.extension-dialog-editor { min-height: 220px; padding: 12px; resize: vertical; font-family: var(--font-mono); line-height: 1.55; }
.extension-dialog-input:focus, .extension-dialog-editor:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent); }
.extension-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 24px 24px; }
.extension-dialog-button { height: 36px; padding: 0 14px; border-radius: 18px; cursor: pointer; }
.extension-dialog-button.is-secondary { border: 1px solid var(--border); background: transparent; color: var(--text); }
.extension-dialog-button.is-primary { border: 1px solid var(--text); background: var(--text); color: var(--surface-base); }
.extension-custom-panel { width: min(920px, 100%); max-height: min(760px, calc(100dvh - 48px)); }
.extension-custom-capture { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; opacity: 0; pointer-events: none; }
.extension-custom-header { display: flex; height: 54px; align-items: center; justify-content: space-between; padding: 0 14px 0 20px; border-bottom: 1px solid var(--border-subtle); }
.extension-custom-title { margin: 0; font-size: 16px; font-weight: 500; }
.extension-custom-close { height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: 16px; background: transparent; color: var(--text-muted); }
.extension-custom-output { min-height: 0; max-height: calc(min(760px, 100dvh - 48px) - 54px); margin: 0; overflow: auto; padding: 16px; background: var(--bg-subtle); color: var(--text); font: 13px/22px var(--font-mono); white-space: pre; }
```

Append the exact mobile and reduced-motion rules:

```css
@media (max-width: 640px) {
  .extension-overlay {
    align-items: flex-end;
    padding: 12px;
  }
  .extension-dialog,
  .extension-custom-panel {
    max-height: calc(100dvh - 24px);
    border-radius: 20px;
  }
  .extension-dialog-header { padding: 18px 12px 10px 18px; }
  .extension-dialog-body { padding: 8px 18px 18px; }
  .extension-dialog-actions { padding: 0 18px 18px; }
  .extension-dialog-editor { min-height: 180px; }
  .extension-custom-output {
    max-height: calc(100dvh - 78px);
    padding: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .extension-overlay-mask {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

- [ ] **Step 8: Verify GREEN**

```bash
node --test components/ExtensionOverlays.test.mjs hooks/useAgentSession.test.mjs lib/ansi.test.mjs lib/terminal-input.test.mjs
grep -n "function ExtensionDialog\|function ExtensionCustomPanel\|toTerminalKeyData" components/ChatWindow.tsx || true
git diff --check
node_modules/.bin/tsc --noEmit
```

Expected: tests pass; grep, diff check, and TypeScript emit no output.

- [ ] **Step 9: Commit**

```bash
git add components/ExtensionOverlays.tsx components/ExtensionOverlays.test.mjs components/ChatWindow.tsx app/globals.css
git commit -m "style: align extension dialogs with Zosma shell"
```

---
### Task 3: Route Widgets to Real Composer Placements and Quiet the Shelf

**Files:**
- Modify: `components/ExtensionStatusBar.tsx`
- Modify: `components/ExtensionStatusBar.test.mjs`
- Modify: `components/ExtensionWidgets.tsx`
- Modify: `components/ExtensionWidgets.test.mjs`
- Modify: `components/ChatWindow.tsx`
- Modify: `components/SessionMetricsLine.test.mjs`
- Modify: `app/globals.css`

- [ ] **Step 1: Add failing partition and placement tests**

Import `partitionExtensionWidgets` in `ExtensionStatusBar.test.mjs`, then add:

```js
test("partitions widgets without reordering or mutation", () => {
  const widgets = [
    { key: "below-1", lines: ["one"], placement: "belowEditor" },
    { key: "above-1", lines: ["two"], placement: "aboveEditor" },
    { key: "below-2", lines: ["three"], placement: "belowEditor" },
  ];
  const groups = partitionExtensionWidgets(widgets);
  assert.deepEqual(groups.aboveEditor.map(({ key }) => key), ["above-1"]);
  assert.deepEqual(groups.belowEditor.map(({ key }) => key), ["below-1", "below-2"]);
  assert.deepEqual(widgets.map(({ key }) => key), ["below-1", "above-1", "below-2"]);
});

test("marks the physical shelf placement", () => {
  const html = renderStatusBar({
    statuses: [],
    widgets: [{ key: "usage", lines: ["42%"], placement: "aboveEditor" }],
    placement: "aboveEditor",
  });
  assert.match(html, /extension-status-shelf has-widgets is-above-editor/);
  assert.doesNotMatch(html, /has-status/);
});
```

Pass `placement: "belowEditor"` to the combined status/widget test and assert `is-below-editor`.

Replace the final widget trigger test with:

```js
test("uses compact disclosure chrome with accessible placement text", () => {
  const html = renderWidgets({
    widgets: [{
      key: "long-extension-widget-key",
      lines: ["ready", "second"],
      placement: "belowEditor",
    }],
  });
  assert.match(html, /data-placement="belowEditor"/);
  assert.match(html, /Below editor widget/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /extension-widget-dot/);
  assert.match(html, /extension-widget-chevron/);
  assert.doesNotMatch(html, /extension-widget-placement-icon/);
});
```

Keep all existing line preservation, one-panel, update detection, expansion, and timer tests.

- [ ] **Step 2: Verify RED**

```bash
node --test components/ExtensionStatusBar.test.mjs components/ExtensionWidgets.test.mjs
```

Expected: FAIL on missing partitioning and new chrome.

- [ ] **Step 3: Implement partitioning and shelf classes**

Add before `ExtensionStatusBar`:

```tsx
export function partitionExtensionWidgets(widgets: ExtensionWidgetItem[]): {
  aboveEditor: ExtensionWidgetItem[];
  belowEditor: ExtensionWidgetItem[];
} {
  return {
    aboveEditor: widgets.filter(({ placement }) => placement === "aboveEditor"),
    belowEditor: widgets.filter(({ placement }) => placement === "belowEditor"),
  };
}
```

Add `placement` to props with default `"belowEditor"` and use:

```tsx
className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${statuses.length > 0 ? " has-status" : ""}${placement === "aboveEditor" ? " is-above-editor" : " is-below-editor"}`}
```

Do not change sorting, sanitization, ANSI labels, or widget data.

- [ ] **Step 4: Replace placement arrows with disclosure chrome**

Use this content in `ExtensionWidgets.tsx`:

```tsx
const content = (
  <>
    <span className="extension-widget-update-pulse" aria-hidden="true" />
    <span className="extension-widget-dot" aria-hidden="true" />
    <span className="extension-widget-key">{widget.key}</span>
    {expandable && (
      <svg className="extension-widget-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
  </>
);
```

Add `data-placement={widget.placement}` to both trigger branches. Keep `placementLabel` in `aria-label` and `title`.

- [ ] **Step 5: Mount physical above and below regions**

Import `partitionExtensionWidgets` into `ChatWindow.tsx` and derive:

```tsx
const extensionWidgetGroups = useMemo(
  () => partitionExtensionWidgets(extensionWidgets),
  [extensionWidgets],
);
```

In both empty/new and active composer paths, mount:

```tsx
<ExtensionStatusBar
  statuses={[]}
  widgets={extensionWidgetGroups.aboveEditor}
  placement="aboveEditor"
/>
{chatInputElement}
```

After metrics in the active path, and directly after the input in the empty path, mount:

```tsx
<ExtensionStatusBar
  statuses={extensionStatuses}
  widgets={extensionWidgetGroups.belowEditor}
  placement="belowEditor"
/>
```

Replace the existing composer-order test in `SessionMetricsLine.test.mjs` with:

```js
test("keeps extension placements around the composer and metrics", async () => {
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const activeComposer = chatWindow.slice(chatWindow.lastIndexOf('<div className="relative">'));
  const aboveIndex = activeComposer.indexOf('placement="aboveEditor"');
  const inputIndex = activeComposer.indexOf("{chatInputElement}");
  const metricsIndex = activeComposer.indexOf("<SessionMetricsLine");
  const belowIndex = activeComposer.indexOf('placement="belowEditor"');

  assert.ok(aboveIndex >= 0);
  assert.ok(inputIndex > aboveIndex);
  assert.ok(metricsIndex > inputIndex);
  assert.ok(belowIndex > metricsIndex);
  assert.match(activeComposer, /widgets=\{extensionWidgetGroups\.aboveEditor\}/);
  assert.match(activeComposer, /widgets=\{extensionWidgetGroups\.belowEditor\}/);
  assert.match(chatWindow, /<SessionMetricsLine stats=\{sessionStats\} contextUsage=\{contextUsage\} \/>/);
  assert.doesNotMatch(chatInput, /SessionMetricsLine|sessionStats|contextUsage/);
});
```

- [ ] **Step 6: Replace dense footer CSS**

Replace the existing extension shelf block with:

```css
.extension-status-shelf {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  max-width: var(--shell-composer-max-width);
  min-width: 0;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  margin-left: auto;
  padding-right: 16px;
  padding-left: 16px;
  background: transparent;
}
.extension-status-shelf.is-above-editor { margin-bottom: 6px; }
.extension-status-shelf.is-below-editor { margin-top: 4px; padding-bottom: 8px; }
.extension-widget-panels {
  display: flex;
  width: 100%;
  max-height: min(180px, 24dvh);
  flex: 0 0 100%;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--bg-subtle);
  box-shadow: var(--shadow-lv1);
}
.extension-widget-panel { min-width: 0; overflow: hidden; }
.extension-widget-panel-heading {
  height: 28px;
  padding: 6px 12px 0;
  overflow: hidden;
  color: var(--text-muted);
  font: 500 11px/18px var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.extension-widget-content {
  margin: 0;
  padding: 4px 12px 10px;
  color: var(--text-muted);
  font: 12px/20px var(--font-mono);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.extension-widget-triggers {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.extension-widget-triggers::-webkit-scrollbar { display: none; }
.extension-widget-trigger {
  position: relative;
  display: flex;
  width: auto;
  min-width: 0;
  max-width: 180px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  overflow: hidden;
  border: 0;
  border-radius: 14px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 12px;
}
button.extension-widget-trigger { cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast); }
button.extension-widget-trigger:hover,
button.extension-widget-trigger:focus-visible,
.extension-widget-trigger.is-expanded { background: var(--interactive-hover); color: var(--text); }
.extension-widget-update-pulse { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; opacity: 0; pointer-events: none; }
.extension-widget-update-pulse::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -120px;
  width: 120px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 18%, transparent), transparent);
  content: "";
}
.extension-widget-trigger.is-updating .extension-widget-update-pulse { opacity: 1; }
.extension-widget-trigger.is-updating .extension-widget-update-pulse::before { animation: extension-widget-update-sweep 1.8s ease-out infinite; }
@keyframes extension-widget-update-sweep { to { left: 100%; } }
.extension-widget-dot { position: relative; z-index: 1; width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--text-dim); }
.extension-widget-trigger.is-updating .extension-widget-dot { background: var(--accent); }
.extension-widget-key { position: relative; z-index: 1; min-width: 0; overflow: hidden; color: inherit; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.extension-widget-chevron { position: relative; z-index: 1; flex: 0 0 16px; color: var(--text-dim); transition: transform var(--motion-fast); }
.extension-widget-trigger[aria-expanded="true"] .extension-widget-chevron { transform: rotate(180deg); }
.extension-status-line {
  display: flex;
  min-width: 0;
  height: 28px;
  flex: 1 1 180px;
  align-items: center;
  padding: 0 10px;
  border-radius: 14px;
  background: var(--bg-subtle);
}
.extension-status-text { min-width: 0; overflow: hidden; color: var(--text-dim); font: 11px/18px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 640px) {
  .extension-status-shelf { padding-right: 12px; padding-left: 12px; }
  .extension-status-shelf.has-status .extension-status-line { flex-basis: 100%; }
  .extension-widget-trigger { max-width: 150px; }
}
@media (prefers-reduced-motion: reduce) {
  .extension-widget-trigger, .extension-widget-chevron { transition: none; }
  .extension-widget-trigger.is-updating .extension-widget-update-pulse::before { animation: none; left: 0; }
}
```

- [ ] **Step 7: Verify GREEN**

```bash
node --test components/ExtensionStatusBar.test.mjs components/ExtensionWidgets.test.mjs components/SessionMetricsLine.test.mjs components/ConversationFlow.test.mjs
grep -R "extension-widget-placement\|extension-widget-placement-icon" components app --exclude='*.test.mjs' || true
git diff --check
node_modules/.bin/tsc --noEmit
```

Expected: tests pass; grep, diff check, and TypeScript emit no output.

- [ ] **Step 8: Commit**

```bash
git add components/ExtensionStatusBar.tsx components/ExtensionStatusBar.test.mjs components/ExtensionWidgets.tsx components/ExtensionWidgets.test.mjs components/ChatWindow.tsx components/SessionMetricsLine.test.mjs app/globals.css
git commit -m "style: place extension widgets around composer"
```

---
### Task 4: Add an Environment-Gated Visual Audit Extension

**Files:**
- Create: `.pi/extensions/zosma-ui-audit.ts`
- Create: `components/ExtensionVisualFixture.test.mjs`

The fixture is project-local, auto-discovered only when the selected workspace is this repository, excluded from the published `package.json` file list, and inert unless `ZOSMA_UI_VISUAL_AUDIT=1` is present when the server starts.

- [ ] **Step 1: Write the failing fixture contract**

Create `components/ExtensionVisualFixture.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../.pi/extensions/zosma-ui-audit.ts", import.meta.url);

test("visual fixture is explicit, gated, and covers every current browser UI surface", async () => {
  const source = await readFile(fixtureUrl, "utf8");
  assert.match(source, /process\.env\.ZOSMA_UI_VISUAL_AUDIT !== "1"/);
  assert.match(source, /registerCommand\("zosma-ui-audit"/);
  for (const token of [
    "ui.select(",
    "ui.confirm(",
    "ui.input(",
    "ui.editor(",
    "ui.custom(",
    "ui.notify(",
    "ui.setStatus(",
    "ui.setWidget(",
    "ui.setTitle(",
  ]) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
  assert.match(source, /placement: "belowEditor"/);
  assert.match(source, /case "clear"/);
  assert.doesNotMatch(source, /api[_-]?key|token|password/i);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test components/ExtensionVisualFixture.test.mjs
```

Expected: FAIL because the fixture does not exist.

- [ ] **Step 3: Create the deterministic fixture**

Create `.pi/extensions/zosma-ui-audit.ts`:

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const STATUS_KEY = "zosma-ui-audit";
const ABOVE_KEY = "zosma-ui-audit-above";
const BELOW_KEY = "zosma-ui-audit-below";

function clear(ui: ExtensionContext["ui"]): void {
  ui.setStatus(STATUS_KEY, undefined);
  ui.setWidget(ABOVE_KEY, undefined);
  ui.setWidget(BELOW_KEY, undefined);
  ui.setTitle("zosma.ai");
}

export default function zosmaUiAudit(pi: ExtensionAPI): void {
  if (process.env.ZOSMA_UI_VISUAL_AUDIT !== "1") return;

  pi.registerCommand("zosma-ui-audit", {
    description: "Exercise Zosma browser extension UI surfaces for visual acceptance",
    handler: async (args, ctx) => {
      const ui = ctx.ui;
      switch (args.trim()) {
        case "ambient":
          ui.setTitle("zosma.ai — UI audit");
          ui.setStatus(STATUS_KEY, "audit: status ready");
          ui.setWidget(ABOVE_KEY, [
            "Above editor widget",
            "Second line for expansion",
          ]);
          ui.setWidget(BELOW_KEY, [
            "Below editor widget",
            "Second line for expansion",
            "Third line for scrolling rhythm",
          ], { placement: "belowEditor" });
          ui.notify("Audit info notice", "info");
          ui.notify("Audit warning notice", "warning");
          ui.notify("Audit error notice", "error");
          return;

        case "select": {
          const value = await ui.select("Choose audit option", ["Fast", "Accurate", "Cancel path"]);
          ui.notify(value ? `Selected: ${value}` : "Select cancelled", "info");
          return;
        }

        case "confirm": {
          const confirmed = await ui.confirm(
            "Confirm audit action",
            "This is deterministic fixture text. It changes no external state.",
          );
          ui.notify(confirmed ? "Confirmed" : "Confirm cancelled", "info");
          return;
        }

        case "input": {
          const value = await ui.input("Enter audit value", "type something...");
          ui.notify(value ? `Input length: ${value.length}` : "Input cancelled", "info");
          return;
        }

        case "editor": {
          const value = await ui.editor("Edit audit text", "Line 1\nLine 2\nLine 3");
          ui.notify(value ? `Editor lines: ${value.split("\n").length}` : "Editor cancelled", "info");
          return;
        }

        case "custom":
          await ui.custom((_tui, theme, _keybindings, done) => ({
            render(width) {
              return [
                theme.fg("accent", "Zosma extension custom panel"),
                theme.fg("muted", "ANSI colors and terminal columns remain intact."),
                "Press Escape or Ctrl+C to close.",
              ].map((line) => truncateToWidth(line, width));
            },
            handleInput(data) {
              if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
                done(undefined);
              }
            },
            invalidate() {},
          }));
          ui.notify("Custom panel closed", "info");
          return;

        case "clear":
          clear(ui);
          ui.notify("Audit surfaces cleared", "info");
          return;

        default:
          ui.notify(
            "Usage: /zosma-ui-audit ambient|select|confirm|input|editor|custom|clear",
            "warning",
          );
      }
    },
  });
}
```

The fixture must not register any tool, call a model, write files, access credentials, or change application settings.

- [ ] **Step 4: Verify GREEN and inert behavior contract**

```bash
node --test components/ExtensionVisualFixture.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: test passes; TypeScript and diff check emit no output.

- [ ] **Step 5: Commit the fixture**

```bash
git add .pi/extensions/zosma-ui-audit.ts components/ExtensionVisualFixture.test.mjs
git commit -m "test: add extension visual audit fixture"
```

---
### Task 5: Capture Matching DSH and Zosma Browser States

**Files:** None. Screenshots and notes stay under `/tmp/zosma-phase6-completion`.

- [ ] **Step 1: Start the pinned DSH reference correctly**

From `../deepseek-harness`:

```bash
git rev-parse HEAD
git status --short
pnpm run build
pnpm dsh web --no-open --port 3080
```

Expected:

- Commit is `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- The assembled DSH application, not standalone Vite, serves `http://127.0.0.1:3080`.
- Build output is ignored and source remains clean.

Capture DSH at `1440×900`, `900×800`, and `390×844`, light and dark, for:

- Empty/new session and composer.
- Populated conversation.
- Thinking and tool disclosure rows.
- Expanded terminal/tool block.
- Sidebar expanded/collapsed.
- Settings modal.
- Toast or nearest transient notification state available in the assembled app.

Save as:

```text
/tmp/zosma-phase6-completion/reference/<viewport>-<theme>-<state>.png
```

Record the exact DSH URL, commit, viewport, theme, and state in `/tmp/zosma-phase6-completion/notes/reference.md`. Do not compare against memory or a different DSH process.

- [ ] **Step 2: Start Zosma with the deterministic fixture**

From the Zosma repository:

```bash
ZOSMA_UI_VISUAL_AUDIT=1 npm run dev
```

Expected: `http://127.0.0.1:30141` serves the current checkout. Select this repository as the workspace so `.pi/extensions/zosma-ui-audit.ts` is discovered. If project trust is requested, inspect the committed fixture and trust this local repository. Run `/reload` once if the session existed before the environment-gated fixture was enabled.

- [ ] **Step 3: Capture standard Zosma states**

At `1440×900`, `900×800`, `640×800`, `390×844`, and `320×700`, light and dark, capture:

1. Empty/new session.
2. Populated conversation.
3. Streaming thinking/tool activity.
4. Expanded tool detail.
5. Workspace search and nested sessions.
6. Header overflow and Session Details.
7. Unified settings.
8. File viewer/panel.
9. Notice toast.
10. Extension status and both widget placements.
11. Select dialog.
12. Confirm dialog.
13. Input dialog.
14. Editor dialog.
15. ANSI custom panel.

Save as:

```text
/tmp/zosma-phase6-completion/after/<viewport>-<theme>-<state>.png
```

- [ ] **Step 4: Exercise every extension state deterministically**

Run these commands one at a time:

```text
/zosma-ui-audit ambient
/zosma-ui-audit select
/zosma-ui-audit confirm
/zosma-ui-audit input
/zosma-ui-audit editor
/zosma-ui-audit custom
/zosma-ui-audit clear
```

Expected:

- Ambient produces three typed toasts, one status, one above-editor widget, one below-editor widget, and a temporary title.
- Dialog commands block until submit or cancel and then produce a notice.
- Custom shows ANSI-styled terminal lines and closes on Escape or Ctrl+C.
- Clear removes persistent fixture surfaces and restores the title.

- [ ] **Step 5: Verify geometry and overflow**

For every major state, run in the browser console:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected: `true`.

Also verify:

- DSH content and composer axes remain `748px` and `780px` caps.
- Above widgets render before the composer; below widgets and status render after metrics.
- Expanded widgets and custom output scroll internally.
- Mobile overlays use 12px viewport clearance and keep actions visible above the software keyboard.
- Long keys/status text ellipsize without widening the page.
- Assistant content remains open-canvas and Pi file/branch/settings controls remain reachable.

- [ ] **Step 6: Verify keyboard containment and restoration**

For each blocking overlay:

1. Focus a known composer or header control before opening.
2. Open the overlay through the fixture.
3. Press Tab repeatedly and Shift+Tab repeatedly.
4. Confirm focus never reaches the covered shell.
5. Close or cancel.
6. Confirm focus returns to the control that was focused before opening.

Additional expectations:

- Select starts on the first option.
- Confirm starts on Confirm.
- Input/editor start in their field.
- Escape cancels all standard dialogs.
- Ctrl/Cmd+Enter submits editor.
- The hidden custom capture textarea never appears in sequential Tab order.
- Custom terminal keys, IME input, and paste still reach the sidecar.
- Widget buttons toggle with Enter and Space and expose `aria-expanded`.

- [ ] **Step 7: Verify reduced motion**

Emulate `prefers-reduced-motion: reduce`.

Expected: toast slide, widget sweep, and chevron transitions stop; overlay blur is disabled; no state information disappears.

- [ ] **Step 8: Record acceptance**

Append one row per state to `notes/audit.csv`. Allowed results are `pass`, `blocked`, and `fail`. Every row must be `pass` before Phase 6 is complete. A blocked or failed row must record reproduction, expected/reference behavior, current behavior, owning component, and screenshot path in `notes/`.

Stop on a blocker. Do not improvise an app-wide CSS pass; create a focused follow-up plan for the measured owner.

No screenshot commit.

---

### Task 6: Final Integrated Verification

**Files:** No new source files

- [ ] **Step 1: Run focused tests**

```bash
node --test \
  components/NoticeShelf.test.mjs \
  components/ExtensionOverlays.test.mjs \
  components/ExtensionStatusBar.test.mjs \
  components/ExtensionWidgets.test.mjs \
  components/ExtensionVisualFixture.test.mjs \
  components/SessionMetricsLine.test.mjs \
  hooks/useAgentSession.test.mjs \
  lib/ansi.test.mjs \
  lib/terminal-input.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run full checks**

```bash
npm test
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: full suite passes; TypeScript and diff check emit no output.

- [ ] **Step 3: Compare lint fingerprint**

```bash
set +e
npm run lint > /tmp/phase6-eslint-final.log 2>&1
status=$?
printf 'lint_status=%s\n' "$status"
grep -Eo '[0-9]+ problems? \([0-9]+ errors?, [0-9]+ warnings?\)' /tmp/phase6-eslint-final.log | tail -1
diff -u /tmp/phase6-eslint-baseline.log /tmp/phase6-eslint-final.log || true
```

Expected: no new finding; baseline remains 15 errors and zero warnings unless separately corrected.

- [ ] **Step 4: Verify obsolete owners are gone**

```bash
grep -n "function NoticeShelf\|function ExtensionDialog\|function ExtensionCustomPanel" components/ChatWindow.tsx || true
grep -R "extension-widget-placement\|extension-widget-placement-icon" components app --exclude='*.test.mjs' || true
grep -n "fontSize: 18\|borderRadius: 8\|rgba(0,0,0,0.18)" components/ChatWindow.tsx || true
```

Expected: no output.

- [ ] **Step 5: Verify scope and commits**

```bash
git status --short
git log -5 --oneline
git diff HEAD~4 -- package.json pnpm-lock.yaml lib/rpc-manager.ts lib/types.ts hooks/useAgentSession.ts app/api
```

Expected:

- Only pre-existing untracked plans and `pnpm-lock.yaml` remain outside commits.
- Four implementation commits are present.
- Final diff command emits no output.

- [ ] **Step 6: Confirm phase boundary**

Phase 6 is complete only when all audit rows pass, every Pi extension behavior remains compatible, focus cannot escape blocking overlays, previous focus restores, above/below placement is physical, full tests and TypeScript pass, and no future declarative/ESM extension work has started.

## Planned Commit Summary

1. `style: align extension notices with Zosma shell`
2. `style: align extension dialogs with Zosma shell`
3. `style: place extension widgets around composer`
4. `test: add extension visual audit fixture`

## Deferred Follow-Up

A separate spec and roadmap are required for the JSON-safe declarative surface protocol, local generalized slots, trusted browser ESM discovery, signatures, CSP, sandboxing, capabilities, extension settings migration, and currently unsupported `ctx.ui` methods.

This plan intentionally stops at **Phase 6: Metrics, Responsive Hardening, and Visual Parity**. Future extension-platform work needs separate detailed plans.
