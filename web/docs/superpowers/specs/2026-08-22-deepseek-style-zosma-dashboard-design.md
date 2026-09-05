# DeepSeek-Style Zosma Dashboard Design

**Date:** 2026-08-22  
**Status:** Approved

## Summary

Redesign the full zosma-harness dashboard to closely match DeepSeek Harness while retaining every useful Pi-Web capability. The result should feel like a Zosma product, not a themed copy: DeepSeek’s quiet layout, spacing, message treatment, disclosure rows, composer, workspace browser, and settings presentation combined with Zosma branding and Pi’s existing session, branch, model, tool, file, worktree, and telemetry features.

This is a presentation and interaction redesign. It does not replace the Pi session runtime, APIs, persistence, or backend architecture.

## Goals

- Match DeepSeek Harness in minute visual and interaction details where its patterns fit Pi.
- Replace dense Pi-Web chrome with a calm, uninterrupted conversation canvas.
- Make user messages and the composer feel spacious without wrapping every item in square cards.
- Render thinking and tool calls as compact, scannable DeepSeek-style disclosure rows.
- Make switching projects/workspaces fast and obvious.
- Preserve Pi-Web features, including branches, title generation, system prompt, worktrees, files, settings, session details, and export.
- Use Pi data for statistics; label any heuristic estimate explicitly.
- Apply Zosma branding using the flipped Delta Leonis logo, `zosma.ai` name, and Zosma website favicon.
- Preserve current light/dark themes, responsive behavior, accessibility, and keyboard interaction.

## Non-Goals

- Rewriting Pi’s agent/session runtime or API routes.
- Importing DeepSeek Harness as a runtime dependency.
- Adding a component library or other new dependency.
- Inventing unsupported metrics such as durable time-to-first-token.
- Reproducing DeepSeek-specific product features that have no Pi equivalent.
- Reintroducing a permanent split file explorer or card-heavy dashboard framing.
- Refactoring unrelated application logic.

## Design Direction

DeepSeek Harness is the visual source of truth. Existing sibling checkout `../deepseek-harness` supplies reference tokens, dimensions, states, and interactions. Pin visual comparison to DeepSeek Harness commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Baseline states are: empty/new session, populated conversation, active streaming with thinking and tools, expanded tool details, workspace menu, settings modal, light theme, dark theme, narrow desktop, and mobile. Implementation should adapt those patterns to existing zosma-harness components rather than copy its application architecture.

The overall screen uses a muted workspace sidebar and a wide, uninterrupted conversation canvas. Content remains centered in a readable column. Assistant messages sit directly on the canvas. User messages are right-aligned rounded bubbles with generous padding and a sensible width cap. The composer is a large rounded surface anchored near the bottom. Thinking, tool activity, retries, and compaction markers are linear disclosure rows, not square boxes.

“Big boxes” means generous message/composer surfaces and breathing room, not permanent rectangular cards around every event. Expanded tool payloads may use contained rounded panels because they need a readable boundary.

## Branding

- Product name: `zosma.ai`.
- Primary mark: `~/Downloads/delta-leonis-logo-flipped.png`.
- Favicon source: existing assets in `~/code/zosmaai/zosma-ai-website/`.
- Copy these assets into project-owned public paths during implementation; do not reference home-directory paths at runtime.
- Preserve original image proportions and provide accessible text where the product name or icon conveys identity.
- Do not retain visible DeepSeek names or logos.

## Information Architecture

### App shell

The screen has three main regions:

1. A collapsible workspace/sidebar rail.
2. A conversation surface with a quiet header.
3. A bottom composer and metrics area within the conversation surface.

Existing file tabs and viewers remain available, but the default chat view should not look like a permanent split-pane IDE. Opening a file may continue to use the existing tab/viewer system. File affordances in chat should look native to the DeepSeek-style conversation.

### Conversation header

The header shows the session title and a small set of quiet actions. It must expose:

- Branches.
- Generate title.
- System prompt.
- Session details.
- Session log/export.

Actions should use compact icon/text buttons, menus, or popovers instead of the current dense segmented toolbar. Destructive or infrequent actions belong in an overflow menu. Current behaviors and API calls remain unchanged. A new DeepSeek-style Trajectory view is out of scope because zosma-harness has no equivalent data flow; raw session inspection remains available through session log/export.

