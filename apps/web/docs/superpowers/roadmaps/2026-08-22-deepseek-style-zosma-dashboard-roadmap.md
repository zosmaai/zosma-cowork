# DeepSeek-Style Zosma Dashboard Roadmap

> **For agentic workers:** Use /skill:writing-plans to create one detailed implementation plan per phase. Start with Phase 1 and proceed sequentially unless the user explicitly changes the order.

**Goal:** Deliver a Zosma-branded dashboard with DeepSeek Harness visual parity while preserving Pi session, workspace, branch, tool, file, settings, and telemetry behavior.

**Design Spec:** [`docs/superpowers/specs/2026-08-22-deepseek-style-zosma-dashboard-design.md`](../specs/2026-08-22-deepseek-style-zosma-dashboard-design.md)

**Planning Strategy:** The redesign crosses the shell, workspace behavior, conversation rendering, Pi-specific controls, settings, and telemetry. Six ordered phases keep each detailed plan within one context window and leave the app functional after every phase. Each phase must include the responsive and accessibility basics for its own surfaces; Phase 6 performs the final cross-screen audit rather than deferring basic usability.

---

## Phase 1: Visual Foundation, Branding, and App Shell

**Outcome:** The existing application runs inside a Zosma-branded, DeepSeek-style shell with shared visual tokens, correct assets, and coherent light/dark foundations. Existing navigation and chat behavior remain usable.

**Why now:** Every later surface depends on stable colors, typography, spacing, radii, content widths, and shell geometry. Establishing them once avoids per-component imitation and rework.

**Scope:**
- Add project-owned Delta Leonis logo and Zosma favicon assets from the approved local sources.
- Replace visible product branding with `zosma.ai`.
- Establish semantic theme variables based on the pinned DeepSeek Harness reference.
- Restyle the app background, panel hierarchy, primary layout, tab strip, overlays, and shared interactive states.
- Establish centered conversation width, sidebar width, header height, bottom-area spacing, and mobile shell behavior.
- Keep all current controls reachable during the transition.

**Out of scope:**
- New workspace interactions and nested workspace rows.
- Message, thinking, tool, and composer redesign.
- Header action consolidation, settings redesign, and metrics relocation.

**Key files/areas likely affected:**
- `app/globals.css`: shared tokens, themes, shell geometry, focus and motion rules.
- `app/layout.tsx` and `app/favicon.ico`: metadata and favicon integration.
- `public/`: project-owned Zosma logo/icon assets.
- `components/AppShell.tsx`: top-level layout classes and shell regions.
- `components/TabBar.tsx`: tabs aligned with the quieter shell.

**Dependencies:**
- Approved design spec.
- DeepSeek Harness visual reference pinned at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Approved local Zosma asset sources must exist when the phase is planned and executed.

**Verification:**
- TypeScript, lint, and existing tests remain green.
- App starts with existing sessions, tabs, sidebar, and controls functional.
- Zosma branding appears correctly with no visible DeepSeek branding.
- Base shell is visually compared in light, dark, desktop, and mobile states.

**Phase boundary health:** Only visual foundations and shell composition change. Existing sidebar, chat, settings, and Pi actions remain functionally intact, so the app is usable if work stops here.

**Risks:**
- Broad global CSS can regress unrelated surfaces; mitigate with semantic tokens and scoped shell classes rather than element-wide overrides.
- Source asset dimensions may distort layout; preserve aspect ratio and verify actual files before integration.

**Context notes:** Reuse current layout/state ownership. Do not introduce a design-system package or port DeepSeek’s component architecture.

---

## Phase 2: DeepSeek-Style Workspace Navigation

**Outcome:** The sidebar behaves as a searchable DeepSeek-style workspace browser with expandable workspace rows, nested sessions, easy switching, scoped new sessions, and preserved Pi worktree behavior.

**Why now:** Workspace selection determines the cwd and session context used by the composer and later header/file work. Stabilizing it before conversation changes prevents duplicated selection logic.

**Scope:**
- Present existing project grouping as expandable Workspaces with nested sessions.
- Add workspace/session search and clear empty-result treatment.
- Add folder selection through the existing cwd validation flow.
- Treat a newly selected folder as the transient new-session workspace until a session exists.
- Support one-click switching and restore the remembered session per workspace.
- Scope new-session actions and the empty composer’s workspace selector to the selected cwd.
- Preserve running/unread indicators, session actions, parent/fork relationships, and selected-session behavior.
- Keep worktree create, switch, remove, dirty confirmation, and server-resolved identity available through workspace actions.

