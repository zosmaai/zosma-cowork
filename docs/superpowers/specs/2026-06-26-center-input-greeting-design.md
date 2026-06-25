# Centered Input + AI Greeting + Top-Pinned Statusbar

**Date:** 2026-06-26
**Branch:** `feat/center-input-greeting`
**Status:** Approved design

## Problem

The empty chat state shows a `SuggestedActions` block ("What are you working
on?" + 5 starter cards) above a bottom-pinned input, and the `StatusLine`
telemetry strip sits directly on top of the input. We want a cleaner, more
intentional empty state: input centered on screen with a short AI-generated
greeting above it, sliding down to the bottom when the first message is sent.
The statusbar should pin to the very top of the chat panel and only appear once
a conversation is active.

## Goals

1. Remove `SuggestedActions` (cards + heading) entirely.
2. Empty chat: vertically-centered input with an AI greeting above it; no
   statusbar.
3. First message send: input animates from center to bottom; greeting fades out.
4. Active chat: `StatusLine` pinned to the top edge of the chat panel.
5. Greeting is AI-generated from recent session history, cheap and cached, with
   a static fallback that never blocks the input.

## Non-Goals

- Background/precomputed greeting generation (approach B) — revisit later if
  open latency becomes annoying.
- Persisting greetings across app launches beyond a short TTL.
- Reworking `MessageInput` internals or `StatusLine` content.

## Layout (in `ChatView`)

Single source of truth: `isEmpty = messages.length === 0 && !streamingMessage`.

- **Empty state:**
  - No `StatusLine` (decision C — keep the empty screen ultra-clean).
  - No `SuggestedActions`.
  - A vertically-centered column containing: AI greeting (top) + the existing
    `MessageInput` (below it).
- **Active state:**
  - `StatusLine` pinned to the top edge of the chat panel (touching the top),
    rendered above the message scroll area (gated on `thinking` as today).
  - Messages scroll in the middle.
  - `MessageInput` pinned at the bottom (as today).

`SuggestedActions.tsx` and its tests are deleted. The `SuggestedActions` import
and its render branch are removed from `ChatView`.

### Statusbar move

Currently `StatusLine` renders as a footer just above `MessageInput` inside
`ChatView`. Move its render slot to the top of the `ChatView` column so it
touches the top edge. Keep the existing `{thinking && <StatusLine .../>}` gate —
on the empty state there is no `thinking`, so it is naturally absent, satisfying
decision C.

## Animation: center -> bottom

The same persistent `MessageInput` instance is used in both states; only its
container position changes. On `isEmpty` flipping `true -> false`, the input
container animates from the centered position to the bottom and the greeting
fades out.

- Use `motion/react` (already a dependency) for the slide/fade.
- Respect `useReducedMotion` (already used in `ChatView`): when reduced motion
  is preferred, snap without animation.
- `ponytail:` if `motion` layout animation proves heavy/janky, fall back to a
  plain CSS transition on transform/opacity — no new dependency either way.

Do **not** remount the input on state change (that would drop focus / draft and
retrigger the entrance animation). Keep a single `MessageInput` whose wrapper
animates.

## Greeting: generation + caching (approach A)

### Sidecar (one-shot completion)

Add a one-shot helper in `agent-sidecar` (e.g. `generateGreeting(recentSessions)`)
that performs a small **non-streaming** SDK completion (low max-tokens, ~1
sentence) using the existing `@earendil-works/pi-coding-agent` SDK. This is
separate from the visible chat stream (`send_prompt`) so it never appears in the
conversation.

- Input: a compact list of recent session titles/previews (already available via
  `list_sessions`).
- Prompt instructs the model to return ONE short line. The model decides the
  angle: either continuity ("pick up where you left off: ...") OR a light fun
  fact / observation about the user's recent work. Plain text, no markdown, no
  quotes.
- Output: `{ text: string }`.

### Tauri bridge

Add a `generate_greeting` Tauri command in `src-tauri/src/lib.rs` that calls the
sidecar helper and returns `{ text }`. Register it in the command handler list.

### Frontend hook `useGreeting()`

New `src/hooks/useGreeting.ts`:

- **Cache:** in-memory + `sessionStorage`, **30-min TTL**. Survives opening new
  chats within a launch; refreshes occasionally.
- **On cache miss:** read recent sessions (titles/previews), call
  `generate_greeting`.
- **Fallback:** static string (e.g. "What are you working on?") used when there
  is no history, on error, or on a timeout (a few seconds). The input is always
  usable regardless of greeting state — no blocking spinner.
- **Render behavior:** show the static fallback line immediately; swap to the AI
  line in place when it resolves, with no layout jump (reserve line height).

## Error handling

- Greeting generation failure is non-fatal: fall back to the static string and
  log nothing user-facing.
- The centered input must always be interactive even while the greeting is
  loading or has failed.
- Timeout guard so a slow/hung sidecar call cannot leave the greeting in a
  permanent loading state.

## Testing (minimal but real)

- `useGreeting` test:
  - cache hit skips the `generate_greeting` call;
  - error -> fallback string;
  - TTL expiry triggers a refetch.
- `ChatView` test:
  - empty state renders the centered input and **no** statusbar, and no
    `SuggestedActions`;
  - after a message exists, statusbar renders at the top and input is at the
    bottom.

## Files touched

- `src/chat/ChatView.tsx` — layout branch, statusbar slot move, animation,
  remove `SuggestedActions`.
- `src/hooks/useGreeting.ts` — **new** (+ `useGreeting.test.ts`).
- `agent-sidecar/src/` — **new** greeting helper (small one-shot completion).
- `src-tauri/src/lib.rs` — `generate_greeting` command + registration.
- `src/components/SuggestedActions.tsx` + `SuggestedActions.test.tsx` —
  **deleted**.
- `src/chat/ChatView.test.tsx` — updated for new empty/active assertions.

Net: ~2 new small files; the rest are edits/deletions.

## Open questions

None blocking. Future: graduate to background-precomputed greeting (approach B)
if empty-state open latency becomes noticeable.
