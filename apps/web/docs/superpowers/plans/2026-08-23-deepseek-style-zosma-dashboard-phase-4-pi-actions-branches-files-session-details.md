# DeepSeek-Style Zosma Dashboard Phase 4 Pi Actions, Branches, Files, and Session Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `/skill:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move existing Pi actions, branch controls, file affordances, and session metadata into a quiet DeepSeek-style session header without changing Pi runtime, session-file, API, or security contracts.

**Architecture:** Keep `AppShell` as the owner of selected session, header panels, tabs, file-panel state, and shell callbacks. Keep `BranchNavigator` responsible for controlled branch-panel rendering, keep `useAgentSession` responsible for `fork` and `navigate_tree`, keep `SessionSidebar` responsible for rename/delete and their confirmations, and route every file open through the existing `handleOpenFile` → `openFileTab` → encoded `/api/files` path. Add only one small pure formatting module for the details surface and use existing path, stats, session, worktree, and security helpers.

**Tech Stack:** Next.js 16, React 19, TypeScript, existing semantic CSS variables/classes in `app/globals.css`, Node `node:test`, Jiti source-contract tests, existing Pi SDK route adapters.

**Roadmap:** `docs/superpowers/roadmaps/2026-08-22-deepseek-style-zosma-dashboard-roadmap.md`

**Phase:** Phase 4: Pi Actions, Branches, Files, and Session Details

---

## Phase contract and audit findings