**Out of scope:**
- A persistent workspace registry separate from session-derived project grouping.
- Conversation message and tool presentation.
- Header actions, settings, and metrics.

**Key files/areas likely affected:**
- `components/SessionSidebar.tsx`: workspace browser presentation and interactions.
- `components/AppShell.tsx`: selected cwd/session coordination.
- `components/ChatWindow.tsx` and `components/ChatInput.tsx`: empty-session workspace selector integration.
- `lib/workspace-memory.ts`: existing per-workspace last-session behavior, only if gaps are found.
- `lib/worktree.ts`, `lib/paths.ts`, and `/api/worktrees`: behavior to preserve; change only if the existing contract cannot support the UI.

**Dependencies:**
- Phase 1 shell tokens and sidebar geometry.
- Existing cwd validation, allowed-root, project grouping, and worktree APIs.

**Verification:**
- Existing workspace-memory, session, cwd, path-security, and worktree tests remain green.
- Search, expand/collapse, add folder, switch, restore, new session, rename/delete, and worktree flows work manually.
- A folder with no sessions behaves as a transient selected workspace and becomes session-derived after first prompt/session creation.
- Keyboard navigation, focus states, overflow menus, desktop, and mobile drawer behavior are usable.

**Phase boundary health:** The app has complete workspace navigation and still uses the existing conversation and settings surfaces. No new persistence model or half-migrated cwd path remains.

**Risks:**
- Project roots, worktrees, and raw cwds can look interchangeable while having different identity rules; reuse `projectKey`, `workspaceKeyOf()`, and server-resolved path comparisons.
- Filtering may hide running sessions or selected context; preserve selection and activity indicators when search changes.

**Context notes:** Trace every current session/worktree action before moving controls. Fix shared identity issues at existing helpers, not with sidebar-only path comparisons.

---

## Phase 3: Conversation Flow and Composer

**Outcome:** The main chat matches DeepSeek Harness: rounded user bubbles, open-canvas assistant content, compact thinking/tool disclosures, and a large rounded composer, while Pi streaming and controls continue to work.

**Why now:** It is the primary user experience and depends only on the established shell and selected workspace/cwd contract.

**Scope:**
- Restyle user and assistant messages with the agreed spacing, width, typography, and action treatment.
- Render thinking as accessible collapsed/running/completed disclosure rows.
- Render tool calls as one-line summaries with running, success, error, interrupted, and expanded-detail states.
- Keep normalized tool input/output, file paths, errors, and long-payload scrolling functional.
- Restyle compaction, retry, branch markers, references, and message-level actions as low-emphasis flow elements.
- Redesign the composer while preserving send/stop, draft, model, thinking, tool preset, compaction, sound, drag/drop, paste, and keyboard behavior.
- Apply per-surface mobile and reduced-motion behavior.

**Out of scope:**
- New tool-specific renderer framework.
- New runtime events or changes to SSE lifecycle.
- Final header action consolidation, settings, and footer metrics.

**Key files/areas likely affected:**
- `components/MessageView.tsx`: message, thinking, tool, error, and marker presentation.
- `components/MarkdownBody.tsx`: assistant-content spacing and code/link integration.
- `components/ChatWindow.tsx`: centered flow, streaming states, and bottom-area composition.
- `components/ChatInput.tsx`: composer presentation and control grouping.
- `components/BranchNavigator.tsx`: marker/disclosure visual alignment where used in the flow.
- `app/globals.css`: conversation and composer classes/tokens.
- `hooks/useAgentSession.ts`: behavior to preserve; change only for a proven presentation data gap.

**Dependencies:**
- Phase 1 shared visual foundation.
- Phase 2 selected workspace/new-session cwd behavior.
- Existing `normalizeToolCalls()` and streaming/reconciliation contracts.

**Verification:**
- TypeScript, lint, message normalization, streaming, and relevant UI tests remain green.
- Prompt, streaming, reconnect, stop, retry, tool progress, tool failure, compaction, and branch scenarios work manually.
- Thinking/tool rows support keyboard toggling, `aria-expanded`, non-color status text, and reduced motion.
- Long markdown, code, tool payloads, and narrow/mobile layouts do not overflow the page.
- Side-by-side comparison covers empty, populated, streaming, and expanded-tool states in both themes.

