# Phase 6: Metrics, Responsive Hardening, and Visual Parity Implementation Plan

> **For agentic workers:** Use `/skill:executing-plans`. Complete tasks in order. Stop when a baseline, focused gate, or required browser audit cannot be completed. Do not run `next build`.

**Goal:** Add a low-emphasis, Pi-backed metrics line below the composer; remove duplicate header statistics; complete measured responsive, accessibility, theme, and visual-parity hardening against the pinned DeepSeek Harness reference.

**Architecture:** Keep `useAgentSession` as the only session-statistics owner. Reuse `SessionStatsInfo`, live `contextUsage`, and existing formatters in `lib/session-details.ts`. Add one CSS-free derivation helper and one small presentational `SessionMetricsLine`. Render it from `ChatWindow` immediately below the existing composer without changing `ChatInput`, SSE state, session callbacks, or runtime/API contracts. `AppShell` continues holding statistics for Session Details and title guards, but its competing header token/cost strip becomes an icon-only mobile Details affordance; desktop Details remains in the existing overflow menu.

**Reference:** DeepSeek Harness commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, especially:

- `packages/client/ui-conversation/src/client/chat/StatsLine.tsx`
- `packages/client/ui-conversation/src/client/chat/StatsLine.module.css`
- `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`
- `packages/client/ui-conversation/src/client/chat/ChatView.module.css`
- Existing Phase 1–5 reference files named in their plans

**Roadmap:** `docs/superpowers/roadmaps/2026-08-22-deepseek-style-zosma-dashboard-roadmap.md`, Phase 6.

---

## Non-Negotiable Decisions

1. **No new telemetry.** The repository has no existing decode-time/stream-start measurement. Do not add timers to `useAgentSession` merely to display throughput. Omit `Est. tok/s` until a real existing measurement becomes available.
2. **No TTFT.** Pi exposes no durable TTFT field in `SessionStatsInfo`; do not infer one from transport timing.
3. **Authoritative sources only.** Counts, token buckets, cost, and active duration come from `SessionStatsInfo`; context comes from live `contextUsage` with `stats.contextUsage` as fallback.
4. **Prompt-token total is transparent arithmetic.** Visible `Input` equals `input + cacheRead + cacheWrite`, matching the same prompt-side denominator already used by `getCacheHitRate()`.
5. **Unavailable optional values disappear.** No `0 tok/s`, `$0.00`, `?`, fake percentages, or placeholder metrics.
6. **Session Details remains complete.** Do not remove `sessionStats`/`contextUsage` state from `AppShell`, the `/session` command path, `openSessionStatsPanel`, full token rows, context, active duration, IDs, paths, or cost.
7. **No generic metrics framework.** One helper and one component are enough.
8. **Measured parity only.** Global polish changes require a recorded mismatch against the pinned reference or a verified responsive/accessibility defect.

---

## File Map

### Create

- `components/SessionMetricsLine.tsx` — low-emphasis grouped metrics line.
- `components/SessionMetricsLine.test.mjs` — static render, omission, and wiring contracts.

### Modify

- `lib/session-details.ts` — add pure metric-value derivation; reuse current duration/token/cost/cache helpers.
- `lib/session-details.test.mjs` — test authoritative arithmetic and omission rules.
- `lib/i18n/messages/en.ts` — metrics line labels.
- `lib/i18n/messages/zh-CN.ts` — matching metrics line labels.
- `components/ChatWindow.tsx` — render metrics line directly below composer.
- `components/AppShell.tsx` — remove duplicate header metric values; retain Details access and full details panel.
- `components/AppShell.mobile-toolbar.test.mjs` — replace compact-statistics contracts with icon-only Details contracts.
- `components/AppShell.session-header.test.mjs` — preserve desktop overflow Details and full details data.
- `app/globals.css` — metrics geometry and only audit-proven responsive/parity fixes.

### Modify only if a measured audit finding requires it

- `components/ChatInput.tsx`
- `components/MessageView.tsx`
- `components/SessionSidebar.tsx`
- `components/SettingsShell.tsx`
- `components/FileViewer.tsx`
- Their focused tests

### Do not modify without a verified missing authoritative value

- `lib/pi-types.ts`
- `hooks/useAgentSession.ts`
- `lib/rpc-manager.ts`
- Any API route

---

## Safe-Edit Protocol

