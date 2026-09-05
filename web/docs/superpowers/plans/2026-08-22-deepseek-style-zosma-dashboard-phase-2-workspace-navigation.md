# DeepSeek-Style Zosma Dashboard Phase 2 Implementation Plan

> **For agentic workers:** Use `/skill:executing-plans`. Execute one task at a time, run every stated gate, and commit only the listed files.

**Goal:** Replace the sidebar project dropdown with a searchable workspace browser while preserving current session, worktree, cwd, path-security, mobile, and Phase 1 shell behavior.

**Approved sources:**

- Design: `docs/superpowers/specs/2026-08-22-deepseek-style-zosma-dashboard-design.md`
- Roadmap Phase 2: `docs/superpowers/roadmaps/2026-08-22-deepseek-style-zosma-dashboard-roadmap.md#phase-2-deepseek-style-workspace-navigation`
- Visual reference only: sibling `../deepseek-harness` at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

**Current implementation baseline:** commit `1171c91` plus this revised plan commit. Before implementation, `node_modules/.bin/tsc --noEmit` passes, `npm test` passes 594 tests, and ESLint reports exactly 15 errors and zero warnings.

---

## Phase Boundary

Phase 2 includes only:

- Searchable workspace rows backed by existing session-derived project grouping.
- Expand/collapse with nested session rows.
- Sidebar workspace switching with remembered-session restoration.
- Add Folder and default-folder selection through `/api/cwd/validate`.
- One transient validated folder until its first session is created.
- Empty-composer workspace selection without remembered-session restoration.
- Relocation of the existing worktree switcher into the selected expanded workspace.
- Keyboard, focus, mobile-drawer, and empty-result behavior for these surfaces.

Do not change:

- Conversation/message/tool/thinking/composer internals (`ChatInput.tsx` remains untouched).
- Header consolidation, file/session-details redesign, settings, or metrics.
- Runtime/session persistence, API contracts, or backend routes.
- `lib/worktree.ts`, `lib/paths.ts`, `lib/path-security.ts`, `lib/file-access.ts`, `lib/workspace-memory.ts`, or `lib/project-groups.ts`.
- Phase 1 geometry: `--shell-content-max-width: 748px`, `--shell-composer-max-width: 780px`, header height, sidebar 280/264/420 widths, `.right-panel-container { display:flex; flex-direction:column; }`, or shell classes.
- `package.json`, dependencies, or `pnpm-lock.yaml`.

Never run `next build`. Never push implementation commits unless explicitly requested after implementation review.

---

## Current-Code Anchors at `1171c91`

Use function/marker names after edits shift line numbers.

- `components/AppShell.tsx:492-554`: `handleCwdChange`, the sidebar-switch path that restores remembered sessions only on cross-project switches.
- `components/AppShell.tsx:556-606`: `handleSelectSession` and `handleNewSession`.
- `components/AppShell.tsx:634-643`: `handleSessionCreated`.
- `components/AppShell.tsx:766-789`: delete-current-session transition.
- `components/AppShell.tsx:836-844`: `effectiveNewSessionCwd` and draft key.
- `components/AppShell.tsx:908-929`: `SessionSidebar` mount. Current `selectedCwd` omits `activeCwd`; this plan fixes that.
- `components/AppShell.tsx:2046-2069`: `ChatWindow` mount.
- `components/SessionSidebar.tsx:555-604`: `projectFor`, cwd notification, and prop-to-local cwd sync.
- `components/SessionSidebar.tsx:607-642`: server-resolved worktree loading.
- `components/SessionSidebar.tsx:678-730`: current custom-path/default-folder flow to move to `AppShell`.
- `components/SessionSidebar.tsx:732-803`: worktree create/remove handlers; preserve their behavior.
- `components/SessionSidebar.tsx:824-841`: session selection and scoped new-session callback.
- `components/SessionSidebar.tsx:843-902`: current grouping/activity/worktree derivations.
- `components/SessionSidebar.tsx:1008-1564`: current project dropdown and worktree JSX.
- `components/SessionSidebar.tsx:1567-1601`: current selected-project session list.
- `components/SessionSidebar.tsx:1723-1791`: recursive fork/session hierarchy.
- `components/SessionSidebar.tsx:1901-end`: `SessionItem` rename/delete/context-menu/indicator behavior.
- `components/ChatWindow.tsx:425-427`: empty-new-session detection.
- `components/ChatWindow.tsx:535-577`: shared `ChatInput` element.
- `components/ChatWindow.tsx:666-696`: empty composer shell and Phase 1 780px width.
- `app/api/cwd/validate/route.ts:20-45`: validates directory, calls `allowFileRoot`, and returns `{cwd, projectRoot, projectKey}`.
- `app/api/cwd/browse/route.ts:1-49`: browse endpoint. It does not authorize roots; authorization occurs on selection through `/api/cwd/validate`.

---

## Non-Negotiable Behavior Decisions

### 1. Three workspace-selection intents

Do not route all workspace controls through one ambiguous callback.