Phase starts from `6e9e11d` and includes completed Phase 3 commits `e1c6fe7`, `9d23609`, `c562f18`, and `6e9e11d`. Pinned visual reference is DeepSeek Harness commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` in `/home/arjun/code/zosmaai/deepseek-harness`.

Current ownership to preserve:

- `components/AppShell.tsx` owns `selectedSession`, `activeTopPanel`, `topPanelPos`, desktop/mobile header composition, `handleAutoName`, `handleViewFullHistory`, `handleCopySessionField`, `handleSystemPromptToggle`, `handleOpenFile`, `fileTabs`, `activeFileTabId`, `rightPanelOpen`, and all callbacks passed to `ChatWindow`.
- `ChatWindow` receives branch data from `useAgentSession` through `onBranchDataChange`, receives `handleFork` and `handleNavigate` through `MessageView`, forwards `onOpenFile`, and forwards `sessionStats` plus `contextUsage` to `AppShell`.
- `useAgentSession.handleFork` sends `{ type: "fork", entryId }`, then `onSessionForked` rekeys `AppShell` to the new independent session. `useAgentSession.handleNavigate` sends `{ type: "navigate_tree", targetId }` and reloads the same session file context. These lifecycles must not merge.
- `BranchNavigator` already supports `inline`, controlled `open`, `onToggle`, `containerRef`, `compact`, and `hideInlineButton`; its tree selection calls `onLeafChange(rep.entry.id)`.
- `SessionSidebar.SessionItem` owns rename PATCH, delete DELETE, Shift-click delete bypass, normal delete confirmation, and `onSessionDeleted`; `AppShell.handleSessionDeleted` creates a fresh composer only when the deleted session is selected.
- `/api/sessions/[id]/route.ts` owns GET/PATCH/DELETE. GET returns session context, `leafId`, projected tree, `filePath`, `info`, and `totalActiveMs`; PATCH appends `session_info`; DELETE reparents children before deleting.
- `/api/sessions/[id]/auto-name/route.ts` owns title generation. `AppShell.handleAutoName` disables unsaved/empty sessions and guards stale responses with `activeSessionIdRef`.
- `/api/sessions/[id]/export/route.ts` owns raw session log/export, including iterative deep-tree patching and response headers. `handleViewFullHistory` opens it in a new tab.
- `AppShell.handleOpenFile` creates or reuses a tab by absolute path, preserves `sourceSessionId` and `modeHint`, opens the existing right panel, and closes the mobile sidebar. `FileViewer` encodes paths with `encodeFilePathForApi`; `TabBar` owns tab selection and close controls.
- `MarkdownBody` already turns local markdown links into `onOpenFile` actions through `resolveLocalFileHref`; `TurnWrittenFiles` already opens exact resolved write/edit paths. `MessageView.ToolCallBlock` currently displays tool paths as text and does not yet expose an inline action.
- `file-access.ts` and `path-security.ts` remain the security boundary. `/api/files/[...path]/route.ts` authorizes allowed roots, then permits non-list session-referenced paths through `isFilePathReferencedBySession`; it must not become a general filesystem browser. `paths.ts`/`worktree.ts` native-path and server-resolved worktree identity rules remain unchanged.
- New-session header differs from existing-session header: `selectedSession === null`, `effectiveNewSessionCwd !== null`, and `newSessionDraftKey` identify a fresh composer. Export, title generation, persisted session IDs, and persisted stats are unavailable until Pi promotes the session. Existing sessions have `SessionInfo`, persisted name/path/ID, and live stats.

Explicit omissions: Trajectory, backend/session-format changes, general filesystem access, relaxed allow-list rules, settings redesign, and the final metrics strip remain Phase 5 or Phase 6 work. No source code from the pinned reference is copied and no new dependency is added.

## Files and responsibilities

Create:

- `lib/session-details.ts`: pure duration, token-count, cost, and cache-hit formatting used by the Session Details panel.
- `lib/session-details.test.mjs`: Jiti-loaded unit tests for those pure functions.
- `app/api/files/inline-link-security.test.mjs`: source-contract security test proving inline file affordances still pass through existing route authorization.

Modify:

- `components/AppShell.tsx`: quiet header title/action grouping, desktop overflow, mobile action reachability, controlled top-panel anchoring, complete details rows, and existing file-panel wiring only.
- `components/AppShell.mobile-toolbar.test.mjs`: mobile overflow reachability and covered-control focus assertions.
- `components/AppShell.auto-name.test.mjs`: existing title-generation ownership and unsaved/empty guards after relocation.
- `components/BranchNavigator.tsx`: controlled hidden-trigger panel IDs and accessible trigger/panel relationships without changing branch projection or selection callbacks.
- `components/BranchNavigator.test.mjs`: controlled/hidden/mobile source contracts and unchanged representative-ID selection tests.
- `components/MessageView.tsx`: pass cwd/open-file callbacks into tool rows and expose safe tool-argument file actions.
- `components/MessageView.test.mjs`: source and static-render contracts for tool-path affordances and preserved message actions.
- `components/FileExplorer.tsx`: keyboard activation for existing explorer/change rows and semantic classes; no new filesystem behavior.
- `components/SessionSidebar.tsx`: quiet explorer-section classes only; preserve explorer preference, upload, refresh, worktree, rename, delete, and confirmation ownership.
- `components/TabBar.tsx`: quiet file-tab classes/ARIA only if the existing classes do not cover the final header treatment.
- `app/globals.css`: header/overflow/details/tool-file/explorer/tab styling, focus states, non-color state, mobile rules, and reduced-motion rules.
- `lib/file-links.test.mjs`: runtime helper assertions for relative escape rejection, Windows paths, and encoded-path-safe resolution.
- `lib/i18n/messages/en.ts`: Phase 4 action/details/file labels required by rendered output.
- `lib/i18n/messages/zh-CN.ts`: matching Chinese keys with no dictionary drift.

Do not modify `hooks/useAgentSession.ts`, `lib/file-access.ts`, `lib/path-security.ts`, `lib/paths.ts`, `lib/worktree.ts`, any session route implementation, `pnpm-lock.yaml`, or untracked Phase 1/Phase 3 plans unless a focused failing test proves a contract gap. Do not run `next build`.

## Mandatory safe-editing protocol

This repository has a known corruption failure: unsafe multiline edits can strip newlines and alter `?` characters. Executor must follow this protocol for every source target ending in `.ts`, `.tsx`, `.css`, or locale `.ts`:

- [ ] Before editing, create `/tmp/phase4-backups/<relative-path>` and copy every target with `cp --preserve=all`. Include `components/AppShell.tsx`, `components/BranchNavigator.tsx`, `components/MessageView.tsx`, `components/FileExplorer.tsx`, `components/SessionSidebar.tsx`, `components/TabBar.tsx`, `app/globals.css`, and both locale files before the first source edit. Add newly selected targets before editing them.
- [ ] Use the `write` tool for a complete file rewrite, or use a user-approved byte-preserving Node rewrite script created with the `write` tool. The Node script must read bytes, assert each exact old occurrence count, replace only the asserted byte sequence, write bytes, then report line count, SHA-256, newline count, and question-mark count.
- [ ] Never use multiline `edit`, shell heredocs, Python string replacement, Python `open().write()`, Python `open().writelines()`, generated shell text rewrites, or `sed -i` on source files. One-line `edit` is not the required protocol for this phase; use full `write` or the checked Node script.
- [ ] After each changed source file, compare `wc -l`, `sha256sum`, newline count, and `grep -o '?' | wc -l` against the backup or the explicitly recorded expected transformation. Run `git diff --check` and inspect `git diff --word-diff=porcelain -- <path>`.
- [ ] If line structure, newline count, or question-mark count changes outside the named transformation, restore that file immediately with `cp --preserve=all` from its backup and redo the edit using a smaller asserted transformation.
- [ ] Never delete backups until the focused test, TypeScript check, and diff inspection for that task pass.

## Task 0: Capture Phase 4 baseline and working contract

**Files:** No repository files modified. Temporary files only: `/tmp/zosma-phase4-eslint-baseline.json`, `/tmp/phase4-backups/`.

- [ ] Record clean source baseline from `HEAD` without staging untracked files:

```bash
git rev-parse HEAD
git status --short --branch
git log --oneline --decorate -12
```

Expected: `6e9e11d` is `HEAD`; only the two prior untracked plan files and `pnpm-lock.yaml` are reported. Do not add, remove, or rewrite any of them.

- [ ] Capture the lint fingerprint and assert its exact current shape:

```bash
node_modules/.bin/eslint . --format json > /tmp/zosma-phase4-eslint-baseline.json || test $? -eq 1
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const got={};let warnings=0;for(const row of rows)for(const m of row.messages){if(m.severity===1)warnings++;if(m.severity!==2)continue;const file=path.relative(process.cwd(),row.filePath);got[file]??={};got[file][m.ruleId??"unknown"]=(got[file][m.ruleId??"unknown"]??0)+1}assert.equal(warnings,0);assert.deepEqual(got,{"components/ChatInput.tsx":{"react-hooks/preserve-manual-memoization":6},"components/ChatMinimap.tsx":{"react-hooks/preserve-manual-memoization":5},"components/SessionSidebar.tsx":{"react-hooks/preserve-manual-memoization":2},"hooks/useAgentSession.ts":{"react-hooks/preserve-manual-memoization":2}});console.log("ESLint baseline: 15 known errors, 0 warnings")' /tmp/zosma-phase4-eslint-baseline.json
```

Expected: assertion passes with exactly 15 errors and 0 warnings.

- [ ] Run the current gates before writing tests:

```bash
node_modules/.bin/tsc --noEmit
npm test
git diff --check
```

Expected: TypeScript passes; `npm test` reports 651 passing tests, 0 failures; `git diff --check` reports no tracked whitespace errors. Do not run `next build`.

- [ ] Back up all planned source targets using `cp --preserve=all`; do not back up or edit untracked plans or `pnpm-lock.yaml`.

## Task 1: Add failing contracts for quiet session header and overflow access

**Files:**

- Create: `components/AppShell.session-header.test.mjs`
- Modify: `components/AppShell.mobile-toolbar.test.mjs`
- Modify: `components/AppShell.auto-name.test.mjs`

- [ ] Write source-contract tests before implementation. Read `AppShell.tsx` as UTF-8 and assert all of these exact contracts:

  - `session-header`, `session-header-title`, `session-header-actions`, `session-header-overflow-trigger`, `session-header-overflow`, and `session-header-overflow-item` are present.
  - Existing-session title reads from `selectedSession?.name` and new-session title is rendered from the new-session branch rather than a fabricated persisted name.
  - Desktop overflow contains the existing `handleViewFullHistory`, `handleAutoName`, `handleSystemPromptToggle`, and `toggleTopPanel("branches"` callbacks.
  - `renderChatToolbarActions(false)` no longer renders four dense labeled action buttons directly in the desktop toolbar; the overflow retains labels and `aria-label` values.
  - `renderChatToolbarActions(true)` still exposes `data-mobile-toolbar-action` values `history`, `name`, `branches`, and `system`, while theme and language remain reachable through the mobile layer.
  - The mobile `BranchNavigator` still has `hideInlineButton`, and its visible mobile trigger still calls `toggleTopPanel("branches", true)` with `aria-pressed` and `data-mobile-toolbar-action="branches"`.
  - The file toggle still has `aria-controls="file-panel"`, `aria-expanded`, and the existing `handleRightPanelToggle` callback.
  - The header overflow has `role="menu"`; each action uses a native `button type="button"` with an accessible name.

- [ ] Run the new tests and verify they fail only because Phase 4 classes/overflow wiring do not exist yet:

```bash
node --test components/AppShell.session-header.test.mjs components/AppShell.mobile-toolbar.test.mjs components/AppShell.auto-name.test.mjs
```

Expected: FAIL on missing `session-header`/overflow contracts, while existing auto-name tests continue to identify current ownership. Do not implement until this failure is captured.

## Task 2: Implement quiet header, controlled overflow, and new/existing-session differences

**Files:**

- Modify: `components/AppShell.tsx`
- Modify: `app/globals.css`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`
- Test: `components/AppShell.session-header.test.mjs`
- Test: `components/AppShell.mobile-toolbar.test.mjs`
- Test: `components/AppShell.auto-name.test.mjs`

- [ ] Add only the locale keys used by the new surface in both locale files: a new-session title, header overflow label, session details action label, file panel action label, and the existing history/title/system/branches labels where a shorter menu label is needed. Keep English and Chinese key sets identical; run the locale registry test after the edit.

- [ ] Add controlled overflow to `AppShell` by extending the existing `activeTopPanel` union with `"overflow"`, reusing `toggleTopPanel`, `topPanelPos`, the existing Escape/outside-click pattern, and the existing single-panel invariant. Add one `headerOverflowButtonRef` and make the existing top-panel position effect anchor `overflow` to that button’s bottom edge with a bounded width no wider than `min(280px, topbar width)`; do not create a second global popover manager.

- [ ] Replace the dense desktop action sequence with a quiet header composition: retain the sidebar toggle and file-panel toggle, render `session-header-title` from `selectedSession?.name` when an existing session is selected, render a stable new-session label plus the active cwd basename when `selectedSession` is null and `effectiveNewSessionCwd` exists, and render one overflow trigger with `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls`.

- [ ] Put these existing actions in the desktop overflow, without changing their callbacks or guards: `handleViewFullHistory` for session log/export, `handleAutoName` for Generate title, `toggleTopPanel("branches")` for the controlled branch panel, `handleSystemPromptToggle()` for System prompt, and `toggleTopPanel("session")` for Session Details. Keep the existing file-panel toggle outside the menu so file tabs stay one click away.

- [ ] Keep the mobile action layer reachable. Mobile more controls must continue to render history, title generation, branch trigger, and system prompt; mobile stats and file controls must preserve their current covered-state `disabled`, `tabIndex`, `aria-hidden`, and pointer-event behavior. Opening an overflow item must not leave a hidden covered button focusable.

- [ ] Give overflow actions visible text and non-color state: active panel uses text/background plus `aria-expanded`; title generation keeps naming/success/error text; disabled unsaved and no-message states retain current `title` explanations. Use `:focus-visible` outlines and no hover-only access requirement.

- [ ] Add the bounded header CSS using existing `--bg`, `--bg-panel`, `--bg-hover`, `--bg-selected`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`, and motion variables. Do not copy DeepSeek CSS variable names or add a design-system package. Keep header title ellipsized, overflow menu keyboard-visible, and desktop/mobile widths free of horizontal overflow.

- [ ] Run focused tests and TypeScript:

```bash
node --test components/AppShell.session-header.test.mjs components/AppShell.mobile-toolbar.test.mjs components/AppShell.auto-name.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all focused tests pass and TypeScript passes. If a test claims click behavior from static markup, rewrite it as a source contract and defer click/focus proof to Task 7 manual checks.

- [ ] Run the locale and diff checks:

```bash
node --test lib/i18n/registry.test.mjs lib/i18n/format.test.mjs
git diff --check
```

Expected: locale parity passes and no whitespace errors.

- [ ] Commit only these Task 2 files:

```bash
git add components/AppShell.tsx components/AppShell.session-header.test.mjs components/AppShell.mobile-toolbar.test.mjs components/AppShell.auto-name.test.mjs app/globals.css lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "style: quiet Zosma session header actions"
```

## Task 3: Add failing and passing tests for complete Session Details

**Files:**

- Create: `lib/session-details.ts`
- Create: `lib/session-details.test.mjs`
- Modify: `components/AppShell.tsx`
- Modify: `components/AppShell.session-header.test.mjs`
- Modify: `lib/i18n/messages/en.ts`
- Modify: `lib/i18n/messages/zh-CN.ts`

- [ ] Write the pure helper tests first. They must Jiti-load `lib/session-details.ts` and assert these exact cases:

```js
assert.equal(formatSessionDuration(0), "0s");
assert.equal(formatSessionDuration(59_999), "59s");
assert.equal(formatSessionDuration(60_000), "1m 0s");
assert.equal(formatSessionDuration(3_661_000), "1h 1m");
assert.equal(formatCompactTokenCount(999), "999");
assert.equal(formatCompactTokenCount(1_000), "1k");
assert.equal(formatCompactTokenCount(1_000_000), "1.0M");
assert.equal(getCacheHitRate({ input: 0, output: 1, cacheRead: 0, cacheWrite: 0, total: 1 }), null);
assert.equal(getCacheHitRate({ input: 100, output: 1, cacheRead: 50, cacheWrite: 50, total: 201 }), 25);
assert.equal(formatSessionCost(0), null);
assert.equal(formatSessionCost(0.001), "<$0.01");
assert.equal(formatSessionCost(0.14), "$0.14");
```

- [ ] Run the pure tests before implementation:

```bash
node --test lib/session-details.test.mjs
```

Expected: FAIL with the module or exported functions missing.

- [ ] Implement exactly four pure exports in `lib/session-details.ts`: `formatSessionDuration(ms: number)`, `formatCompactTokenCount(value: number)`, `getCacheHitRate(tokens: SessionStatsInfo["tokens"]): number | null`, and `formatSessionCost(cost: number): string | null`. Reject non-finite or negative duration/token/cost inputs by returning the same omission-safe values used for unavailable data; do not invent zero-valued optional metrics. Keep the cache denominator `cacheRead + cacheWrite + input`, matching the current AppShell comment and Phase 6 metric contract.

- [ ] Replace only inline formatting closures in the existing `activeTopPanel === "session"` panel with these helpers. Do not move ownership of `sessionStats`, `contextUsage`, `copiedSessionField`, or `handleCopySessionField` out of `AppShell`.

- [ ] Complete Session Details with current authoritative values. Existing persisted sessions must expose: session name, session file path, session ID, session cwd, project root when present, created time, modified time, user count, assistant count, tool-call count, tool-result count, total message count, input tokens, output tokens, cache-read tokens, cache-write tokens, total tokens, active duration, cost when positive, context percent/window when available, and derived cache-hit rate when the denominator is positive. File path and ID retain copy buttons using `handleCopySessionField`; copied state remains text/icon plus tooltip, not color alone.

- [ ] Render the new-session details state without fake persisted metadata: show the active cwd and project identity if available, show `In-memory` for persistence, omit persisted ID/file/name/count/token/cost rows until `sessionStats` exists, and retain disabled export/title actions. Existing sessions must continue to use `sessionStats.sessionFile` and `sessionStats.sessionId` as the primary persisted values, with `selectedSession.path` and `selectedSession.cwd` as display fallbacks.

- [ ] Keep details responsive: desktop uses the existing three-column information/messages/tokens layout with bounded path wrapping; mobile uses one column inside the existing top-panel scrollport and never exceeds viewport width. Add headings and row labels as text, not color-only indicators. Preserve reduced-motion behavior for the existing details popover.

- [ ] Extend `AppShell.session-header.test.mjs` source contracts to assert every required details field expression, the `sessionStats`/`contextUsage` sources, `handleCopySessionField`, new-session omission branch, and no fabricated ID/path for a fresh composer. Do not assert exact browser layout from a source string.

- [ ] Run pure, focused, TypeScript, and locale tests:

```bash
node --test lib/session-details.test.mjs components/AppShell.session-header.test.mjs
node_modules/.bin/tsc --noEmit
node --test lib/i18n/registry.test.mjs lib/i18n/format.test.mjs
git diff --check
```

Expected: helper and source-contract tests pass, TypeScript passes, locale tests pass, and diff check is clean.

- [ ] Commit only these Task 3 files:

```bash
git add lib/session-details.ts lib/session-details.test.mjs components/AppShell.tsx components/AppShell.session-header.test.mjs lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "feat: complete Zosma session details"
```

## Task 4: Preserve controlled branches and current rename/delete/export ownership

**Files:**

- Modify: `components/BranchNavigator.tsx`
- Modify: `components/BranchNavigator.test.mjs`
- Modify: `components/AppShell.session-header.test.mjs`
- Test only by source contract: `components/SessionSidebar.test.mjs`, `components/SessionSidebar.workspace.test.mjs`, `app/api/sessions/runtime-route.test.mjs`

- [ ] Add failing source assertions before changing branch markup: the controlled hidden panel must have a stable `id` derived from the existing branch panel contract, the trigger must have `aria-controls` and `aria-expanded`, and hidden-trigger mode must still render the shared panel when `open` is controlled. Preserve `onSelect(rep.entry.id)`, `compressChain`, `selectTopLevelBranches`, `buildActivePath`, `ResizeObserver`, and `containerRef` positioning assertions.

- [ ] Run the focused branch/sidebar baseline and capture the expected failure for missing IDs/relationships:

```bash
node --test components/BranchNavigator.test.mjs components/SessionSidebar.test.mjs components/SessionSidebar.workspace.test.mjs app/api/sessions/runtime-route.test.mjs
```

Expected: existing branch and session ownership tests pass; new ID/relationship assertions fail before implementation.

- [ ] Add only stable accessibility wiring to `BranchNavigator`: use one explicit panel ID for each rendered inline branch panel, set `aria-controls` on the visible trigger when it exists, set `aria-expanded` from the controlled `open` value, and set the panel role/label without changing tree data or callback behavior. In `hideInlineButton` mode, do not create a second trigger and do not remove the panel.

- [ ] Keep fork and in-session branch semantics separate in `AppShell.session-header.test.mjs` and `components/BranchNavigator.test.mjs`: assert that `MessageView` still receives `onFork={handleFork}` and `onNavigate={handleNavigate}`, assert that `BranchNavigator` only calls `onLeafChange`, and assert that `ChatWindow` still passes `onSessionForked` separately from `onBranchDataChange`. No task may rename `fork`, `navigate_tree`, `handleFork`, or `handleNavigate`.

- [ ] Preserve action ownership with source-contract regressions: `handleViewFullHistory` must still open `/api/sessions/{id}/export?inline=1` in a new tab; `SessionSidebar` must still use PATCH for rename and DELETE for deletion; normal delete must still set confirmation before `performDelete`; Shift-click remains the only bypass; `AppShell.handleSessionDeleted` must still reset only the selected session.

- [ ] Run focused tests, TypeScript, and diff check:

```bash
node --test components/BranchNavigator.test.mjs components/AppShell.session-header.test.mjs components/SessionSidebar.test.mjs components/SessionSidebar.workspace.test.mjs app/api/sessions/runtime-route.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: all tests pass and TypeScript passes. Static tests prove source wiring only; they do not prove pointer clicks, keyboard activation, focus return, or route side effects.

- [ ] Commit only these Task 4 files:

```bash
git add components/BranchNavigator.tsx components/BranchNavigator.test.mjs components/AppShell.session-header.test.mjs
git commit -m "style: preserve controlled Zosma branch actions"
```

Do not stage `SessionSidebar.tsx` unless Task 6 identifies a concrete explorer accessibility edit; existing rename/delete behavior remains owned by that file without a presentation move.

## Task 5: Add safe native tool-path actions through existing file contracts

**Files:**

- Modify: `components/MessageView.tsx`
- Modify: `components/MessageView.test.mjs`
- Modify: `lib/file-links.test.mjs`
- Create: `app/api/files/inline-link-security.test.mjs`
- Modify: `app/globals.css`

- [ ] Add a pure exported adapter in `MessageView.tsx` named `resolveToolFilePath(block: ToolCallContent, cwd?: string): string | null`. It must read only string `block.input.path` or `block.input.file_path`, call `resolveLocalFileHref(rawPath, cwd, cwd)`, and return `null` for missing cwd, malformed input, relative paths escaping cwd, API/external URLs, or empty values. Do not parse arbitrary prose with a new filesystem heuristic.

- [ ] Add tests before implementation for these exact adapter cases:

```js
assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "1", toolName: "read", input: { path: "src/a.ts" } }, "/repo"), "/repo/src/a.ts");
assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "2", toolName: "read", input: { file_path: "query?.json" } }, "/repo"), "/repo/query?.json");
assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "3", toolName: "read", input: { path: "../outside.txt" } }, "/repo"), null);
assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "4", toolName: "read", input: { path: "/etc/passwd" } }, "/repo"), "/etc/passwd");
assert.equal(resolveToolFilePath({ type: "toolCall", toolCallId: "5", toolName: "read", input: { path: "/api/files/repo/a.ts" } }, "/repo"), null);
```

- [ ] Run the new helper tests before implementation:

```bash
node --test components/MessageView.test.mjs lib/file-links.test.mjs
```

Expected: FAIL only on the missing adapter/export and new assertions.

- [ ] Pass `cwd` and `onOpenFile` from `MessageView` through `BlockView` to `ToolCallBlock`; pass them into `BashExecutionView` as well, but keep bash full-output links on `/api/agent/{id}/bash-output` and do not convert them to `/api/files`.

- [ ] In expanded tool details, render one native `button type="button" className="tool-file-link"` when `resolveToolFilePath` returns a path. The button must show the basename and bounded path title, use `onOpenFile?.(resolvedPath)`, and live outside the row disclosure button so no interactive button is nested inside another button. Keep collapsed summaries, input/output labels, diff rendering, error previews, running states, and expansion callback unchanged.

- [ ] Preserve existing message markdown path behavior. Do not alter `MarkdownBody`, `resolveLocalFileHref`, `encodeFilePathForApi`, `handleOpenLinkedFile`, or `openFileTab`; the adapter only supplies the same absolute path shape to the existing callback.

- [ ] Add static-render assertions that tool rows retain `aria-expanded`, `data-state`, `tool-detail-input`, `tool-detail-output`, and `tool-file-link` source wiring. Add an exported callback-forwarding test or source contract proving the exact resolved path reaches `onOpenFile`; explicitly label this as callback wiring, not proof that a browser click occurred.

- [ ] Add security tests in `lib/file-links.test.mjs` for relative escape rejection, encoded `?`, `#`, and `:line` preservation, Windows-relative normalization, and external absolute paths being returned only for the server allow-list decision. Add `app/api/files/inline-link-security.test.mjs` source assertions for all of these route invariants: `getAllowedFileRoots`, `isFilePathAllowed`, `allowedByRoot`, `allowedBySessionReference`, `type !== "list"`, `isExistingFilePathAllowed`, and HTTP 403 on neither authorization path. The test must reject any new direct `fs` read in `MessageView` or any removal of the route’s allow-list checks.