`ChatWindow.tsx`, `AppShell.tsx`, `ChatInput.tsx`, and several inline-style-heavy TSX files are vulnerable to newline and `?` corruption in this environment.

Before each TS/TSX edit:

- [ ] Record `sha256sum`, `wc -c`, and `wc -l` for every target.
- [ ] Copy each target to a unique `/tmp/phase6-*.bak` path.
- [ ] Prefer one bounded, exact-count Node rewrite for multiline TSX changes.
- [ ] Abort unless every old block matches exactly once.
- [ ] Re-read the written file and verify bytes, newline count, no CR/NUL bytes, and expected `?`/`=>` counts.
- [ ] Run `git diff --check` and `node_modules/.bin/tsc --noEmit` immediately.
- [ ] Restore from backup before attempting a different edit if any integrity or type check fails.

Never use shell heredocs or Python string replacement for TS/TSX. Do not modify existing untracked phase plans or `pnpm-lock.yaml`.

---

## Task 0: Freeze Baseline and Capture Audit Matrix

No source commit in this task.

- [ ] Confirm only known untracked files exist:

```bash
git status --short
git log -7 --oneline
```

- [ ] Confirm pinned reference checkout is exact and clean:

```bash
git -C ../deepseek-harness rev-parse HEAD
git -C ../deepseek-harness status --short
```

Expected commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

- [ ] Capture automated baseline:

```bash
npm test
node_modules/.bin/tsc --noEmit
set +e
npm run lint > /tmp/phase6-eslint-baseline.log 2>&1
status=$?
printf 'eslint_exit=%s\n' "$status"
grep -Eo '[0-9]+ problems? \([0-9]+ errors?, [0-9]+ warnings?\)' /tmp/phase6-eslint-baseline.log | tail -1
```

Expected at plan time: 685 tests pass; TypeScript passes; ESLint fingerprint remains 15 errors and 0 warnings, all existing `react-hooks/preserve-manual-memoization` findings.

- [ ] Start development server with `npm run dev`; never run `next build`.

- [ ] Capture or inspect these baseline states in both Zosma and pinned DeepSeek Harness:

| State | Desktop 1440×900 | Narrow desktop 900×800 | Mobile 390×844 |
|---|---:|---:|---:|
| Empty/new session | Light + dark | Light + dark | Light + dark |
| Populated conversation | Light + dark | Light + dark | Light + dark |
| Streaming thinking/tool activity | Light + dark | Light + dark | Light + dark |
| Expanded tool details | Light + dark | Light + dark | Light + dark |
| Workspace menu/search | Light + dark | Light + dark | Light + dark |
| Unified settings | Light + dark | Light + dark | Light + dark |
| File viewer/panel | Light + dark | Light + dark | Light + dark |
| Error/empty states | At least one theme | At least one theme | At least one theme |

Store screenshots and notes under `/tmp/zosma-phase6-audit/`, not in the repository.

- [ ] Record each mismatch as: surface, state, viewport, theme, reference behavior, current behavior, severity, smallest likely fix.

Stop if browser access is unavailable. Planning may continue, but Phase 6 implementation cannot be declared complete without this matrix.

---

## Task 1: Derive Display-Safe Session Metric Values

**Files:** `lib/session-details.ts`, `lib/session-details.test.mjs`, `lib/i18n/messages/en.ts`, `lib/i18n/messages/zh-CN.ts`.

### Tests first

- [ ] Extend `lib/session-details.test.mjs` with one helper contract covering:

  - `turns = userMessages`.
  - `steps = assistantMessages`.
  - Tool calls appear only when positive.
  - Active duration uses `formatSessionDuration()` only when positive.
  - Prompt tokens equal `input + cacheRead + cacheWrite`.
  - Output tokens appear only when positive.
  - Cache hit uses `getCacheHitRate()` and retains a real `0%` when the denominator is positive.
  - Cost uses `formatSessionCost()` and omits zero/invalid cost.
  - Context prefers the explicit live value, falls back to `stats.contextUsage`, and derives percentage from finite `tokens/contextWindow` only when SDK percentage is absent.
  - Context percentage is rounded and capped at 100 for the compact indicator.
  - Invalid, negative, non-finite, and entirely empty data produce omission-safe values or `null`.

- [ ] Add `getSessionMetricValues(stats, contextUsage?)` to `lib/session-details.ts`. Keep its return shape flat and presentation-neutral:

```ts
interface SessionMetricValues {
  turns: number;
  steps: number;
  toolCalls: number | null;
  active: string | null;
  cacheHitPercent: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
  cost: string | null;
  contextPercent: number | null;
}
```

Return `null` only when no count or optional metric is meaningful. Reuse existing helper functions; do not duplicate their arithmetic.

- [ ] Add concise English and Chinese keys for counts, tools, active time, cache hit, input/output tokens, and context. Keep cost as its already formatted value.

Suggested keys:

```text
session.metrics.counts
session.metrics.tools
session.metrics.active
session.metrics.cacheHit
session.metrics.tokens
session.metrics.context
```

- [ ] Run focused checks:

```bash
node --test lib/session-details.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
```

- [ ] Commit only Task 1 files:

```bash
git add lib/session-details.ts lib/session-details.test.mjs lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "feat: derive composer session metrics"
```

---

## Task 2: Render DeepSeek-Style Metrics Below Composer

**Files:** create `components/SessionMetricsLine.tsx`, create `components/SessionMetricsLine.test.mjs`, modify `components/ChatWindow.tsx`, modify `app/globals.css`.

### Component behavior

- [ ] Create `SessionMetricsLine` with props:

```ts
{
  stats: SessionStatsInfo | null;
  contextUsage?: ContextUsage | null;
}
```

- [ ] Call `getSessionMetricValues()`. Return `null` when it returns `null`.

- [ ] Build compact groups in this order:

  1. Turns and steps.
  2. Tool calls and active duration, joined by `·` when both exist.
  3. Cache hit and context, joined by `·` when both exist.
  4. Input and output tokens, joined by `·` when both exist.
  5. Cost.

- [ ] Render groups as semantic text spans separated by a pipe span with `aria-hidden="true"`. Put complete text in `aria-label` and `title` so ellipsis never destroys access to the full line. Do not use `aria-live`; streaming/session updates must not repeatedly interrupt screen readers.

- [ ] Do not make the line a button. Session Details remains in the header/menu.

### Placement

- [ ] Import and render `SessionMetricsLine` in `ChatWindow` immediately after `{chatInputElement}` and before `ExtensionStatusBar` in the active-session composer wrapper.

- [ ] Pass the existing `sessionStats` and live `contextUsage` values directly. Do not lift new state and do not add callbacks.

- [ ] Do not alter `ChatInput` props or internals. Do not touch prompt anchoring, minimap ownership, viewport reconciliation, safe-area padding, or extension status ordering.

### CSS

- [ ] Add only these semantic classes:

```text
.session-metrics-shell
.session-metrics-line
.session-metrics-separator
```

Match pinned `StatsLine.module.css` behavior:

- 12px font, 20px line height.
- Centered low-emphasis tertiary color.
- Tabular numerals.
- One line with ellipsis, never horizontal page overflow.
- Same composer width axis and desktop right clearance as `.composer-shell`.
- Mobile side padding matches the composer.
- Small top/bottom spacing so Extension Status remains visually separate.

### Tests

- [ ] In `SessionMetricsLine.test.mjs`, statically render representative data and assert exact visible groups, ordering, pipe separators, full title/aria label, and omission of zero cost/tool/context segments.

- [ ] Add source contracts in the same test proving `ChatWindow` renders the line after `chatInputElement`, passes `sessionStats` and `contextUsage`, and does not add metric state to `ChatInput`.

- [ ] Run focused checks:

```bash
node --test lib/session-details.test.mjs components/SessionMetricsLine.test.mjs components/ConversationFlow.test.mjs components/ChatWindow.process-details.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
```

- [ ] Commit only Task 2 files:

```bash
git add components/SessionMetricsLine.tsx components/SessionMetricsLine.test.mjs components/ChatWindow.tsx app/globals.css
git commit -m "feat: add composer session metrics line"
```

---

## Task 3: Remove Competing Header Statistics Without Losing Details

**Files:** `components/AppShell.tsx`, `components/AppShell.mobile-toolbar.test.mjs`, `components/AppShell.session-header.test.mjs`, `app/globals.css`.

- [ ] Preserve these owners before deleting presentation:

  - `sessionStats` and `contextUsage` state.
  - `handleSessionStatsChange` and `handleContextUsageChange`.
  - `openSessionStatsPanel` and `/session` command callback.
  - Full Session Details panel and every metadata/count/token/context/active/cost row.
  - Desktop overflow item calling `toggleTopPanel("session")`.
  - Title-generation message guards using `sessionStats.userMessages`.