- **Sidebar workspace row:** switch workspace and restore its remembered session through existing `handleCwdChange` → `restoreWorkspaceContext` behavior.
- **Empty-composer selector:** keep a fresh composer, change only its cwd/project identity, and do not restore a remembered session.
- **Add Folder/default folder:** this is also an explicit new-session action. Validate the folder, open a fresh composer there, and do not restore a remembered session—even if a session was open when Add Folder was invoked.

This distinction matches design lines 83–95: sidebar switching restores workspace context; the new-session selector changes cwd for a new session.

### 2. One effective cwd propagated to the sidebar

`AppShell` remains coordinator. Pass this value to `SessionSidebar`:

```tsx
selectedCwd={selectedSession?.cwd ?? effectiveNewSessionCwd ?? null}
```

Never pass only `selectedSession?.cwd ?? newSessionCwd`; that loses the `activeCwd` fallback after a shell-owned transition.

### 3. Transient folder lifecycle

`validatedProject` means “the one server-validated folder that has not yet produced its first session.”

- Set it only after successful `/api/cwd/validate`.
- Set it during initial `?cwd=` validation too, using the route’s returned identity.
- Keep exact selected `cwd` separately from display/grouping `root` and stable `key`.
- Clear it when `handleSessionCreated` reports a session with the same cwd.
- Do not persist it.
- Once cleared, deleting the last session must not resurrect a phantom row.

### 4. Exact cwd versus workspace identity

Every workspace row carries:

```ts
{ key: string; root: string; cwd: string }
```

- `key`: comparison, grouping, selected identity.
- `root`: display and canonical project root.
- `cwd`: exact cwd to use if the row starts a fresh composer.

For session-derived rows, `cwd = root`. For a transient linked worktree or other validated folder, `cwd = validatedProject.cwd` even when `root` differs.

Clicking an already-selected workspace must never rewrite cwd; it only changes expansion. Composer “current” state compares `key`, not raw path strings.

### 5. Search retains context and hierarchy

With a nonblank query:

- Workspace-root matches show all sessions.
- Session-title matches include each match and all available ancestors so fork hierarchy remains intact.
- Selected, running, and unread sessions remain visible with their ancestors even when they do not match.
- Selected workspaces with an empty composer remain visible.
- Running/unread badges always use the unfiltered session set.
- Workspaces with query matches are effectively expanded while searching, without mutating remembered in-memory expansion.
- Session ancestors are force-expanded while searching.
- If there are zero actual query matches, retain context rows and render an actionable “No matching…” row with a Clear Search button.

### 6. Native accessibility semantics, not a partial ARIA tree

Do not add `role="tree"` or `role="treeitem"` in this phase.

- Workspace wrapper is a normal list/region.
- Workspace select action is a real `<button>` with `aria-current`.
- Workspace disclosure is a separate real `<button>` with `aria-expanded`, `aria-controls`, and a label.
- Session select action is a real `<button>` occupying the row’s main content area.
- Fork disclosure, rename, and delete remain separate sibling buttons; never nest a button inside another button.
- Native Enter/Space behavior is sufficient. No fake tree means no incomplete ArrowUp/ArrowDown/Home/End implementation.
- Folder/composer popovers use native buttons in a normal labelled container, not `role="menu"`/`menuitem` unless full menu keyboard behavior is implemented.
- Escape closes each popover and returns focus to its trigger; outside click closes it.

### 7. Expansion is intentionally memory-only

Keep workspace expansion in component state. Do not add localStorage. Search computes effective expansion and does not overwrite the user’s stored in-memory expansion set. Mobile drawer close/open does not reset it.

---

## Planned Files

Create:

- `lib/workspace-browser.ts`
- `lib/workspace-browser.test.mjs`
- `components/AppShell.folder-validation.test.mjs`
- `components/SessionSidebar.workspace.test.mjs`
- `components/ChatWindow.workspace-selector.test.mjs`

Modify:

- `components/AppShell.tsx`
- `components/AppShell.workspace-memory.test.mjs`
- `components/SessionSidebar.tsx`
- `components/SessionSidebar.test.mjs`
- `components/SessionSidebar.project-identity.test.mjs`
- `components/ChatWindow.tsx`
- `app/globals.css`
- `lib/i18n/messages/en.ts`
- `lib/i18n/messages/zh-CN.ts`

No other files should change.

---

## ESLint Gate Contract

Every lint gate must:

1. Require raw ESLint exit code `1`.
2. Require exactly 15 severity-2 diagnostics and zero severity-1 diagnostics.
3. Compare a sorted multiset fingerprint of repository-relative path, `ruleId`, normalized semantic message, and occurrence count.
4. Ignore line, column, endLine, endColumn, `source`, and React Compiler source excerpts.
5. Reject every changed/new warning, error, rule, file, semantic message, or occurrence count.
6. Never re-baseline during Phase 2.

The only tolerated diagnostics are:

```text
components/ChatInput.tsx      react-hooks/preserve-manual-memoization  ×6
components/ChatMinimap.tsx    react-hooks/preserve-manual-memoization  ×5
components/SessionSidebar.tsx react-hooks/preserve-manual-memoization  ×2
hooks/useAgentSession.ts      react-hooks/preserve-manual-memoization  ×2
```

Use Appendix A for every lint comparison.

---

# Task 0: Verify Baseline and Hygiene

No source changes.

1. Run:

```bash
git status --short
git log --oneline -2
node_modules/.bin/tsc --noEmit
npm test
```

Expected before editing:

```text
?? docs/superpowers/plans/2026-08-22-deepseek-style-zosma-dashboard-phase-1-visual-foundation-branding-app-shell.md
?? pnpm-lock.yaml
```

The Phase 2 plan is tracked. Do not stage or modify either untracked file.

2. Capture baseline:

```bash
node_modules/.bin/eslint . --format json > /tmp/zosma-phase2-eslint-baseline.json; test $? -eq 1
```

3. Run Appendix A with baseline as both arguments. Expected:

```text
ESLint fingerprint unchanged: 15 documented errors, 0 warnings
```

Stop if TypeScript, tests, or fingerprint fail.

---

# Task 1: Pure Workspace Browser Logic (TDD)

Files:

- Create `lib/workspace-browser.ts`
- Create `lib/workspace-browser.test.mjs`

## Step 1: Write failing tests

Use `jiti` like existing pure TypeScript tests. Cover all of these cases:

1. Blank query returns all workspaces and sessions without mutation.
2. Workspace-root match returns all sessions.
3. Stored session name wins over collapsed first message; first message wins over id.
4. A child-session match includes its available parent chain in original hierarchy order.
5. Selected, running, and unread sessions plus ancestors remain as context-only results.
6. Selected empty workspace remains context-only.
7. `hasQueryMatch` is false when only context remains, enabling actionable empty treatment.
8. Transient row carries exact `cwd` and disappears when a recent project has the same key.
9. `consumeValidatedCwd` clears only when the created session cwd matches.
10. `workspaceActivationCwd` preserves current exact cwd for the already-selected key and returns row cwd for another key.
11. Inputs are not mutated.

Run:

```bash
node --test lib/workspace-browser.test.mjs
```

Expected: FAIL because module does not exist.

## Step 2: Implement the module

Export these types/functions—no React and no browser globals:

```ts
import { skillExpansionToCommand } from "./slash-display";
import type { SessionInfo } from "./types";

export interface ValidatedCwd {
  cwd: string;
  root: string;
  key: string;
}

export interface WorkspaceBrowserInput {
  key: string;
  root: string;
  cwd: string;
  sessions: SessionInfo[];
}

export interface WorkspaceBrowserRow extends WorkspaceBrowserInput {
  hasQueryMatch: boolean;
  contextOnly: boolean;
}

export interface WorkspaceSearchContext {
  selectedWorkspaceKey?: string | null;
  selectedSessionId?: string | null;
  runningSessionIds?: ReadonlySet<string>;
  unreadSessionIds?: ReadonlySet<string>;
}

export function sessionSearchTitle(session: SessionInfo): string {
  const first = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  return session.name || first.slice(0, 50) || session.id.slice(0, 12);
}

export function transientWorkspace(
  validated: ValidatedCwd | null,
  recent: readonly { key: string }[],
): Omit<WorkspaceBrowserInput, "sessions"> | null {
  if (!validated || recent.some((project) => project.key === validated.key)) return null;
  return { key: validated.key, root: validated.root, cwd: validated.cwd };
}

export function consumeValidatedCwd(
  validated: ValidatedCwd | null,
  createdSessionCwd: string,
): ValidatedCwd | null {
  return validated?.cwd === createdSessionCwd ? null : validated;
}

export function workspaceActivationCwd(
  row: Pick<WorkspaceBrowserInput, "key" | "cwd">,
  selectedWorkspaceKey: string | null,
  currentCwd: string | null,
): string {
  return row.key === selectedWorkspaceKey && currentCwd ? currentCwd : row.cwd;
}
```

Implement this export:

```ts
export function searchWorkspaces(
 workspaces: readonly WorkspaceBrowserInput[],
 query: string,
 context: WorkspaceSearchContext = {},
): WorkspaceBrowserRow[]
```

Rules:

- A blank query returns every workspace with all sessions, `hasQueryMatch: true`, and `contextOnly: false`.

- Build an id map for each workspace.
- Add direct title matches.
- Add selected/running/unread ids in that workspace.
- For every included id, walk `parentSessionId` through the workspace id map with a cycle guard and include ancestors.
- Preserve input session order when returning the included set.
- `hasQueryMatch` means root or title matched—not context-only inclusion.
- `contextOnly` means the workspace had no root/title match.
- Keep `selectedWorkspaceKey` even when it has no sessions; this preserves an empty composer's selected workspace.
- Omit a workspace only when it has no query match and no selected/running/unread context.