- [ ] Add CSS for `.tool-file-link` with keyboard focus, text underlining or an icon plus text, ellipsis, non-color hover/focus state, and mobile wrapping. Respect `prefers-reduced-motion`; do not use color as the only path affordance.

- [ ] Run focused tests, including the route contract and existing session-reference security suite:

```bash
node --test components/MessageView.test.mjs lib/file-links.test.mjs app/api/files/inline-link-security.test.mjs lib/session-file-references.test.mjs lib/file-access.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: all focused tests pass, outside-root inline paths are rejected by the client resolver or remain server-authorized only through existing session-reference logic, TypeScript passes, and diff check is clean.

- [ ] Commit only these Task 5 files:

```bash
git add components/MessageView.tsx components/MessageView.test.mjs lib/file-links.test.mjs app/api/files/inline-link-security.test.mjs app/globals.css
git commit -m "feat: add native Zosma tool file links"
```

## Task 6: Quiet explorer and tab entry points without adding a permanent split explorer

**Files:**

- Modify: `components/FileExplorer.tsx`
- Modify: `components/SessionSidebar.tsx`
- Modify: `components/TabBar.tsx` only if existing classes need the Phase 4 state styles
- Modify: `components/AppShell.file-viewer-state.test.mjs`
- Modify: `components/SessionSidebar.test.mjs`
- Modify: `app/globals.css`

- [ ] Add source-contract tests before implementation. Assert that the existing active-viewer contract remains exactly one `<FileViewer>`, no `fileTabs.map`, `initialState={activeFileTab.viewerState}`, revision-based viewer key, and `watchEnabled={rightPanelOpen}`. Assert that the sidebar still uses `loadExplorerOpen`/`saveExplorerOpen`, `FileExplorer`, `onOpenFile`, upload picker, change collapse, worktree controls, and session action ownership.

- [ ] Run the pre-change focused tests:

```bash
node --test components/AppShell.file-viewer-state.test.mjs components/SessionSidebar.test.mjs components/file-tab-state.test.mjs
```

Expected: current tests pass; new keyboard/class assertions fail before implementation.

- [ ] In `FileExplorer.TreeNode`, retain the wrapper `div` because the row contains independent mention/download buttons, but add `role="button"`, `tabIndex={0}`, an accessible label/title, and an `onKeyDown` handler that invokes the same `handleClick` for Enter and Space while preventing default scrolling. Keep nested mention/download buttons and their `stopPropagation` behavior unchanged.

- [ ] In `FileExplorer.ChangeRow`, apply the same keyboard contract to the existing clickable change row and preserve `modeHint: "diff"`. Do not turn rows into nested buttons, do not add a new filesystem API, and do not change upload or Git status behavior.

- [ ] Add semantic classes to the existing explorer section, toggle, upload, refresh, change-summary, tree row, and change row. Style them as quiet sidebar entry points using existing semantic variables, visible focus rings, text/icon labels, and non-color selected/changed state. Keep the user’s persisted explorer-open preference and current default behavior; do not make a right split panel permanent.

- [ ] Keep `TabBar` native tab semantics: each file tab remains `role="tab"`, `aria-selected`, a native close button, middle-click close behavior, and the exact `onSelectTab`/`onCloseTab` callbacks. Add only quiet class styling and `:focus-visible` states if needed.

- [ ] Add manual-only note in the source-contract test comments: static markup proves role/handler wiring, not actual keyboard event dispatch, focus movement, file fetch, or viewer rendering. Those checks belong to Task 7.

- [ ] Run focused tests, TypeScript, and diff check:

```bash
node --test components/AppShell.file-viewer-state.test.mjs components/SessionSidebar.test.mjs components/file-tab-state.test.mjs lib/file-explorer-state.test.mjs lib/file-links.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: all tests pass and TypeScript passes.