- [ ] Delete `renderSessionStatsButton()` and its compact token/cost/context tooltip formatting. Delete the desktop render call; the desktop overflow Details item remains the entry point.

- [ ] Replace the mobile stats strip with `renderMobileSessionDetailsButton()`:

  - Icon-only neutral Details button.
  - Calls `toggleTopPanel("session")`.
  - Keeps `aria-label`, `aria-pressed`, covered-state `disabled`, `tabIndex=-1`, `aria-hidden`, and focus/interaction suppression while the mobile action layer is open.
  - Shows no token, cost, cache, or context values; composer metrics line is the only compact statistics chrome.

- [ ] Remove obsolete inline container-query CSS for `.mobile-session-stats`, `.mobile-session-stat-io`, and `.mobile-session-stat-cost`.

- [ ] Remove the unreferenced `.chat-stats-center` rule from `app/globals.css` if repository-wide grep confirms no remaining owner.

- [ ] Simplify the desktop file-toggle margin so it no longer depends on whether statistics/context exist. Preserve current file panel callback, `aria-controls`, `aria-expanded`, and covered mobile behavior.

- [ ] Update mobile/header tests:

  - Assert icon-only Details access and its covered-state guard.
  - Assert old mobile statistics/container-query classes are gone.
  - Assert desktop overflow still exposes Details.
  - Assert full Session Details still imports and uses duration, token, cache, and cost helpers.

- [ ] Run focused checks:

```bash
node --test components/AppShell.mobile-toolbar.test.mjs components/AppShell.session-header.test.mjs components/SessionMetricsLine.test.mjs lib/session-details.test.mjs
node_modules/.bin/tsc --noEmit
git diff --check
```

- [ ] Commit only Task 3 files:

```bash
git add components/AppShell.tsx components/AppShell.mobile-toolbar.test.mjs components/AppShell.session-header.test.mjs app/globals.css
git commit -m "refactor: remove duplicate header statistics"
```

---

## Task 4: Perform Responsive, Theme, and Accessibility Audit

No speculative source changes. Use the Task 0 matrix and inspect all Phase 1–5 surfaces after Tasks 1–3.

### Responsive and overflow

- [ ] At 1440×900, 900×800, 640×800, 390×844, and 320×700, verify:

  - No page-level horizontal overflow.
  - Sidebar drawer, overlays, file panel, settings panel, tool details, menus, and composer stay within viewport.
  - Growing textarea and software-keyboard visual viewport do not hide send/stop or metrics.
  - Metrics line ellipsizes without changing composer width or transcript alignment.
  - Empty/new hero and active-session composer share intended horizontal axis.
  - Safe-area insets remain correct.

- [ ] In browser console, verify root width after opening each major overlay:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

### Keyboard and focus

- [ ] Keyboard-only walkthrough:

  - Sidebar search/workspaces/sessions/worktree actions.
  - New-session workspace selector.
  - Header overflow, Branches, System Prompt, Session Details, export/log.
  - Composer textarea, model, thinking, tool preset, attachments, commands, compaction, sound, send/stop.
  - Message copy/edit/fork, disclosure rows, file references.
  - Settings category arrows/Home/End, Tab trap, Escape, focus restoration.
  - File tabs/viewer controls and panel close.

- [ ] Every focusable control has visible focus. No hidden/covered element remains tabbable. Status is not conveyed only by color.

### Theme, contrast, and motion

- [ ] Repeat key states in light and dark themes. Verify text, borders, selected rows, disabled controls, errors, tool states, backdrop, and focus ring remain readable.

- [ ] Emulate `prefers-reduced-motion: reduce`. Verify shimmer, pulse, transitions, theme transition, sidebar motion, disclosures, notices, and settings backdrop honor reduced motion.

### Behavior regression

- [ ] Verify sessions, workspace restore, worktrees, streaming, reconnect, retries, tools, branches, fork, compaction, files, title generation, system prompt, details, export, settings auth/config, and error states.

- [ ] Recheck Phase 5 specifically: direct Light/Dark/Auto selection, category focus movement, Tab trapping, Escape/backdrop/close paths, focus restoration, and model refresh after closing.

For every failure, record exact reproduction, expected reference/behavior, root owner, smallest fix, and focused test. Do not edit until the owner and caller path are known.

---

## Task 5: Apply Only Audit-Proven Parity Fixes