## Step 3: Pass gates and commit

```bash
node --test lib/workspace-browser.test.mjs
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint . --format json > /tmp/zosma-phase2-eslint-task1.json; test $? -eq 1
# Run Appendix A: baseline, then task1.
git add lib/workspace-browser.ts lib/workspace-browser.test.mjs
git diff --cached --name-only
git commit -m "feat: add workspace browser logic"
```

Expected staged files: exactly the two listed files.

---

# Task 2: Strings and Shared Focus Styling

Files:

- Modify `lib/i18n/messages/en.ts`
- Modify `lib/i18n/messages/zh-CN.ts`
- Modify `app/globals.css`

Add English and Simplified Chinese keys for:

```text
sidebar.workspaces
sidebar.searchWorkspaces
sidebar.clearSearch
sidebar.addFolder
sidebar.noWorkspaceMatches
sidebar.noWorkspaces
sidebar.noWorkspacesHint
sidebar.workspaceEmpty
sidebar.newSessionCta
sidebar.selectWorkspace
sidebar.expandWorkspace
sidebar.collapseWorkspace
composer.selectWorkspace
```

Use these English values:

```text
Workspaces
Search workspaces and sessions…
Clear search
Add folder…
No matching workspaces or sessions
No workspaces yet
Add a folder to start a new session.
No sessions in this workspace yet
New session
Select workspace
Expand workspace
Collapse workspace
Workspace for the new session
```

No new tree-role CSS is needed. Existing global button focus styling already covers native controls. Add only a small `.workspace-row`/`.session-row-main` focus layout rule if the inline outline is clipped; do not alter shell tokens or global geometry.

Run:

```bash
node_modules/.bin/tsc --noEmit
node --test lib/i18n/format.test.mjs lib/i18n/registry.test.mjs components/ZosmaShell.test.mjs
node_modules/.bin/eslint . --format json > /tmp/zosma-phase2-eslint-task2.json; test $? -eq 1
# Run Appendix A.
git add app/globals.css lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts
git diff --cached --name-only
git commit -m "feat: add workspace navigation copy"
```

---

# Task 3: Canonical Shell Folder and Composer Selection Flow (TDD)

Files:

- Create `components/AppShell.folder-validation.test.mjs`
- Modify `components/AppShell.tsx`
- Modify `components/AppShell.workspace-memory.test.mjs`
- Modify `components/SessionSidebar.tsx` only to declare additive props/types needed for this commit to typecheck

## Step 1: Write failing contracts

`AppShell.folder-validation.test.mjs` must assert source contracts for all of these, using bounded callback extraction as existing tests do:

1. Initial `?cwd=` validation reads `cwd`, `projectRoot`, and `projectKey`, then installs `validatedProject` before selecting the cwd.
2. `commitAddFolder` posts to `/api/cwd/validate`, installs identity, and always dispatches to `handleComposerCwdChange`; it never calls `handleCwdChange`.
3. `handleComposerCwdChange` invalidates pending restore, sets active cwd/key, clears selected session, creates a new draft id, sets `newSessionCwd`, resets branch/system-panel state, closes cross-project file tabs, updates URL, and never calls `restoreWorkspaceContext`.
4. Sidebar receives `selectedSession?.cwd ?? effectiveNewSessionCwd ?? null`.
5. `handleSessionCreated` calls `consumeValidatedCwd` so the transient cannot return after deletion.
6. Shell owns one `DirectoryPicker` instance and passes Add Folder callbacks/identity to sidebar.
7. Composer and Add Folder use the same non-restoring callback; sidebar workspace selection remains wired to `handleCwdChange`.

Update `AppShell.workspace-memory.test.mjs` callback boundaries without weakening its existing restore invalidation and persistence assertions.

Run focused tests. Expected: FAIL on missing callbacks/state.

## Step 2: Implement shell state

Import:

```tsx
import { DirectoryPicker } from "./DirectoryPicker";
import {
  consumeValidatedCwd,
  type ValidatedCwd,
} from "@/lib/workspace-browser";
```

Add:

```tsx
const [validatedProject, setValidatedProject] = useState<ValidatedCwd | null>(null);
const [addFolderOpen, setAddFolderOpen] = useState(false);
const [addFolderBusy, setAddFolderBusy] = useState(false);
const [addFolderError, setAddFolderError] = useState<string | null>(null);
```

Extend initial cwd response typing to include project identity. After a successful response, set:

```tsx
setValidatedProject({
  cwd: data.cwd,
  root: data.projectRoot,
  key: data.projectKey,
});
```

Require all three values. Keep existing abort/error behavior.

## Step 3: Add the non-restoring coordinator

Place `handleComposerCwdChange` after `handleNewSession` and before `useGlobalKeyboardShortcuts`:

```tsx
const handleComposerCwdChange = useCallback((
  cwd: string,
  projectRoot?: string | null,
  projectKey?: string | null,
) => {
  invalidateWorkspaceRestore();
  const newProject = projectKey ?? projectRoot ?? cwd;
  const currentProject = activeProjectKeyRef.current
    ?? (selectedSession ? workspaceKeyOf(selectedSession) : null);

  activeProjectKeyRef.current = newProject;
  setActiveCwd(cwd);

  const draftId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  setNewSessionDraftId(draftId);
  activeNewSessionDraftKeyRef.current = `new:${draftId}:${cwd}`;
  setSelectedSession(null);
  setNewSessionCwd(cwd);
  setSessionKey((key) => key + 1);
  setBranchTree([]);
  setBranchActiveLeafId(null);
  setSystemPrompt(null);
  setSystemPromptLoading(false);
  setActiveTopPanel(null);

  if (currentProject !== newProject) {
    setFileTabs([]);
    setActiveFileTabId(null);
    setRightPanelOpen(false);
  }
  if (isMobile) setSidebarOpen(false);
  router.replace("/", { scroll: false });
}, [invalidateWorkspaceRestore, isMobile, router, selectedSession]);
```

## Step 4: Add folder commit

`commitAddFolder(path)` must:

1. Set busy and clear error.
2. POST `{cwd:path}` to `/api/cwd/validate`.
3. Require `cwd`, `projectRoot`, and `projectKey`.
4. Set `validatedProject` before dispatch.
5. Close picker.
6. Call only:

```tsx
handleComposerCwdChange(data.cwd, data.projectRoot, data.projectKey);
```

7. Preserve actionable validation error in the picker.

`openAddFolder` clears old error and opens the picker.

Mount `DirectoryPicker` once in `sidebarContent`, before `SessionSidebar`.

## Step 5: Consume transient and propagate effective cwd

In `handleSessionCreated`, before selecting/hydrating the session:

```tsx
setValidatedProject((current) => consumeValidatedCwd(current, session.cwd));
```

Change sidebar prop:

```tsx
selectedCwd={selectedSession?.cwd ?? effectiveNewSessionCwd ?? null}
```

Add sidebar props:

```tsx
onAddFolder?: () => void;
onSelectFolder?: (path: string) => void;
validatedProject?: ValidatedCwd | null;
```

Default-directory selection in Task 4 will call `onSelectFolder`, so it receives the same validation and fresh-composer behavior.

## Step 6: Gates and commit

```bash
node --test components/AppShell.folder-validation.test.mjs components/AppShell.workspace-memory.test.mjs lib/workspace-browser.test.mjs
node_modules/.bin/tsc --noEmit
npm test
node_modules/.bin/eslint . --format json > /tmp/zosma-phase2-eslint-task3.json; test $? -eq 1
# Run Appendix A.
git add components/AppShell.tsx components/AppShell.folder-validation.test.mjs components/AppShell.workspace-memory.test.mjs components/SessionSidebar.tsx
git diff --cached --name-only
git commit -m "feat: centralize new-workspace selection"
```

---

# Task 4: Sidebar Workspace Browser (TDD)

Files:

- Create `components/SessionSidebar.workspace.test.mjs`
- Modify `components/SessionSidebar.tsx`
- Modify `components/SessionSidebar.test.mjs`
- Replace `components/SessionSidebar.project-identity.test.mjs`

## Step 1: Write target contracts first

Source-contract tests supplement—not replace—the pure behavior tests from Task 1.

Assert:

- No `/api/cwd/validate`, `commitCustomPath`, or sidebar-owned `validatedProject` state remains.
- Sidebar uses shell-provided `ValidatedCwd` before session/worktree fallback in `projectFor`.
- Workspace region has an accessible label but no `role="tree"`/`treeitem`.
- Workspace selection and disclosure are separate native buttons; disclosure has `aria-expanded` and `aria-controls`.
- Session main action is a native button; no button is nested inside it.
- Search calls `searchWorkspaces` with selected/running/unread context.
- Query matches use effective expansion without writing `expandedWorkspaceKeys`.
- Search passes `forceExpanded` into recursive session rows.
- Empty search result includes a clear-search button.
- Workspace activity derives from unfiltered `allSessions`.
- Transient row uses exact `validatedProject.cwd`.
- Selecting the already-selected workspace does not call `setSelectedCwd`.
- Worktree switcher is rendered only inside the selected expanded workspace.
- Existing rename/delete/context-menu/transient-session guards remain.

Update the old negative keyboard test in `SessionSidebar.test.mjs` to require the native session select button. Keep every other test intact.

Run focused tests. Expected: FAIL.

## Step 2: Remove superseded sidebar ownership

Delete:

- `DirectoryPicker` import and portal mount.
- project dropdown state/ref/filter.
- custom path state and internal validated state.
- `commitCustomPath`, `handleCustomPathClick`, `handleDefaultCwd`.
- old project dropdown JSX.
- `hasOtherWorkspaceActivity`.
- selected-project-only `filteredSessions`/`sessionTree` derivation.

Keep:

- `selectedCwd` local state and prop sync.
- `projectFor` with shell-provided validated identity first.
- running/unread polling and callbacks.
- worktree state and handlers.
- FileExplorer state.
- session actions and hierarchy logic.

Add:

```tsx
const [workspaceQuery, setWorkspaceQuery] = useState("");
const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
const [expandedWorkspaceKeys, setExpandedWorkspaceKeys] = useState<Set<string>>(() => new Set());
```

## Step 3: Build workspace data with stable identity

Use:

```tsx
const recentProjects = getRecentProjects(allSessions);
const pending = transientWorkspace(validatedProject ?? null, recentProjects);
const workspaceInputs = [
  ...recentProjects.map((project) => ({
    key: project.key,
    root: project.root,
    cwd: project.root,
    sessions: sessionsForProject(allSessions, project.key),
  })),
  ...(pending ? [{ ...pending, sessions: [] }] : []),
];

const selectedProject = projectFor(selectedCwd);
const visibleWorkspaces = searchWorkspaces(workspaceInputs, workspaceQuery, {
  selectedWorkspaceKey: selectedProject?.key,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
});
const hasQueryMatches = visibleWorkspaces.some((row) => row.hasQueryMatch);
```

Activity badges stay:

```tsx
useMemo(
  () => getProjectActivity(allSessions, runningSessionIds, unreadSessionIds),
  [allSessions, runningSessionIds, unreadSessionIds],
)
```

## Step 4: Implement expansion without persistence

- Auto-add a newly selected project key to `expandedWorkspaceKeys`.
- Disclosure button toggles only expansion.
- Main workspace button:
  - clears search;
  - if already selected, leaves cwd unchanged and ensures expansion;
  - otherwise sets `selectedCwd(workspaceActivationCwd(row, selectedProject?.key ?? null, selectedCwd))` and expands.
- During search, `effectiveExpanded = row.hasQueryMatch || expandedWorkspaceKeys.has(row.key)`.
- Do not persist expansion.

## Step 5: Search and empty treatment

Header order:

1. Brand.
2. New Session.
3. Add Folder trigger.
4. Refresh.
5. Search field below the button row.

Search field:

- Native text input with label/placeholder.
- Escape clears query.
- Clear button is present when nonblank.
- Typing never changes cwd, selected session, running state, unread state, or expansion state.

When query is nonblank and `hasQueryMatches` is false, render context rows plus:

```tsx
<div role="status">
  <span>{t("sidebar.noWorkspaceMatches")}</span>
  <button type="button" onClick={() => setWorkspaceQuery("")}>
    {t("sidebar.clearSearch")}
  </button>
</div>
```

When there are no workspaces and no query, show Add Folder onboarding.

## Step 6: Folder popover semantics

Use normal labelled container plus native buttons—no `menu` roles.

- Trigger has `aria-expanded` and `aria-controls`.
- Add Folder closes popover then calls `onAddFolder`.
- Default Directory calls `/api/default-cwd`, then passes returned cwd to `onSelectFolder`; shell validates it and opens a fresh composer.
- Outside click closes.
- Escape closes and returns focus to trigger.

## Step 7: Workspace/session row structure

Workspace row wrapper contains sibling controls:

```tsx
<div className="workspace-row">
  <button type="button" aria-expanded={isExpanded} aria-controls={groupId} ...>
    {/* chevron only */}
  </button>
  <button type="button" aria-current={isSelected ? "page" : undefined} ...>
    {/* path + activity */}
  </button>
</div>
<div id={groupId} hidden={!isExpanded}>...</div>
```

Do not nest buttons.

For `SessionItem`, remove row-level click/fake keyboard semantics. Keep the outer layout `<div>`, then render sibling controls:

- Fork disclosure button when children exist.
- Main session select `<button type="button">` containing title, time/count, branch, and running/unread status.
- Rename and delete buttons as siblings.
- Rename input/delete confirmation replace the normal controls as today.
- Context-menu handler stays on the outer row.

`SessionTreeItem` receives `forceExpanded`. Its child container is visible when `forceExpanded || !collapsed`. Fork disclosure retains its stored local state when search clears.

## Step 8: Relocate worktree UI mechanically

Move current worktree switcher and guide JSX from the old header into constants rendered inside the selected expanded workspace, before sessions.

Preserve verbatim:

- `handleCreateWorktree` and `handleRemoveWorktree` bodies/dependencies.
- branch strings and create form.
- server `currentWorktreePath` current-row identity.
- dirty 409 Force/Cancel row.
- clean removal fallback to `projectRoot`.
- worktree filter threshold and content.
- main checkout label.
- outside-click reset behavior.

Only wrapper spacing/placement may change. Collapsing the workspace may hide the switcher but must close its dropdown; it must not change cwd.

## Step 9: Focused and full gates

