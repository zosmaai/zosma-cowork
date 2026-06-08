# Slash-command system — roadmap (epic #179)

Tracks the `/`-command layer in the composer. Source of truth for what has
landed, what's in flight, and what is deferred so it can be picked up later.

Branch: `feat/179-slash-commands`. Sub-issues: #181 (A1), #182 (A2), #183 (A3),
#184 (A4).

## Status at a glance

| Slice | Issue | State | Notes |
|---|---|---|---|
| A1 — palette UI | #181 | ✅ done | Pure-presentation palette + fuzzy filter + MessageInput wiring. 22 palette tests. |
| A2 — built-in command registry | #182 | 🚧 in progress | **Clean subset only** this PR (see below). |
| A2b — plumbing-dependent commands | #182 | ⏳ deferred | Needs new frontend plumbing (see below). |
| A4 — skill & prompt-template commands | #184 | ⏳ not started | Reuse `TEMPLATES` + skills data. |
| A3 — extension `/commands` via sidecar | #183 | ⏳ not started | **Spike first.** Interacts with #153, #161. |

## A1 — palette UI (#181) ✅

Shipped on `feat/179-slash-commands`:

- `src/types/commands.ts` — `Command` descriptor + category order/labels.
- `src/lib/commandFilter.ts` — dependency-free fuzzy matcher (exact > prefix >
  subsequence > description; stable-ranked). 8 unit tests.
- `src/components/CommandPalette.tsx` — floating popover above the composer;
  category-grouped, keyboard-driven, `argHint` pill on the selected row.
- `src/components/MessageInput.tsx` — `parseSlashInput()` + `commands`/
  `onRunCommand` props; palette keys intercept before send when open;
  non-`/` input is byte-identical to before.

Covered: open/close, filter, Enter-runs-not-sends, args passthrough, Arrow
up/down + wraparound, selection clamping, Tab-complete, Esc dismiss,
Backspace-past-`/` dismiss, hover-select, empty state, category headers,
argHint pill, Shift+Enter no-op, no-registry stays closed.

## A2 — built-in command registry (#182)

### In this PR — clean subset (wires to existing App.tsx handlers only)

`src/lib/builtinCommands.ts`: typed registry of `BuiltinCommand` (extends the
A1 `Command` with `run(ctx, args)`), a `CommandContext` of GUI actions, and
`findBuiltinCommand` / `runBuiltinCommand` dispatch. Built test-first.

| Command | Aliases | Action (via `CommandContext`) |
|---|---|---|
| `/new` | `/new-session` | `newSession(folder?)` → `handleNewSessionPrompt()` |
| `/resume` | `/sessions`, `/history` | `openSessions()` → `setSidebarView("chats")` |
| `/model` | — | bare → `openModelSelector()`; `/model <id>` → `setModel(id)` |
| `/settings` | `/config` | `openSettings()` → `setShowSettings(true)` |
| `/help` | `/?` | `showHelp()` — enumerate commands |

Unknown `/foo` falls through and sends as normal text (don't trap typos).

### A2b — deferred (need new frontend plumbing) ⏳

These were in #182's original list but each requires plumbing that doesn't
exist yet. Pull them once the prerequisite lands.

| Command | Aliases | Blocked on |
|---|---|---|
| `/extensions` | — | `SettingsPage` takes **no `initialSection` prop** — add one so the command can deep-link to the Extensions section. |
| `/skills` | — | Same `SettingsPage initialSection` prerequisite (Skills section). |
| `/share` | `/export` | `ShareExport` renders its own top-right trigger with **no external "open" handler** — lift its open-state to App so a command can trigger it. |
| `/clear` | — | **No clear-conversation handler** exists in App.tsx. Define semantics (clear transcript in place vs. start a fresh in-folder session) before wiring. |
| `/compact` | — | Compaction trigger **not supported** in the app yet (#182 itself flags "if/when supported"). Revisit when the sidecar exposes it. |

**Suggested A2b prerequisites (own small PRs, reusable beyond slash-commands):**
1. `SettingsPage` `initialSection?: "extensions" | "skills" | …` prop → unblocks `/extensions` + `/skills`.
2. Lift `ShareExport` open-state into App (controlled `open`/`onOpenChange`) → unblocks `/share`.
3. Add an App-level `clearConversation()` (decide in-place vs. new-session) → unblocks `/clear`.

## A4 — skill & prompt-template commands (#184) ⏳

- Fold existing `TEMPLATES` (`src/data/templates.ts`) into commands under the
  **Skills** category; selecting one loads the prompt into the composer for
  editing (reuse the existing `draft={text,nonce}` path — does NOT auto-send).
- Surface installed skills as `/skill:<name>` commands.
- Pure data reuse; no sidecar change.

## A3 — extension `/commands` via sidecar bridge (#183) ⏳

- **Spike first.** The sidecar embeds pi's SDK and calls `session.prompt()`
  directly, bypassing pi's input pipeline where extension commands / `/skill:`
  / templates are normally expanded.
- Needs a thin sidecar bridge to surface + execute extension-registered
  `pi.registerCommand()` commands. Interacts with #153 (agent integration path)
  and #161 (`<available_extensions>` catalog). Keep last; gate on the spike.

## Cross-cutting note — #201 (steer/follow-up) overlap

#201 also edits `MessageInput.tsx` (`handleKeyDown`: Enter=steer / Alt+Enter=
follow-up while streaming). As of this writing #201 has only touched the
sidecar + Rust layers, not the composer UI. When both land, reconcile in
`handleKeyDown`: **palette-open intercepts Enter first**, then #201's streaming
logic, then plain send.