**Files:** only files named by Task 4 findings and their focused tests.

- [ ] Group fixes by owner, not screenshot. Prefer shared CSS variables/classes over repeated inline patches.

- [ ] Before touching a helper, grep every caller. Fix shared root causes once.

- [ ] Do not:

  - Add dependencies.
  - Copy DeepSeek component architecture.
  - Change runtime/API ownership.
  - Move actions merely for visual similarity when current Pi behavior would be lost.
  - Introduce a new breakpoint without a measured layout failure.
  - Add animation unsupported by reduced-motion treatment.

- [ ] After each surface group, rerun its focused tests, TypeScript, `git diff --check`, and the exact visual state that exposed it.

- [ ] Commit measured fixes together only when they share one visual/root owner:

```bash
git add <only measured fix files and tests>
git commit -m "style: finish responsive dashboard parity"
```

If no meaningful mismatch remains, skip this commit. Do not manufacture a polish diff to satisfy the commit list.

---

## Task 6: Remove Obsolete Presentation Code

**Files:** determined by repository-wide reference search after Tasks 3–5.

- [ ] Search removed/replaced class and helper names:

```bash
grep -R "chat-stats-center\|mobile-session-stats\|mobile-session-stat-io\|mobile-session-stat-cost\|renderSessionStatsButton" components app lib --exclude='*.test.mjs'
```

Expected: no production matches.

- [ ] Search for stale Phase 1–5 presentation wrappers only when Task 4 identified them as redundant. Do not delete behavior owners, compatibility paths, or data state merely because a class looks old.

- [ ] Run the full focused set after deletion. Fold tiny cleanup into the matching Task 5 commit when possible; otherwise use:

```bash
git add <obsolete presentation files and tests>
git commit -m "refactor: remove superseded dashboard chrome"
```

Skip this commit when Task 3 already removed all verified obsolete code.

---

## Task 7: Final Integrated Verification

- [ ] Focused metrics/header tests:

```bash
node --test lib/session-details.test.mjs components/SessionMetricsLine.test.mjs components/AppShell.mobile-toolbar.test.mjs components/AppShell.session-header.test.mjs components/ConversationFlow.test.mjs components/ChatWindow.process-details.test.mjs
```

- [ ] Full tests and TypeScript:

```bash
npm test
node_modules/.bin/tsc --noEmit
git diff --check
```

- [ ] ESLint fingerprint comparison:

```bash
set +e
npm run lint > /tmp/phase6-eslint-final.log 2>&1
status=$?
printf 'eslint_exit=%s\n' "$status"
grep -Eo '[0-9]+ problems? \([0-9]+ errors?, [0-9]+ warnings?\)' /tmp/phase6-eslint-final.log | tail -1
diff -u /tmp/phase6-eslint-baseline.log /tmp/phase6-eslint-final.log || true
```

Expected: no new lint finding; accepted baseline remains 15 errors and 0 warnings unless separately fixed without scope expansion.

- [ ] Run `git status --short`. Expected: no tracked changes; existing untracked plans and `pnpm-lock.yaml` remain untouched.

- [ ] Repeat Task 0 visual matrix for every changed state and compare against before/reference captures.

- [ ] Final acceptance requires all of these:

  - Metrics use only authoritative or transparent arithmetic values.
  - `Est. tok/s` and TTFT are absent because no source exists.
  - Missing metrics disappear rather than render placeholders.
  - Session Details remains complete and reachable on desktop/mobile and through `/session`.
  - Composer, metrics, transcript, and minimap alignment remain stable.
  - Desktop, narrow desktop, and mobile pass light/dark checks.
  - Focus, keyboard, touch, contrast, overflow, safe-area, and reduced motion pass.
  - Sessions, workspaces, worktrees, streaming, tools, branches, files, settings, and errors still work.
  - No visible DeepSeek branding appears.
  - No unmeasured global polish or unrelated refactor landed.

---

## Planned Commit Summary

1. `feat: derive composer session metrics`
2. `feat: add composer session metrics line`
3. `refactor: remove duplicate header statistics`
4. `style: finish responsive dashboard parity` — only if Task 4 records measured fixes.
5. `refactor: remove superseded dashboard chrome` — only if verified cleanup remains after Tasks 3–5.

Phase boundary is complete only after automated gates and the full browser matrix pass. A green unit suite without visual/responsive evidence is not sufficient for Phase 6.