### Workspace sidebar

Translate current Pi project grouping into DeepSeek-style “Workspaces”:

- Zosma brand at top.
- Search across workspace names and sessions.
- Add workspace action using the existing cwd validation/selection flow.
- Expandable workspace rows with nested sessions.
- One-click workspace selection.
- New-session action scoped to the selected workspace.
- Restore the last selected session for each workspace when possible.
- Show running/unread state without making rows visually noisy.
- Keep worktree creation, switching, and removal in the workspace row menu or an adjacent disclosure.
- Preserve session rename, delete, export, fork relationships, and current project grouping semantics.

Workspace identity continues to use existing project/worktree helpers and server-resolved paths. “Add workspace” validates and selects a folder as the cwd for the empty/new-session composer; it does not create a separate persistent workspace record. The selected folder may appear as the current transient row, and it becomes a normal session-derived workspace after the first session is created there. No second workspace persistence model should be introduced.

### New-session workspace selector

When no session is selected, the composer includes a compact folder/workspace selector. Changing it updates the cwd for the new session and synchronizes sidebar selection. Existing validation and allowed-root rules remain the security boundary.

## Conversation Content

### User messages

- Right-aligned rounded bubble, matching DeepSeek’s soft pill/card shape rather than a square panel.
- Comfortable 16px-class body typography and spacing.
- Width capped so long prompts remain readable; narrow screens use available width.
- Existing message actions remain available as quiet hover/focus controls.
- Attachments and references appear as compact metadata within or directly below the bubble.

### Assistant messages

- Render markdown directly on the conversation canvas without a surrounding card.
- Keep existing markdown, code block, copy, and link behavior.
- Use clear vertical rhythm between prose, thinking, tool activity, and result content.
- Keep retry/error state visible without dominating the transcript.

### Thinking rows

Thinking appears as a compact disclosure row with a leading status affordance, short summary, and optional duration when real timing data exists.

- Collapsed by default after completion.
- May remain open while actively streaming if that matches current user expectations.
- Running state uses restrained motion or shimmer and respects reduced-motion preferences.
- Expanded content uses readable muted text, not a large nested card unless content requires scrolling.
- Keyboard activation, focus treatment, and `aria-expanded` are required.

### Tool-call rows

Each tool call uses a single-line DeepSeek-style summary:

- Leading tool/status icon.
- Human-readable action title.
- Small separator.
- Ellipsized argument/result summary.
- Running, success, error, and interrupted states.
- Hover/focus/expanded chevron behavior.

All calls start scannable and collapsed. Expanding a row reveals existing input and output data in a bounded rounded panel. Long payloads scroll internally so one tool call does not take over the transcript. File paths remain actionable through the existing file viewer. Errors show the first useful failure line in the collapsed row, with full details available after expansion.

No tool-specific renderer framework is required for this redesign. Existing normalized Pi tool call data remains the source; current special cases may be styled where already present.

### Compaction, retry, and branch markers

Render these as low-emphasis linear markers consistent with thinking/tool rows. They remain discoverable and expandable but should not look like full messages.

## Composer

The composer follows DeepSeek’s large rounded input surface:

- Multi-line input with existing draft persistence.
- Send/stop action with clear running state.
- Model and thinking-level selectors.
- Tool preset selector.
- Compact action/menu access for attachments, commands, compaction, sound, and other existing controls.
- New-session workspace selector when applicable.
- Existing drag/drop, paste, keyboard shortcuts, and accessibility behavior.

Secondary controls should not create a dense toolbar. Frequently used choices remain visible; infrequent choices move into a menu while retaining current capabilities.

## Session Metrics

Place a centered, low-emphasis metrics line below the composer, following DeepSeek’s stats treatment. Example:

```text
4 turns · 8 steps | 11 tool calls · Active 1m42s | Cache hit 51% | Input 49.8K tok · Output 2.1K tok | $0.14
```

Use existing `SessionStatsInfo`, context usage, and streaming measurements:

- Turns from user-message count.
- Steps from assistant-message count.
- Tool-call count.
- Total active duration.
- Input and output tokens.
- Cache read/write information and derived cache-hit percentage.
- Cost.
- Context usage ring or compact indicator.
- Optional live throughput from the current streamed-text heuristic, labeled explicitly as `Est. tok/s` and described as estimated in its tooltip.