```bash
node --test \
  components/SessionSidebar.workspace.test.mjs \
  components/SessionSidebar.test.mjs \
  components/SessionSidebar.project-identity.test.mjs \
  components/SessionSidebar.worktree.test.mjs \
  components/AppShell.folder-validation.test.mjs \
  components/AppShell.workspace-memory.test.mjs \
  lib/workspace-browser.test.mjs
node_modules/.bin/tsc --noEmit
npm test
node_modules/.bin/eslint . --format json > /tmp/zosma-phase2-eslint-task4.json; test $? -eq 1
# Run Appendix A.
git add components/SessionSidebar.tsx components/SessionSidebar.workspace.test.mjs components/SessionSidebar.test.mjs components/SessionSidebar.project-identity.test.mjs
git diff --cached --name-only
git commit -m "feat: add workspace sidebar browser"
```

---

# Task 5: Empty-Composer Workspace Selector (TDD)

Files:

- Create `components/ChatWindow.workspace-selector.test.mjs`
- Modify `components/ChatWindow.tsx`
- Modify `components/AppShell.tsx` only at the `ChatWindow` prop mount

## Step 1: Write failing contracts

Assert:

- Selector renders only inside `isEmptyNew` and only when `newSessionCwd` exists.
- It receives `currentProjectKey`, `validatedProject`, and the non-restoring callback.
- It lists `getRecentProjects` plus a transient row only when not session-derived.
- Current selection compares workspace keys, not `root === currentCwd`.
- Clicking the already-current key only closes the popover and preserves exact cwd/draft.
- Clicking another derived workspace sends `(root, root, key)`.
- Clicking transient sends `(cwd, root, key)`.
- Add Folder delegates to shell.
- Trigger has `aria-expanded`/`aria-controls`; container has no menu roles.
- Escape closes and returns focus.
- The component has loading/error/empty text that does not block Add Folder.

Run focused test. Expected: FAIL because selector is absent.

## Step 2: Add props

`ChatWindow` props:

```tsx
validatedProject?: ValidatedCwd | null;
currentProjectKey?: string | null;
onComposerWorkspaceSelect?: (cwd: string, root: string, key: string) => void;
onComposerAddFolder?: () => void;
```

At `AppShell` mount pass:

```tsx
validatedProject={validatedProject}
currentProjectKey={selectedSession
  ? workspaceKeyOf(selectedSession)
  : activeProjectKeyRef.current}
onComposerWorkspaceSelect={handleComposerCwdChange}
onComposerAddFolder={openAddFolder}
```

## Step 3: Implement selector

Keep it above the existing `ChatInput` in the empty 780px composer wrapper. Do not edit `ChatInput.tsx` or width tokens.

The selector may fetch `/api/sessions` once per `ChatWindow` mount. Reuse:

- `getRecentProjects` for grouping.
- `transientWorkspace` for suppression.
- `ValidatedCwd` type.

Each derived option is `{key, root, cwd:root}`. Append transient option with exact cwd.

Selection handler:

```tsx
const pick = (workspace: { key: string; root: string; cwd: string }) => {
  setOpen(false);
  if (workspace.key === currentProjectKey) return;
  onSelect?.(workspace.cwd, workspace.root, workspace.key);
};
```

Use a normal popover with native buttons. Add document Escape/outside-click handling and restore trigger focus on Escape. Do not use `role="menu"`/`menuitem`.

A small local animated wrapper is acceptable because the sidebar helper is private, but keep it presentation-only and rely on the existing global reduced-motion rule.

## Step 4: Gates and commit

```bash
node --test components/ChatWindow.workspace-selector.test.mjs components/ChatWindow.notices.test.mjs components/ChatWindow.process-details.test.mjs
node_modules/.bin/tsc --noEmit
npm test
node_modules/.bin/eslint . --format json > /tmp/zosma-phase2-eslint-task5.json; test $? -eq 1
# Run Appendix A.
git add components/ChatWindow.tsx components/ChatWindow.workspace-selector.test.mjs components/AppShell.tsx
git diff --cached --name-only
git commit -m "feat: add new-session workspace selector"
```

---

# Task 6: Final Automated and Manual Verification

No planned source changes. Any fix gets a focused `fix:` commit followed by all gates.

## Automated gates

```bash
node_modules/.bin/tsc --noEmit
npm test
node_modules/.bin/eslint . --format json > /tmp/zosma-phase2-eslint-final.json; test $? -eq 1
# Run Appendix A with baseline and final.
git status --short
git diff --check
git log --oneline -7
```

Expected status contains only the two pre-existing untracked files:

```text
?? docs/superpowers/plans/2026-08-22-deepseek-style-zosma-dashboard-phase-1-visual-foundation-branding-app-shell.md
?? pnpm-lock.yaml
```

Do not delete, modify, stage, or commit them.

## Desktop manual flows