- [ ] Commit only changed Task 6 files:

```bash
git add components/FileExplorer.tsx components/SessionSidebar.tsx components/TabBar.tsx components/AppShell.file-viewer-state.test.mjs components/SessionSidebar.test.mjs app/globals.css
git commit -m "style: quiet Zosma file entry points"
```

If `TabBar.tsx` needs no change, do not stage it.

## Task 7: Full gates, lint fingerprint, source/runtime distinction, and manual acceptance

**Files:** No further source changes unless a gate identifies a defect. Temporary reports only.

- [ ] Run the focused Phase 4 suite:

```bash
node --test components/AppShell.session-header.test.mjs components/AppShell.mobile-toolbar.test.mjs components/AppShell.auto-name.test.mjs components/AppShell.file-viewer-state.test.mjs components/BranchNavigator.test.mjs components/MessageView.test.mjs components/SessionSidebar.test.mjs components/SessionSidebar.workspace.test.mjs components/file-tab-state.test.mjs lib/session-details.test.mjs lib/file-links.test.mjs lib/file-access.test.mjs lib/session-file-references.test.mjs app/api/files/inline-link-security.test.mjs app/api/sessions/runtime-route.test.mjs
```

Expected: all focused tests pass. Static/source tests count as source-contract evidence only.

- [ ] Run TypeScript and the complete existing test suite:

```bash
node_modules/.bin/tsc --noEmit
npm test
```

Expected: TypeScript passes; the full suite passes with the pre-phase tests plus the new Phase 4 tests. Record the exact test count rather than copying the Phase 3 count, because new tests add cases.

- [ ] Run ESLint and compare normalized fingerprints to the Task 0 report:

```bash
npm run lint -- --format json > /tmp/zosma-phase4-eslint-final.json || test $? -eq 1
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const norm=s=>s.replace(/\b(?:line|column)\s+\d+\b/gi,x=>x.replace(/\d+/,"#")).replace(/\s+/g," ").trim();const fp=f=>{const rows=JSON.parse(fs.readFileSync(f,"utf8"));const out=[];for(const row of rows)for(const m of row.messages.filter(x=>x.severity>0))out.push([path.relative(process.cwd(),row.filePath),m.severity,m.ruleId??"unknown",norm(m.message)]);return out.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};assert.deepEqual(fp("/tmp/zosma-phase4-eslint-baseline.json"),fp("/tmp/zosma-phase4-eslint-final.json"));console.log("ESLint fingerprint unchanged: 15 known errors, 0 warnings")'
```

Expected: fingerprint is identical to Task 0: 15 known `react-hooks/preserve-manual-memoization` errors and 0 warnings. No unrelated lint cleanup belongs in Phase 4.