**Phase boundary health:** Chat and composer form a complete, usable experience. Pi controls remain available even before their final header/settings presentation is introduced.

**Risks:**
- `MessageView` handles stored and live normalized shapes; preserve both paths and avoid presentation-only schema changes.
- Closing or simplifying streaming UI can accidentally alter SSE lifecycle; keep state logic unchanged unless a failing test proves otherwise.

**Context notes:** Prefer semantic classes and small formatting helpers. Existing tool data is enough; do not build DeepSeek’s renderer registry.

---

## Phase 4: Pi Actions, Branches, Files, and Session Details

**Outcome:** Pi-specific capabilities fit the DeepSeek-style interface through a quiet session header, menus/popovers, branch UI, inline file affordances, and a complete details surface.

**Why now:** These controls rely on the stable shell and conversation layout. Isolating them prevents visual work from masking regressions in high-value Pi actions.

**Scope:**
- Consolidate Branches, Generate title, System prompt, Session Details, and session log/export into the quiet header and overflow patterns.
- Preserve branch switching, in-session navigation, and independent session forks without conflating them.
- Keep full session metadata, counts, tokens, context, active duration, cost, IDs, and paths available in Session Details.
- Present file references and tool paths as native inline links/actions.
- Preserve file tabs/viewer behavior and allowed-root security checks without a permanent split explorer.
- Retain session rename, delete, export, and related confirmations where they currently belong.
- Explicitly omit a new Trajectory view; raw inspection remains log/export.

**Out of scope:**
- Backend/session format rewrites.
- A general filesystem browser or relaxed file allow-list.
- Settings redesign and final metrics strip.

**Key files/areas likely affected:**
- `components/AppShell.tsx`: session header, overlays, details, and global actions.
- `components/ChatWindow.tsx`: title/header coordination and file-open callbacks.
- `components/BranchNavigator.tsx`: DeepSeek-style branch presentation.
- `components/FileViewer.tsx`, `components/FileExplorer.tsx`, and `components/TabBar.tsx`: retained file access and quieter entry points.
- `components/MessageView.tsx`: inline file actions from tool/message content.
- `lib/file-access.ts`, `lib/path-security.ts`, and file/session API routes: security contracts to preserve.

**Dependencies:**
- Phase 1 shell/header foundation.
- Phase 3 conversation and disclosure patterns.
- Existing branch, session export, title, system prompt, and file APIs.

**Verification:**
- Branch navigate/fork, Generate title, System prompt, Details, export/log, rename/delete, and file-open flows work manually.
- Existing session, branch, export, file-path, and path-security tests remain green.
- File links reject paths outside allowed roots and remain keyboard accessible.
- Header actions remain usable at desktop and mobile widths without recreating a dense toolbar.

**Phase boundary health:** Every existing Pi action remains reachable, files stay within the existing security boundary, and no unsupported Trajectory feature is left half-built.

**Risks:**
- Fork and in-session branching have different lifecycle rules; preserve current commands and wrapper destruction behavior.
- Moving file entry points can bypass security accidentally; all opens must continue through existing encoded paths and server allow-list checks.

**Context notes:** Move presentation, not ownership. Trace current callers and commands before relocating each action.

---

## Phase 5: Unified DeepSeek-Style Settings

**Outcome:** Existing configuration surfaces appear in a responsive, blurred-backdrop, two-column DeepSeek-style settings modal without changing provider, model, plugin, skill, theme, or language behavior.

**Why now:** Settings is visually distinct and can be migrated safely after the shell/header patterns are stable. Keeping it separate limits risk around auth and configuration state.

**Scope:**
- Add shared settings-modal shell with left category navigation and right content pane.
- Adapt current model/provider/auth, plugin, skill, appearance, language, and default-preference surfaces to the shell.
- Preserve status refresh, OAuth/API-key flows, package operations, skill toggles, validation, and error messages.
- Support responsive single-column navigation/content behavior.
- Align dialogs, forms, lists, buttons, loading, and error states with shared tokens.

**Out of scope:**
- Merging existing API routes or configuration state models.
- New provider, plugin, or skill functionality.
- Final session metrics and app-wide pixel audit.

