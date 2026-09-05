# DeepSeek-Style Zosma Dashboard Phase 3 Conversation Flow and Composer Implementation Plan

> **For agentic workers:** Use `/skill:executing-plans`. Complete tasks in order. Stop when a baseline or focused gate fails.

**Goal:** Match the pinned DeepSeek Harness conversation direction with generous user bubbles, open-canvas assistant answers, linear thinking/tool disclosures, low-emphasis flow markers, and one large rounded composer while preserving Pi behavior.

**Architecture:** Keep `ChatWindow`, `MessageView`, `ChatInput`, and `BranchNavigator` ownership unchanged. Add presentation helpers only where current data already exists. Remove the redundant completed-turn `ProcessDetailsGroup`; render normalized process messages directly. Reuse every existing callback, menu, draft key, SSE state, branch identity, and file-opening path.

**Reference:** DeepSeek Harness commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`, especially `MessageItem.module.css`, `AssistantMarkdown.module.css`, `ReasoningRow.module.css`, `ToolRow.module.css`, `InputBar.module.css`, and `ChatView.module.css`.

**Roadmap:** `docs/superpowers/roadmaps/2026-08-22-deepseek-style-zosma-dashboard-roadmap.md`, Phase 3.

## Scope

Include:

- Right-aligned user bubbles capped at `min(525px, 82%)`, 22px radius, 16/24 typography.
- Open-canvas assistant answers at 16/28 typography.
- Thinking disclosures open while live and collapsed when complete, including deferred-content loading.
- One-line tool rows with human title, preview, duration, and running/success/error/interrupted text.
- Direct completed process rows without an outer process card.
- Low-emphasis compaction, retry, branch, written-file reference, and message-action treatment.
- One 22px composer surface containing textarea, completion overlays, and controls.
- Mobile, keyboard, screen-reader, and reduced-motion treatment.

Preserve:

- API calls, SSE lifecycle, reconciliation, message schemas, normalized tool data, draft persistence, and all callbacks.
- Send, stop, steer, follow-up, queue recall, retry status, compaction, attachments, drag/drop, paste, history, slash, `@` file completion, model, thinking, tool preset, sound, and mobile keyboard behavior.
- Branch tree topology, selection identity, preview text, controlled/uncontrolled open state, positioning, and `ResizeObserver` behavior.
- Written-file derivation and `onOpenFile` behavior.

Defer:

- Header action consolidation and header placement changes to Phase 4.
- Inline links inside arbitrary tool payloads to Phase 4.
- Settings to Phase 5; metrics relocation and final parity audit to Phase 6.
- New tool-renderer frameworks, dependencies, backend changes, or `useAgentSession` changes.

## Baseline

At Phase 2 completion (`94e1eac`): TypeScript passes, 637 tests pass, and ESLint has exactly 15 known `react-hooks/preserve-manual-memoization` errors with 0 warnings: `ChatInput` 6, `ChatMinimap` 5, `SessionSidebar` 2, `useAgentSession` 2.

Do not add the existing untracked Phase 1 plan or `pnpm-lock.yaml`.

## Files

Create:

- `components/ConversationFlow.test.mjs`
- `lib/conversation-flow.ts`
- `lib/conversation-flow.test.mjs`

Modify:

- `components/MessageView.tsx`
- `components/MessageView.test.mjs`
- `components/ChatWindow.tsx`
- `components/ChatWindow.process-details.test.mjs`
- `components/ChatInput.tsx`
- `components/ChatInput.test.mjs`
- `components/AppShell.tsx`
- `components/AppShell.mobile-toolbar.test.mjs`
- `components/BranchNavigator.tsx`
- `components/BranchNavigator.test.mjs`
- `components/TurnWrittenFiles.tsx`
- `components/TurnWrittenFiles.test.mjs`
- `app/globals.css`
- `lib/i18n/messages/en.ts`
- `lib/i18n/messages/zh-CN.ts`

Do not modify `hooks/useAgentSession.ts`, `components/MarkdownBody.tsx`, routes, manifests, or lockfiles. `components/AppShell.tsx` is in scope only for the existing mobile branch trigger class; do not move or reorganize header actions.

## Mandatory Safe-Editing Protocol

This repository can strip newlines and corrupt `?` characters when multiline edits use unsafe mechanisms.

For every task that changes `.ts`, `.tsx`, or CSS:

1. Copy each target to `/tmp/phase3-backups/<relative-path>` before editing.
2. Use `write` for complete file rewrites.
3. For surgical edits, use only one-line `edit` replacements, or create a temporary Python script with `write`; that script must use `readlines()` and `writelines()` plus sentinel-indexed list splices.
4. Do not use multiline `edit`, shell heredocs, Python `open().write()`, Python string `.replace()`, or generated shell text rewrites.
5. After each file, compare line count against its backup, run `git diff --check`, inspect `git diff --word-diff=porcelain -- <file>`, and run the focused TypeScript/test gate before deleting backups.
6. If a diff shows collapsed unrelated lines or missing `?`, restore with `cp` from the backup immediately.

Use this setup before Task 1:

```bash
mkdir -p /tmp/phase3-backups/components /tmp/phase3-backups/app /tmp/phase3-backups/lib/i18n/messages
cp components/MessageView.tsx components/ChatWindow.tsx components/ChatInput.tsx components/AppShell.tsx components/BranchNavigator.tsx components/TurnWrittenFiles.tsx /tmp/phase3-backups/components/
cp app/globals.css /tmp/phase3-backups/app/
cp lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts /tmp/phase3-backups/lib/i18n/messages/
```

---

## Task 0: Capture Baseline

- [ ] Save ESLint baseline:

```bash
node_modules/.bin/eslint . --format json > /tmp/zosma-phase3-eslint-baseline.json || test $? -eq 1
```

- [ ] Assert exact known baseline:

```bash
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const got={};let warnings=0;for(const row of rows)for(const m of row.messages){if(m.severity===1)warnings++;if(m.severity!==2)continue;const f=path.relative(process.cwd(),row.filePath);got[f]??={};const r=m.ruleId??"unknown";got[f][r]=(got[f][r]??0)+1}assert.equal(warnings,0);assert.deepEqual(got,{"components/ChatInput.tsx":{"react-hooks/preserve-manual-memoization":6},"components/ChatMinimap.tsx":{"react-hooks/preserve-manual-memoization":5},"components/SessionSidebar.tsx":{"react-hooks/preserve-manual-memoization":2},"hooks/useAgentSession.ts":{"react-hooks/preserve-manual-memoization":2}});console.log("ESLint baseline: 15 known errors, 0 warnings")' /tmp/zosma-phase3-eslint-baseline.json
```

- [ ] Run focused baseline and stop on any mismatch:

```bash
node --test components/MessageView.test.mjs components/ChatWindow.process-details.test.mjs components/ChatInput.test.mjs components/BranchNavigator.test.mjs components/TurnWrittenFiles.test.mjs
node_modules/.bin/tsc --noEmit
```

---

## Task 1: Accessible Thinking and Tool Rows

**Files:** `MessageView.tsx`, `MessageView.test.mjs`, `lib/conversation-flow.ts`, `lib/conversation-flow.test.mjs`, both locale files, `globals.css`.

- [ ] In new CSS-free `lib/conversation-flow.ts`, export the helpers below. In `lib/conversation-flow.test.mjs`, Jiti-import only that lib module; do not import `MessageView.tsx` to test pure helpers. Keep rendered disclosure assertions in `MessageView.test.mjs`.

```ts
export type ToolCallState = "running" | "success" | "error" | "interrupted";
export function formatToolTitle(toolName: string): string;
export function getToolCallState(result: ToolResultMessage | undefined, active: boolean): ToolCallState;
export function firstUsefulLine(text: string): string;
```

Required assertions:

```js
assert.equal(formatToolTitle("bash"), "Run");
assert.equal(formatToolTitle("web_search"), "Search web");
assert.equal(formatToolTitle("session_ask"), "Session ask");
assert.equal(formatToolTitle("custom-tool"), "Custom tool");
assert.equal(getToolCallState(undefined, true), "running");
assert.equal(getToolCallState({ role: "toolResult", toolCallId: "1", content: [] }, false), "success");
assert.equal(getToolCallState({ role: "toolResult", toolCallId: "1", content: [], isError: true }, false), "error");
assert.equal(getToolCallState(undefined, false), "interrupted");
assert.equal(firstUsefulLine("\n  \nENOENT: missing file\nstack"), "ENOENT: missing file");
assert.equal(firstUsefulLine("  \n\t"), "");
```

Rendered tests must assert live thinking has `data-state="running"`, `aria-expanded="true"`, and non-color status text; completed thinking has `data-state="complete"` and `aria-expanded="false"`. Every tool disclosure button must expose `aria-expanded={expanded}`; rendered tool tests must assert both `aria-expanded="false"` initially and `data-state`/non-color text for running, success, error (using the first non-empty error line), and stored result-less interrupted states.

- [ ] Add locale keys to English and Chinese:

```ts
"chat.thinkingRunning"
"chat.thinkingComplete"
"chat.toolRunning"
"chat.toolSucceeded"
"chat.toolFailed"
"chat.toolInterrupted"
"chat.toolInput"
"chat.toolOutput"
```

English values: `Thinking in progress`, `Thinking complete`, `Running {name}`, `Completed {name}`, `Failed {name}`, `Interrupted {name}`, `IN`, `OUT`. Add equivalent Chinese values.

- [ ] Implement `TOOL_TITLES`, `formatToolTitle()`, `getToolCallState()`, and `firstUsefulLine(text: string): string` in CSS-free `lib/conversation-flow.ts`, importing `ToolResultMessage` with `import type`. `firstUsefulLine` must split on `/\r?\n/`, trim each line, return the first non-empty line, and return `""` when none exists. Import these helpers into `MessageView.tsx`; do not define/export them there. Keep unknown tool-name normalization as lowercase, hyphen/underscore-to-space, then uppercase first character.

- [ ] Replace the current map callback with `blockItems.map(({ block, originalIndex }, itemPosition) => (` and pass `isActive={Boolean(isStreaming && itemPosition === blockItems.length - 1)}`. In `BlockView`, declare optional prop `isActive?: boolean` but destructure with `isActive = false`, then pass `running={Boolean(isActive)}` and `active={Boolean(isActive)}`. In `ThinkingBlock` and `ToolCallBlock`, make `running: boolean` and `active: boolean` required props. This keeps every state helper/effect strictly boolean and prevents result-less stored blocks from becoming running.

- [ ] In `ThinkingBlock`, preserve deferred fetch, loading, and error logic. Before returned JSX, define:

```ts
const body = loading
  ? t("i18n.loadingThinking")
  : error
    ? error
    : block.deferred
      ? content ?? ""
      : block.thinking;
```

Initialize disclosure state from `running`, and synchronize it:

```ts
useEffect(() => setExpanded(Boolean(running)), [running]);
```

Render class `conversation-disclosure thinking-row`, `data-state`, a button with `aria-expanded`, visible title/summary/duration, screen-reader status, and `.thinking-detail`. Never reference `body` before this declaration.

- [ ] In `ToolCallBlock`, preserve result extraction, input generation, diff parsing, empty-output localization, and expansion behavior. Derive state with `getToolCallState(result, Boolean(active))`. Error preview uses `firstUsefulLine(resultText ?? "") || getToolPreview(block)`; active partial JSON uses the existing generating-input label; other states use existing preview. Render `.conversation-disclosure.tool-row`, `data-state`, screen-reader state text, and a disclosure `<button aria-expanded={expanded}>`. Rendered tests must assert that exact ARIA state. Keep bounded labeled input/output details.

- [ ] Replace presentation-only paired-result wrappers with `.tool-detail-*` classes. Keep `SplitPatchView` and all current diff behavior.

- [ ] Add light tokens `--state-error: #ec1313` and `--state-success: #22c55e`. Add dark declaration `--state-error: #f25a5a`; dark success stays `#22c55e`.

- [ ] Add disclosure CSS: 24px row, 14px title/summary, 12px duration, ellipsis summary, status dot, hover/focus chevron, 12px rounded bounded detail card, sticky IN/OUT labels, success/error/running colors, and a sweep pseudo-element only on running rows.

- [ ] Verify safe-edit integrity and focused behavior:

```bash
git diff --check
node --test components/MessageView.test.mjs lib/conversation-flow.test.mjs
node_modules/.bin/tsc --noEmit
```

- [ ] Commit only Task 1 files:

```bash
git add app/globals.css components/MessageView.tsx components/MessageView.test.mjs lib/conversation-flow.ts lib/conversation-flow.test.mjs lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git commit -m "feat: add DeepSeek-style conversation disclosures"
```

---

## Task 2: Open Conversation Flow and Preserve Minimap Anchors

**Files:** `ConversationFlow.test.mjs`, `MessageView.tsx`, `MessageView.test.mjs`, `ChatWindow.tsx`, `ChatWindow.process-details.test.mjs`, `lib/conversation-flow.ts`, `lib/conversation-flow.test.mjs`, `globals.css`.

- [ ] Create `ConversationFlow.test.mjs` as a source-contract test. It must assert presence of:

```text
user-message
user-message-bubble
assistant-message
assistant-message-blocks
markdown-assistant-message
compaction-marker
conversation-column
conversation-status
```

It must reject `function ProcessDetailsGroup` and `<ProcessDetailsGroup`, assert direct `visibleProcessIndices.forEach`, assert the CSS-free import of `shouldAttachFinalProcessRef` from `@/lib/conversation-flow`, and assert the final-process call receives `attachRef: attachFinalProcessRef`. Do not import `ChatWindow.tsx` in a runtime unit test or claim a source test observes `messageRefs.current`.

- [ ] Add rendered tests: user has `.user-message-bubble`; assistant uses `.markdown-assistant-message` and no assistant card; compaction starts collapsed and exposes summary text through an accessible disclosure.

- [ ] Convert user presentation only. Use `.user-message`, `.user-message-stack`, `.user-message-bubble`, `.message-actions.user-message-actions`, `.message-action`, and `.message-time`. Keep command/image/markdown branches and copy/edit/fork callbacks. Actions must appear on keyboard focus and stay visible on touch layouts.

- [ ] Convert assistant presentation only. Use `.assistant-message`, `.assistant-message-meta`, `.assistant-message-blocks`, `.assistant-error`, `.message-actions.assistant-message-actions`, `.assistant-usage`, and `.message-time`. Keep provider/TPS data, Task 1 block rendering, errors, `TurnWrittenFiles`, usage, copy, and timestamp.

- [ ] Convert compaction to `.compaction-marker` using the same disclosure trigger. Keep `parseCompactionSummary`, body markdown, read/modified file metadata, and time. Default to collapsed.

- [ ] Delete `countToolCalls`, `ProcessDetailsGroup`, and now-unused `countToolCallBlocks` import. Replace completed group rendering with direct rows:

```tsx
visibleProcessIndices.forEach((processIdx) => {
  rendered.push(renderMessage(processIdx, { keyPrefix: "process" }));
});
if (finalProcessMessage) {
  rendered.push(renderMessage(finalAssistantIdx, {
    attachRef: attachFinalProcessRef,
    keyPrefix: "process-final",
    messageOverride: finalProcessMessage,
    showTimestamp: false,
  }));
}
```

Before this block, compute `const attachFinalProcessRef = shouldAttachFinalProcessRef(Boolean(finalAnswerMessage));`. Direct stored process entries keep their own minimap refs; split final-process content owns the final assistant ref only when no final answer exists; otherwise only the final answer owns it.

- [ ] Extend existing CSS-free `lib/conversation-flow.ts` with `shouldAttachFinalProcessRef(hasFinalAnswer: boolean): boolean { return !hasFinalAnswer; }`. Import it into `ChatWindow.tsx`, compute the boolean result, and pass it to `attachRef`. Extend `lib/conversation-flow.test.mjs` with `true -> false` and `false -> true`. Keep source wiring assertions and manual minimap navigation. Never Jiti-import `ChatWindow.tsx`, whose transitive CSS module is unsupported.

- [ ] Add message CSS with these contracts: user max width `min(525px, 82%)`, max height `300px`, radius `22px`, 16/24; assistant 16/28 with no card; 16px block gap; actions keyboard-visible; compaction detail indented 22px; `.conversation-column` 16px vertical gap; `.conversation-status` low emphasis.

- [ ] Add `.conversation-column` to the exact `<div ref={messageContentRef}>` wrapper currently at `ChatWindow.tsx:841-849`; preserve its width, min-width, max-width, and margin. Add `.conversation-status` to agent and bash phase rows; remove their inline pulse utility and use `.conversation-status.is-running` for optional animation.

- [ ] Verify and commit:

```bash
git diff --check
node --test components/ConversationFlow.test.mjs components/MessageView.test.mjs components/ChatWindow.process-details.test.mjs lib/conversation-flow.test.mjs
node_modules/.bin/tsc --noEmit
git add app/globals.css components/ConversationFlow.test.mjs components/MessageView.tsx components/MessageView.test.mjs components/ChatWindow.tsx components/ChatWindow.process-details.test.mjs lib/conversation-flow.ts lib/conversation-flow.test.mjs
git commit -m "style: align Zosma conversation flow"
```

---

## Task 3: Low-Emphasis Branch and Written-File Reference Flow

**Files:** `BranchNavigator.tsx`, `BranchNavigator.test.mjs`, `AppShell.tsx`, `AppShell.mobile-toolbar.test.mjs`, `TurnWrittenFiles.tsx`, `TurnWrittenFiles.test.mjs`, `ConversationFlow.test.mjs`, `globals.css`.

This task satisfies roadmap branch-marker/reference scope without moving header controls or inventing citation data. The mobile branch trigger is owned by `components/AppShell.tsx`; the hidden mobile `BranchNavigator` supplies only the panel.

- [ ] Extend source/static-render tests to require `branch-flow`, `branch-flow-trigger`, `branch-flow-trigger-mobile`, `branch-flow-panel`, `branch-flow-tree`, `branch-flow-row`, `branch-flow-node`, `branch-flow-role`, `branch-flow-label`, `written-file-references`, and `written-file-reference`.

- [ ] Preserve every existing `compressChain()` and `selectTopLevelBranches()` test. Add source assertions for both ownership paths: desktop/inline trigger in `BranchNavigator.tsx`; mobile trigger in `AppShell.tsx` with `toggleTopPanel("branches", true)`, `aria-pressed`, and `data-mobile-toolbar-action="branches"`; hidden mobile `BranchNavigator` retains `hideInlineButton` and the shared panel.

- [ ] Keep the outer recursive node wrapper as `<div>`, but replace only its clickable row with `<button type="button" className="branch-flow-row">`. Inside that button, replace every connector/guide/dot `<div>` with phrasing-content `<span aria-hidden="true">` elements: `.branch-flow-guide`, `.branch-flow-connector`, and `.branch-flow-node`; draw vertical/horizontal connector lines with CSS pseudo-elements. Keep role, skipped count, and label as spans. No `<div>` may be nested inside the button. Preserve `onClick={() => onSelect(rep.entry.id)}`; native Enter/Space activation plus `:focus-visible` provide keyboard access. Static/source tests must assert button type, no `<div>` within the row block, and unchanged representative ID.

- [ ] Replace presentation-only inline styles with branch classes. Preserve `buildActivePath`, `compressChain`, `selectTopLevelBranches`, `hasBranch`, role/skip labels, callback IDs, inline/non-inline modes, controlled open behavior, `containerRef` positioning, `ResizeObserver`, empty reasons, and ARIA. Use `data-active` and `data-on-path` for non-color state.

- [ ] In `AppShell.tsx`, change only the current mobile branch button’s presentation to `className="branch-flow-trigger branch-flow-trigger-mobile"`; preserve `toggleTopPanel("branches", true)`, title, aria-label, aria-pressed, toolbar data attribute, icon, and current location. Do not touch other header actions.

- [ ] In `TurnWrittenFiles.tsx`, add `export function openWrittenFile(onOpenFile: ((filePath: string) => void) | undefined, filePath: string): void { onOpenFile?.(filePath); }`, use it from each button, and apply `.written-file-references`/`.written-file-reference`. Unit-test the helper with a spy receiving the exact full path; static render continues to assert filename, title, translated aria-label, and button count. This separates observable callback behavior from markup assertions.

- [ ] Add CSS: low-emphasis transparent triggers; subtle active/open surface plus accent marker; elevated bordered panel; minimum 28px rows; focus-visible background/ring; subtle tree connectors; non-color active weight; compact neutral written-file references. Include mobile trigger class without changing toolbar geometry.

- [ ] Verify and commit:

```bash
git diff --check
node --test components/BranchNavigator.test.mjs components/TurnWrittenFiles.test.mjs components/AppShell.mobile-toolbar.test.mjs components/ConversationFlow.test.mjs
node_modules/.bin/tsc --noEmit
git add app/globals.css components/BranchNavigator.tsx components/BranchNavigator.test.mjs components/AppShell.tsx components/AppShell.mobile-toolbar.test.mjs components/TurnWrittenFiles.tsx components/TurnWrittenFiles.test.mjs components/ConversationFlow.test.mjs
git commit -m "style: align branch and file reference flow"
```

---

## Task 4: One Rounded Composer Without Losing Controls

**Files:** `ChatInput.tsx`, `ChatInput.test.mjs`, `ChatWindow.tsx`, `ChatWindow.workspace-selector.test.mjs` (verify only), `lib/conversation-flow.ts`, `lib/conversation-flow.test.mjs`, `ConversationFlow.test.mjs`, `globals.css`.

Testing strategy is intentionally layered because this repo has no DOM interaction library: static rendering verifies accessible output, source contracts verify handler/menu wiring remains present, small exported pure adapters verify callback forwarding with spies, and the final manual gate covers browser interactions. Do not claim static markup proves clicks, keyboard events, refs, or DOM focus.

- [ ] Add static render tests for idle and streaming states. Idle requires `.composer-shell`, `.composer-card`, `.composer-input-row`, `.composer-textarea`, `.composer-toolbar`, and one `.composer-send` with translated aria-label. Streaming requires one `.composer-stop`, no send, and steer/follow-up controls when callbacks exist.

- [ ] Extend source contracts for exact handler bindings: textarea retains current `onChange`, `onSelect` (updates `@` query), `onKeyDown`, `onCompositionStart`, `onCompositionEnd`, `onInput={handleInput}` (auto-height), and `onPaste={handlePaste}`. Do not require nonexistent focus/blur handlers. Send retains `onClick={handleSend}`; stop retains `onClick={onAbort}`; steer/follow-up retain `sendQueued("steer")`/`sendQueued("followup")`; compact retains `isCompacting ? onAbortCompaction : onCompact`; attachment trigger retains `fileInputRef.current?.click()`; selectors and sound retain current refs, setters, callbacks, titles, ARIA, and disabled expressions. Source contracts verify wiring only.

- [ ] Map each current surface explicitly:

| Current feature/owner | New containment/class | Preservation proof |
|---|---|---|
| model errors/scope warnings / `ChatInput` | before `.composer-card` | static/source existing components and props |
| queued steering/follow-up / `ChatInput` | `.composer-notice.composer-queue` before card | static rows; source recall callback |
| retry / `ChatInput` | `.composer-notice.is-retry[role=status]` before card | static attempt/max/error text |
| compact success/error / `ChatInput` | success `role=status`, error `role=alert` before card | existing render assertions |
| image previews / `ChatInput` | `.composer-attachments` before card | static image/remove controls; source callback |
| history/slash/`@` menus / `ChatInput` | `.composer-overlay` variants inside card | source refs, keyboard branches, item callbacks |
| textarea / `ChatInput` | `.composer-input-row .composer-textarea` | source handler contract |
| attach/file input / `ChatInput` | semantic control plus `.sr-only` input | static `accept`/`multiple`; source click/change/reset |
| model/thinking/tool selectors / `ChatInput` | semantic control classes | static selected labels; source callbacks/refs |
| compact/sound/mobile-more / `ChatInput` | semantic control classes | static ARIA; source callback/disabled wiring |
| bash mode/status / `ChatInput` | `.composer-mode-status` inside card | static/source current state branch |
| send/stop/steer/follow-up / `ChatInput` | primary/action classes | static counts; source callback wiring |
| new-session workspace selector / `ChatWindow` | immediately before `chatInputElement`, outside `.composer-card` | existing `ChatWindow.workspace-selector.test.mjs` source-contract assertions |
| outer image drag/drop / `ChatWindow` | existing root `<div>` outside composer | adapter spy plus source root bindings |

- [ ] Preserve the empty-session `NewSessionWorkspaceSelector` immediately before `{chatInputElement}` in `ChatWindow.tsx`. Keep the guard and every current prop/callback. Do not move it into `ChatInput` or `.composer-card`. Run existing `ChatWindow.workspace-selector.test.mjs` as source-wiring proof; verify actual selection and add-folder interactions manually.

- [ ] Add to CSS-free `lib/conversation-flow.ts` a structural `ImageDropTarget` type with `addImages(files: File[]): void` and `forwardDroppedImages(input: ImageDropTarget | null | undefined, files: File[]): void { input?.addImages(files); }`. Import the helper into `ChatWindow.tsx` and call `forwardDroppedImages(chatInputRef?.current, files)` inside existing `onDrop`. Extend `lib/conversation-flow.test.mjs` with a fake target recording the exact file array. Source-assert the ChatWindow root still binds all four drag handlers. Do not Jiti-import `ChatWindow.tsx` and do not move drag/drop to textarea/ChatInput.

- [ ] Add regressions beyond class names: retry `role=status`; compact error `role=alert`; read-only tool preset selected; sound label reflects state; file input remains image/multiple; model/thinking/tool/compact controls render; idle has one send/no stop; streaming has one stop/no send. These are output assertions, not interaction claims.

- [ ] Replace only outer containment/presentation. Use `.composer-shell`/`.composer-width`; notices and attachments stay before `.composer-card`; overlays, `.composer-input-row`, mode status, and `.composer-toolbar` sit inside it. Do not reorder hooks, state, callbacks, or menu logic.

- [ ] Replace textarea style only; preserve every prop. Idle primary action calls `handleSend`; streaming primary action calls `onAbort`. Delete the later duplicate stop only after primary stop exists and tests count exactly one.

- [ ] Replace trigger styles with classes while preserving refs, menus, ARIA, titles, disabled states, and handlers. No control may disappear merely because it moves into mobile overflow.

- [ ] Add `const COMPOSER_TEXTAREA_MAX_HEIGHT = 336` near existing ChatInput constants. Replace every current `Math.min(ta.scrollHeight, 200)` occurrence (all imperative restore/insert/send/value/input paths) with that constant, and replace inline `maxHeight: 200` with `maxHeight: COMPOSER_TEXTAREA_MAX_HEIGHT`. Add a source test asserting no `scrollHeight, 200` or `maxHeight: 200` remains. Composer CSS must use the same 336px max alongside unchanged max width, 22px radius, elevated surface, focus ring, 52px minimum, 16/24 type, 34px send/stop, flexible toolbar, compact controls, and wrapping notices.

- [ ] At max-width 640px: right padding 16px, safe-area bottom, radius 18px, textarea max `min(240px, 36dvh)` and 16px font, toolbar grid, full-width model trigger, visible message actions, 92% user bubble, zero tool-detail left margin.

- [ ] Reduced motion must disable disclosure sweep, `.conversation-status.is-running`, any surviving escaped `.animate-\[pulse_1\.5s_infinite\]`, and transitions on composer/actions/disclosures/branch nodes. Remove the two current pulse utilities from `ChatWindow.tsx`; keep the escaped selector defensively.

- [ ] Verify focused behavior and unchanged lint fingerprints:

```bash
git diff --check
node --test components/ChatInput.test.mjs components/ChatWindow.workspace-selector.test.mjs components/ConversationFlow.test.mjs components/MessageView.test.mjs components/ChatWindow.process-details.test.mjs components/BranchNavigator.test.mjs components/TurnWrittenFiles.test.mjs components/AppShell.mobile-toolbar.test.mjs components/MobilePwaLayout.test.mjs lib/conversation-flow.test.mjs
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint . --format json > /tmp/zosma-phase3-eslint-task4.json || test $? -eq 1
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const normalize=v=>v.replace(/\r\n/g,"\n").replace(/\b(?:line|column)\s+\d+\b/gi,m=>m.replace(/\d+/,"#")).replace(/\s+/g," ").trim();const fp=f=>{const c=new Map();for(const r of JSON.parse(fs.readFileSync(f,"utf8")))for(const m of r.messages.filter(x=>x.severity>0)){const k=JSON.stringify([path.relative(process.cwd(),r.filePath),m.ruleId??"unknown",normalize(m.message)]);c.set(k,(c.get(k)??0)+1)}return [...c].sort(([a],[b])=>a.localeCompare(b))};assert.deepEqual(fp(process.argv[2]),fp(process.argv[1]));console.log("ESLint fingerprints unchanged")' /tmp/zosma-phase3-eslint-baseline.json /tmp/zosma-phase3-eslint-task4.json
```

- [ ] Commit:

```bash
git add app/globals.css components/ChatInput.tsx components/ChatInput.test.mjs components/ChatWindow.tsx components/ConversationFlow.test.mjs lib/conversation-flow.ts lib/conversation-flow.test.mjs
git commit -m "style: reshape Zosma composer"
```

---

## Task 5: Complete Gate and Manual Comparison

- [ ] Run full automated gate:

```bash
node_modules/.bin/tsc --noEmit
npm test
node_modules/.bin/eslint . --format json > /tmp/zosma-phase3-eslint-final.json || test $? -eq 1
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const normalize=v=>v.replace(/\r\n/g,"\n").replace(/\b(?:line|column)\s+\d+\b/gi,m=>m.replace(/\d+/,"#")).replace(/\s+/g," ").trim();const fp=f=>{const c=new Map();for(const r of JSON.parse(fs.readFileSync(f,"utf8")))for(const m of r.messages.filter(x=>x.severity>0)){const k=JSON.stringify([path.relative(process.cwd(),r.filePath),m.ruleId??"unknown",normalize(m.message)]);c.set(k,(c.get(k)??0)+1)}return [...c].sort(([a],[b])=>a.localeCompare(b))};assert.deepEqual(fp(process.argv[2]),fp(process.argv[1]));console.log("ESLint fingerprints unchanged")' /tmp/zosma-phase3-eslint-baseline.json /tmp/zosma-phase3-eslint-final.json
git diff --check HEAD~4..HEAD
git status --short
```

Expected: TypeScript and all tests pass, lint fingerprints match baseline, and no tracked changes remain. Do not run `next build`.

- [ ] Run `npm run dev` and compare against pinned DeepSeek in light, dark, desktop, narrow desktop, and 390×844 mobile.

Manual checklist:

1. User bubble cap, radius, typography, and internal overflow.
2. Assistant open canvas and markdown rhythm.
3. Live/completed/deferred thinking behavior.
4. Direct process rows and correct minimap navigation for process-only turns.
5. Tool summaries and all four status states.
6. Bounded tool input/output/diff with no page overflow.
7. Collapsed compaction with summary and file metadata.
8. Retry as low-emphasis status, not a square card.
9. Branch tree remains selectable and visually aligns with flow markers.
10. Written-file references still open files.
11. Copy/edit/fork remain mouse, keyboard, and touch reachable.
12. Every composer item in the containment table remains reachable and functional.
13. History, slash, `@`, attachment, drag/drop, paste, model, thinking, tools, compact, sound, queue, steer/follow-up, send, stop, and Escape work.
14. Reduced motion removes sweep, phase pulse, and transitions without hiding state.
15. Streaming reconnect, retry, compaction, draft restore, branch edit/fork, and completion sound remain functional.

- [ ] Stop at Phase 3. Do not tune header placement, arbitrary tool-path links, settings, or metrics.