1. **Workspace list:** session-derived workspaces appear most-recent first. Selected workspace is expanded. Disclosure toggles without changing cwd/session.
2. **Restore distinction:** sidebar switch restores remembered session; empty-composer selector does not.
3. **Add Folder from open session:** picker validates, closes old session view, and opens fresh composer at exact selected cwd without remembered restore.
4. **Transient lifecycle:** empty folder appears selected; first prompt makes it session-derived; deleting its last session does not resurrect a transient row; reload before first prompt drops transient.
5. **Initial URL cwd:** valid `/?cwd=...` shows selected transient row and selector option; invalid cwd shows existing error.
6. **Search:** root match shows all sessions; child-title match shows ancestor chain; selected/running/unread context stays visible; matching sessions are disclosed; no-match row can clear query; selection/URL remain unchanged.
7. **Session actions:** rename, delete, Shift-delete, context menu, fork nesting/collapse, running/unread status, and selected state remain intact.
8. **Worktrees:** create, switch, remove clean, dirty Force/Cancel, branch labels, server current identity, filter, and main fallback all work inside selected expanded workspace.
9. **Files:** cross-project switch clears file tabs; same-project worktree switch preserves them; right-panel open/resize/close remains unchanged.
10. **Header controls:** New/Refresh and settings buttons remain reachable and scoped correctly.

## Keyboard/accessibility flows

1. Search, clear, New, Add Folder, Refresh, workspace disclosure/select, session select, fork disclosure, rename/delete, and FileExplorer all receive visible focus.
2. Native Enter/Space activates buttons without custom keyboard handlers.
3. No nested interactive controls and no partial tree/menu roles.
4. Escape clears search when focused there; Escape closes folder/composer popovers and returns trigger focus.
5. Running/unread counts have accessible text; selected workspace/session uses `aria-current`; disclosure uses `aria-expanded`.
6. Reduced motion makes fades/rotation near-instant through existing global rule.

## Responsive flows

1. **390×844 mobile:** drawer has no horizontal overflow; workspace disclosure stays open; session selection closes drawer; Add Folder portal works; selector fits viewport.
2. **~1100px:** sidebar resizing and worktree dropdown stay within sidebar.
3. **≥1440px:** transcript remains 748px; composer remains 780px; right panel remains flex-column and resizable; expansion causes no shell layout shift.
4. Light/dark themes use semantic tokens; only existing destructive red and unread cyan conventions remain hardcoded.

## Stop condition

When all gates pass, Phase 2 is complete. Stop before Phase 3. Do not redesign messages, composer controls, headers, files, settings, or metrics.

---

# Appendix A: Exact ESLint Fingerprint Comparison

Run this command with baseline path first and candidate path second:

```bash
node -e 'const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");const normalize=(value)=>value.replace(/\r\n/g,"\n").replace(/\n\n(?:[A-Za-z]:)?[\\/][^\n]*:\d+:\d+\n[\s\S]*$/,"").replace(/\s+/g," ").trim();const load=(file)=>{const rows=JSON.parse(fs.readFileSync(file,"utf8"));const errors=[],warnings=[],counts=new Map();for(const row of rows){const relative=path.relative(process.cwd(),row.filePath);for(const message of row.messages){if(message.severity===2)errors.push([relative,message.ruleId]);if(message.severity===1)warnings.push([relative,message.ruleId]);if(message.severity<=0)continue;const key=JSON.stringify([relative,message.ruleId??"unknown",normalize(message.message)]);counts.set(key,(counts.get(key)??0)+1)}}assert.equal(warnings.length,0,`${file}: warnings are not allowed`);assert.equal(errors.length,15,`${file}: expected exactly 15 errors`);const expected={"components/ChatInput.tsx":{"react-hooks/preserve-manual-memoization":6},"components/ChatMinimap.tsx":{"react-hooks/preserve-manual-memoization":5},"components/SessionSidebar.tsx":{"react-hooks/preserve-manual-memoization":2},"hooks/useAgentSession.ts":{"react-hooks/preserve-manual-memoization":2}};const got={};for(const [relative,rule] of errors){got[relative]??={};got[relative][rule??"unknown"]=(got[relative][rule??"unknown"]??0)+1}assert.deepEqual(got,expected,`${file}: only the documented baseline errors are allowed`);return [...counts].map(([key,count])=>[...JSON.parse(key),count]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};const baseline=load(process.argv[1]),candidate=load(process.argv[2]);assert.deepEqual(candidate,baseline);console.log("ESLint fingerprint unchanged: 15 documented errors, 0 warnings")' /tmp/zosma-phase2-eslint-baseline.json /tmp/zosma-phase2-eslint-candidate.json
```

For each task, replace only the final candidate path. The fingerprint intentionally excludes ESLint location fields, `source`, and the React Compiler excerpt after its absolute `file:line:column` marker. It includes normalized semantic message text and occurrence count. Any mismatch blocks the task; do not update the baseline.

---

# Commit Sequence

1. `feat: add workspace browser logic`
2. `feat: add workspace navigation copy`
3. `feat: centralize new-workspace selection`
4. `feat: add workspace sidebar browser`
5. `feat: add new-session workspace selector`
6. Optional focused `fix:` commits found by final manual verification.

All implementation commits remain local unless separately requested. Every commit stages explicit paths and verifies `git diff --cached --name-only` before committing.