All other values must come directly from Pi or be transparent arithmetic derivations such as cache-hit percentage. Hide unavailable or zero-value optional segments rather than display misleading placeholders. Do not display TTFT unless Pi exposes a real event or durable value. Detailed session metrics remain accessible from Session Details.

## Files and Details

- File paths mentioned by tools or messages should open through the existing file viewer and allowed-root checks.
- Keep file tabs and viewer behavior, but present entry points as inline links, references, or header actions.
- Session Details remains the full surface for IDs, file location, counts, token buckets, context, active time, and cost.
- Session log/export remains available from the header menu.

## Settings

Restyle existing settings/configuration screens as a DeepSeek-like modal:

- Blurred backdrop.
- Rounded two-column panel.
- Left category navigation.
- Right content area.
- Responsive single-column adaptation on small screens.

Models, providers/auth, plugins, skills, theme, language, defaults, and other existing settings keep their current data flows. The redesign should consolidate presentation, not merge unrelated backend routes or state models.

## Data Flow and State

Existing sources remain authoritative:

- `AppShell` owns selected session, tabs, global overlays, and shell coordination.
- `SessionSidebar` continues to use session listing, project grouping, cwd validation, worktree APIs, running state, and workspace memory.
- `useAgentSession` remains responsible for session messages, SSE streaming, reconciliation, model/thinking state, and session statistics.
- `ChatWindow`, `MessageView`, and `ChatInput` continue to render and operate on those values.
- Existing settings components and API routes continue to own configuration changes.

The redesign should prefer semantic class names and shared CSS variables over duplicating state or adding wrapper components with no behavioral purpose. Existing capability wiring should be reused.

## Error and Empty States

- Preserve current network, SSE reconnect, compaction, model switching, and tool errors.
- Show errors near the action that failed, using quiet inline treatment unless user action is blocked.
- Workspace validation and worktree failures keep actionable messages and dirty-worktree confirmation.
- Empty workspace: explain that no sessions exist and offer a scoped new session.
- No workspaces: offer folder selection/add workspace.
- No search matches: show a compact empty result without clearing current selection.
- Missing metrics: omit unsupported segments.

## Responsive and Accessibility Requirements

- Desktop uses sidebar plus centered conversation canvas.
- Mobile collapses workspace navigation into a drawer and keeps composer/actions reachable.
- Tool detail panels and settings must fit viewport without horizontal page overflow.
- Interactive rows support mouse and keyboard.
- Preserve visible focus, semantic button controls, labels/tooltips, `aria-expanded`, and status text not conveyed by color alone.
- Motion honors `prefers-reduced-motion`.
- Light and dark themes maintain readable contrast.

## Testing and Acceptance

### Automated checks

- Existing TypeScript and lint checks pass.
- Existing session, branch, workspace, worktree, file, settings, and streaming behavior tests remain green.
- Add focused tests only for new non-trivial formatting/state logic, such as metrics derivation and workspace restore behavior if changed.
- No test should depend on external home-directory image paths or the sibling reference repository.

### Manual acceptance

Compare the running app side by side with DeepSeek Harness in light and dark themes. Verify:

1. Shell proportions, spacing, typography, colors, radii, and hover/focus states closely match the reference.
2. Zosma logo, name, and favicon appear correctly with no DeepSeek branding.
3. User bubbles, open assistant canvas, thinking rows, tool rows, composer, and metrics line match the agreed direction.
4. Workspace add/search/expand/switch/restore/new-session flows work.
5. Worktree actions remain available.
6. Branches, Generate title, System prompt, Details, export/log, file viewing, and settings remain reachable.
7. Streaming, reconnect, tool progress, stop, retry, compaction, and completion behavior still work.
8. Desktop, narrow desktop, and mobile layouts remain usable.
9. Missing telemetry never produces fabricated values.

## Scope Boundary

This redesign is large enough to require a phased roadmap after this specification is approved. The roadmap should split shell/workspaces, conversation/composer, Pi-specific actions/files/settings, and metrics/polish into reviewable phases. No implementation starts until the written spec and subsequent roadmap/plan are approved.