- [ ] Run whitespace and repository-boundary checks:

```bash
git diff --check
git status --short --branch
git diff --stat HEAD~5..HEAD
```

Expected: no whitespace errors; only planned Phase 4 commits are tracked; untracked Phase 1/Phase 3 plans and `pnpm-lock.yaml` remain untouched and uncommitted. Do not use a cleanup command that deletes them.

- [ ] Start development server for manual verification only:

```bash
npm run dev
```

Do not run `next build`. Stop the dev server after checks with the normal terminal interrupt, not a destructive system command.

- [ ] Manual desktop checklist at wide and narrow desktop widths, in light and dark themes:

  1. Existing session header shows stored title, quiet action density, visible file toggle, and one overflow trigger.
  2. New-session header shows new-session state and cwd without persisted ID/file/stats claims.
  3. Overflow opens by mouse and keyboard, has visible focus, closes with Escape and outside click, and returns focus to its trigger.
  4. Generate title preserves disabled unsaved/empty explanations, loading state, stale-session guard, success text, and error text.
  5. System prompt loads lazily, displays empty/loading/content states, and remains reachable from overflow.
  6. Session Details includes name, file, ID, cwd, project root, created/modified, message counts, token buckets, active duration, cost, context, and cache-hit rate when source data exists; absent optional values are omitted rather than fabricated.
  7. Copy ID and copy file path work and announce copied state without relying on color.
  8. Branches open from the quiet action path and controlled hidden/mobile panel; selecting a branch changes in-session context only.
  9. Fork from a user-message action creates a new independent session, updates the sidebar parent relationship, and does not call `navigate_tree`.
  10. Rename/delete remain in the sidebar, normal delete confirms, Shift-click bypass remains deliberate, and selected-session deletion returns to a fresh composer.
  11. Full history/session export opens the existing exported HTML in a new tab and is still the raw inspection path; no Trajectory UI appears.
  12. File tabs select/close correctly, only active viewer mounts, viewer state survives tab switching, and closing the panel pauses watching.
  13. Explorer stays an optional collapsible sidebar entry point; no permanent split explorer is added.
  14. Explorer file/change rows activate with mouse, Enter, and Space; mention, download, upload, Git diff, worktree, and refresh actions remain distinct.