**Key files/areas likely affected:**
- `components/ModelsConfig.tsx`: model/provider configuration presentation.
- `components/PluginsConfig.tsx`: package settings presentation.
- `components/SkillsConfig.tsx`: skill settings presentation.
- `components/AppShell.tsx`: modal/category coordination.
- Existing theme/language/settings components and `app/globals.css`: shared modal/form styling.
- Auth, model-config, plugin, and skill API routes: behavior to preserve.

**Dependencies:**
- Phase 1 shared theme and overlay tokens.
- Phase 4 header/settings entry point.

**Verification:**
- Existing model, auth, provider-listing, plugin, skill, theme, and language tests remain green.
- Open/close, category navigation, provider status refresh, auth changes, model edits/tests, plugin operations, and skill toggles work manually.
- Modal is keyboard navigable, traps/focuses appropriately using existing behavior, and works in both themes and mobile layout.

**Phase boundary health:** Settings remains feature-complete and independent of the final metrics/polish phase. No backend contract changes or partial configuration migration remains.

**Risks:**
- Visual consolidation can accidentally combine unrelated async state; preserve each existing component’s ownership and callbacks.
- Dual-auth providers require both lists to refresh; retain capability-driven provider logic and current post-auth refresh behavior.

**Context notes:** Build the minimum shared modal shell. Do not invent a settings framework or rewrite stable forms.

---

## Phase 6: Metrics, Responsive Hardening, and Visual Parity

**Outcome:** The composer footer shows accurate Pi-backed session metrics, every screen is hardened across viewport/theme/accessibility states, and the final product is visually compared against the pinned DeepSeek baseline.

**Why now:** Metrics placement depends on final composer geometry, while app-wide responsive and visual polish is most efficient after all major surfaces exist.

**Scope:**
- Add the centered metrics strip below the composer using existing `SessionStatsInfo` and context data.
- Show turns, steps, tool calls, active time, token buckets, cache-hit derivation, cost, and context usage when available.
- Label heuristic streaming throughput explicitly as `Est. tok/s`; omit unsupported TTFT and unavailable metrics.
- Keep detailed values in Session Details while avoiding duplicate competing chrome.
- Perform final desktop, narrow desktop, mobile, light, dark, keyboard, focus, contrast, overflow, and reduced-motion audits.
- Compare all baseline states against DeepSeek Harness at the pinned commit and fix meaningful spacing, typography, radius, color, and state differences.
- Remove obsolete presentation code made redundant by the completed redesign.

**Out of scope:**
- New telemetry collection or invented durable metrics.
- New product capabilities beyond the approved spec.
- Refactoring unrelated runtime or API code.

**Key files/areas likely affected:**
- `components/ChatWindow.tsx` and `components/ChatInput.tsx`: footer placement and available streaming state.
- `components/AppShell.tsx`: remove or simplify superseded stats chrome.
- `lib/pi-types.ts` and `hooks/useAgentSession.ts`: existing statistics contracts to reuse; change only for a verified missing value.
- A focused metrics formatter/component and test, if non-trivial formatting logic warrants extraction.
- `app/globals.css` and all redesigned components: final responsive/accessibility/visual fixes.

**Dependencies:**
- Phases 1–5 complete.
- Existing Pi session stats and context data.
- Pinned DeepSeek baseline screens and states.

**Verification:**
- Focused tests cover non-trivial metric derivation/formatting, especially cache-hit denominator and omitted values.
- Full TypeScript, lint, and test suite passes.
- Full manual regression covers sessions, workspaces, worktrees, streaming, tools, branches, files, settings, errors, and empty states.
- Visual comparison covers every baseline state at desktop, narrow desktop, and mobile in light and dark themes.
- No metric is fabricated; estimated throughput is labeled; TTFT remains absent.

**Phase boundary health:** This is the final integrated state. All approved functionality is present, obsolete chrome is removed, and the app remains expected-green with no follow-up migration required.

**Risks:**
- A late global polish pass can destabilize earlier surfaces; make scoped fixes and rerun regression checks after each affected area.
- Metrics can appear authoritative despite being derived; centralize labels/formatting and omit values lacking valid source data.

**Context notes:** Treat visual parity as measured comparison, not a rewrite. Stop when approved baseline states match and all Pi behavior remains intact.
