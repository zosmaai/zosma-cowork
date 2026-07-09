# Task: Auto-continuation for models that narrate mid-workflow

**Issue:** [#325](https://github.com/zosmaai/zosma-cowork/issues/325)
**Status:** Complete
**PR:** (raise after commit)

---

## Problem Statement

DeepSeek V4 Flash (and potentially other models) emits a **text-only response** mid-workflow instead of calling the next tool — e.g. "Now let me write the file..." or "Let me draft the next section...". The pi agent loop exits correctly whenever it receives a non-tool response, so `session.prompt()` resolves and `runPromptTask` sends `{ type: "done" }` to the frontend. The task appears finished but nothing was actually done.

This is a model behaviour quirk, not a bug in the user's prompt or the SDK.

---

## Root Cause

When a model responds with only `text` content blocks and `stopReason: "stop"`, but tool calls were already in progress earlier in the same turn, it almost certainly means the model narrated its intent instead of executing it. Pi's SDK surfaces this as a normal completion — it cannot distinguish "genuinely done" from "narrated and quit" — so the caller (`runPromptTask`) must.

---

## Solution

**Continuation loop** inside `runPromptTask` in `agent-sidecar/src/index.ts`.

After `session.prompt()` resolves, check three conditions before re-prompting:

1. **`isTextOnlyStop`** — last assistant message has `stopReason: "stop"` with only `text`/`thinking` blocks (no `toolCall`)
2. **`sessionHasToolCalls`** — at least one prior tool call exists in the session (we're mid-workflow, not a pure chat turn)
3. **`!abortFired`** — no timeout or user-initiated abort occurred

If all three hold, re-prompt with `"Continue."` up to `MAX_CONTINUATIONS = 3` times.

---

## Files Changed

| File | Change |
|---|---|
| `agent-sidecar/src/continuation.ts` | New — pure helper functions + constants |
| `agent-sidecar/src/continuation.test.ts` | New — 19 unit tests |
| `agent-sidecar/src/index.ts` | `runPromptTask` — `abortFired` flag, `safeAbort` wrapper, continuation loop |

---

## Key Design Decisions

- **`MAX_CONTINUATIONS = 3`** — prevents infinite loops if a model consistently refuses to use tools
- **`"Continue."` re-prompt** — neutral, minimal, universally understood
- **`sessionHasToolCalls` guard** — prevents spurious continuations on pure chat turns (model answers in text → correct, should not re-prompt)
- **Helpers in `continuation.ts`** — keeps `index.ts` readable; independently unit-testable
- **`abortFired` flag** — `safeAbort()` wraps the two existing timeout `.abort()` calls so loop exits cleanly on user or timeout abort
- **User-abort safety via SDK** — when user aborts, `session.prompt()` resolves with `stopReason: "aborted"` → `isTextOnlyStop` returns `false` → loop exits without needing `abortFired`
- **No frontend changes** — fully transparent; only visible signal is `"Continue."` in chat

---

## Verification

Confirmed in `~/Library/Logs/ai.zosma.cowork/zosma.log`:

```
[2026-07-08][08:40:04] prompt: model narrated mid-workflow — auto-continuing (1/3)
[2026-07-08][08:40:04] Saved session: session-1783499853319.jsonl 2 messages
```

Fired once, task completed after single re-prompt.