- [ ] Manual inline-file and security checklist:

  1. Assistant markdown links inside cwd open in the existing viewer tab.
  2. Tool rows with `path` or `file_path` show a native file action in expanded details and invoke the existing open-file callback with the exact resolved path.
  3. Paths containing `?`, `#`, spaces, Windows separators, and `:line` do not become query fragments or lose characters when opening.
  4. Relative `../outside` paths produce no inline action; absolute external paths never bypass the server route.
  5. A file outside allowed roots returns the existing access-denied response when requested; no UI change relaxes `isFilePathAllowed`, `isExistingFilePathAllowed`, or session-reference authorization.
  6. Bash full-output view/download continues using its session-reference-protected `/api/agent/{id}/bash-output` route.

- [ ] Manual accessibility and responsive checklist:

  1. Every header, overflow, branch, details-copy, file-tab, explorer, and tool-file action is reachable by keyboard with a visible `:focus-visible` state.
  2. Menus and panels expose native button semantics, `aria-expanded`, `aria-controls`, labels, and status text; active/selected/running/error states have text or weight/outline cues beyond color.
  3. Mobile at 390×844 keeps title, more controls, details, branches, system prompt, export, file panel, composer, and sidebar drawer reachable without horizontal page overflow.
  4. Tool details scroll inside their bounded panel; file paths wrap or ellipsize without pushing the page wider.
  5. Light and dark themes preserve readable contrast; `prefers-reduced-motion: reduce` disables header/details/branch/tool/explorer transitions and running sweeps without hiding state.
  6. Focus does not land on covered mobile stats/file controls while the mobile action layer is open.

- [ ] Record evidence separately: source-contract tests prove class names, callback presence, route guards, and ownership expressions; Node unit tests prove pure formatting/path helpers; runtime/manual checks prove clicks, keyboard events, focus, fetch authorization, tab/viewer behavior, menu dismissal, and branch/fork effects. Do not describe static render output as proof of interactions.

## Planned commits

1. `style: quiet Zosma session header actions`
2. `feat: complete Zosma session details`
3. `style: preserve controlled Zosma branch actions`
4. `feat: add native Zosma tool file links`
5. `style: quiet Zosma file entry points`

## Phase boundary into Phase 5

Phase 4 ends with Pi actions reachable through quiet header/overflow patterns, complete details available from current session/stat sources, branch navigation and independent forks still distinct, inline file actions using existing path encoding and allow-list checks, file tabs/viewer/explorer still available without a permanent split requirement, and rename/delete/export confirmations still owned by their current components. Phase 5 starts at settings presentation only: models/providers/auth, plugins, skills, appearance, language, and defaults move into the approved DeepSeek-style settings modal. Phase 4 does not redesign settings or add metrics below the composer.
