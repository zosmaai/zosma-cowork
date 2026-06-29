# Task: Provider API Key Validation at Entry

**Issue:** [#302](https://github.com/zosmaai/zosma-cowork/issues/302)
**Status:** Not started
**Priority:** Medium
**Labels:** `bug`, `enhancement`

---

## Problem Statement

When a user pastes an API key into Zosma Cowork, there is **zero validation** at the point of entry. The key is persisted blindly and the user only discovers it's invalid when a chat request fires and returns a generic 401 error mid-stream — with no indication of *why* it failed (wrong provider? malformed? revoked?).

Real-world report (Pranay): key intended for `opencode-go` was pasted into the `openrouter` slot → silent 401 on first chat.

## Constraints

- **No cloud dependency.** All validation must work offline (Tier 1) or gracefully degrade when offline (Tier 2 timeout → "Save anyway").
- **5s timeout on probes.** Never block save indefinitely.
- **Custom OpenAI-compatible endpoints** skip Tier 2 (out of scope).
- **Never expose key values** in logs, error messages, or round-trip to frontend.
- **TDD:** Every new function/file needs a failing test first (per AGENTS.md).
- **Existing UI patterns must be respected.** The `ApiKeyRow` component (expandable panel with provider picker, key input, Save button) is the entry point — validation should enhance it, not replace it.

## Architecture & Current State

### Current data flow

```
User pastes key → ApiKeyRow (Authentication.tsx)
  → invoke("save_auth_key", { provider, key })
    → Tauri relay (lib.rs)
      → sidecar save_auth handler (index.ts)
        → writes to ~/.pi/agent/auth.json
        → reloads agent
```

No validation occurs at any step.

### Affected files (from issue)

| File | Role | Changes needed |
|---|---|---|
| `src/components/settings/Authentication.tsx` | `ApiKeyRow` component — provider picker + key input + Save button | Wire Tier 1 format check (disable Save + inline hint). Wire Tier 2 via new Tauri command. Add "Save anyway" affordance. |
| `src/components/ProviderAuthSection.tsx` | OAuth sign-in/sign-out component | Currently OAuth-only. Issue mentions it for "per-provider entry" but it may not need API-key validation if that path always routes through `Authentication.tsx`. Needs audit. |
| `agent-sidecar/src/index.ts` | Command dispatcher for sidecar | Add `validate_provider_key` command type + handler. |
| `agent-sidecar/src/providers/key-validator.ts` | **New file** — regex table + probe implementations | Contains all validation logic. Pure functions + HTTP probes. |

### Additional files discovered during codebase audit

| File | Role | Notes |
|---|---|---|
| `agent-sidecar/src/settings-store.ts` | Settings persistence | Not affected by this issue. |
| `agent-sidecar/src/settings-store.test.ts` | Settings store tests | Good reference for test patterns. |
| `src/hooks/useAuth.ts` | `saveApiKey()` hook | Forwards provider + key to Tauri. Already tested (`useAuth.test.ts`). May need a new hook for validation results. |
| `src/types/auth.ts` | Shared auth types | May need new types for validation response. |
| `src-tauri/src/lib.rs` | Tauri command relay | Add `validate_provider_key` Tauri command ~line 880 (next to `save_auth_key`). |

## Implementation Plan

### Phase 1: Sidecar — `key-validator.ts` (Tier 1 + Tier 2)

**File:** `agent-sidecar/src/providers/key-validator.ts`

Build a self-contained module with:

1. **`KEY_FORMATS` constant** — a `Record<string, RegExp>` mapping provider IDs to their expected key format regex:

| Provider | Regex |
|---|---|
| `anthropic` | `/^sk-ant-api03-[0-9a-zA-Z]{16,}$/` |
| `openai` | `/^sk-(proj-)?[0-9a-zA-Z]{20,}$/` |
| `google` / `gemini` | `/^AIza[0-9A-Za-z_-]{35}$/` |
| `openrouter` | `/^sk-or-v1-[0-9a-zA-Z]{16,}$/` |
| `groq` | `/^gsk_[0-9a-zA-Z]{16,}$/` |
| `mistral` | `/^[A-Za-z0-9]{32}$/` |
| `deepseek` | `/^sk-[0-9a-zA-Z]{32,}$/` |
| `xai` | `/^xai-[0-9a-zA-Z]{16,}$/` |
| `opencode-go` | `/^sk-[0-9a-zA-Z]{32,}$/` (TBD — confirm) |

2. **`checkFormat(provider: string, key: string)`** → `{ ok: boolean; expected?: string; hint?: string }`
   - Looks up the provider in `KEY_FORMATS`. If found, tests the regex. Returns `ok` + a human-readable hint.
   - If provider not in table (custom/unknown), returns `{ ok: true }` (skip format check).
   - Never throw. Pure function.

3. **`PROBE_ENDPOINTS` constant** — maps provider IDs to probe function signatures:
   - `openai`/`openrouter`/`opencode-go`: `GET /v1/models` → check 200
   - `anthropic`: `POST /v1/messages` with `max_tokens=1` → check 200
   - `gemini`: `GET /v1beta/models?key=…` → check 200
   - `mistral`: `GET /v1/models` → check 200
   - Others: no probe registered → skip silently

4. **`liveProbe(provider: string, key: string, signal?: AbortSignal)`** → `Promise<{ ok: boolean; status?: number; message?: string }>`
   - Looks up the probe. Hits the endpoint with a 5s timeout (using `AbortSignal` from the caller).
   - HTTP client: use Node's built-in `fetch` (available in Node 22+, which the sidecar targets).
   - Never throw — errors (network, timeout, parse) return `{ ok: false, message }`.
   - **CRITICAL:** Ensure the key is sent as a Bearer token/header, never as a URL query parameter (except Gemini where the API demands `?key=`).

5. **`validateProviderKey(provider: string, key: string, signal?: AbortSignal)`** → `Promise<{ ok: boolean; format?: { ok: boolean; hint?: string }; probe?: { ok: boolean; message?: string } }>`
   - Combines format check + live probe when registered.
   - Format check first (fast path rejection). If format fails, skip probe and return format failure.
   - Returns both results so the UI can show format hint AND probe status.

**Tests:** `agent-sidecar/src/providers/key-validator.test.ts`
- Format check: known providers match, wrong-provider keys fail, unknown providers skip
- Probe: mock `fetch` for successful probe, failed probe, timeout, network error
- Combined: valid key → both pass; format fail → probe skipped; probe fail → format passes, probe fails

### Phase 2: Sidecar — IPC command `validate_provider_key`

**File:** `agent-sidecar/src/index.ts`

1. Add `ValidateProviderKeyCommand` interface to the `Command` union type.
2. Add a case in the `handleCommand` switch (near `save_auth`).
3. Calls `validateProviderKey(provider, key)` and sends the result back.

**Tests:** Integration test through the sidecar's command dispatch (use existing test patterns from `settings-store.test.ts`).

### Phase 3: Tauri relay — `validate_provider_key` command

**File:** `src-tauri/src/lib.rs`

1. Add a `#[tauri::command]` async fn `validate_provider_key(provider: String, key: String, s: State<'_, AppState>) → Result<Value, String>`.
2. Forward to sidecar via `scmd_r()` with a 10s timeout (5s for probe + buffer).
3. Register the command in the builder (near `save_auth_key`).

### Phase 4: Frontend — `ApiKeyRow` validation integration

**File:** `src/components/settings/Authentication.tsx`

1. **Tier 1 — Format check (synchronous, on input change):**
   - On every key input change (or on blur), call a new `checkKeyFormat(provider, key)` function.
   - This could be a simple import from a new frontend-side validator module OR reuse the sidecar's logic via a lightweight isomorphic function.
   - **Decision:** Extract the regex table into a shared module that can be imported both from the frontend (for instant feedback) and the sidecar (for the probe flow). OR duplicate the regex on the frontend (simpler, less coupling). **Prefer duplication** — the regex table is small, static, and changes rarely. The frontend check is cosmetic/UX-only; the sidecar is the source of truth.
   - When format fails: disable Save button, show inline hint "This doesn't look like an `{provider}` key" with the expected prefix.
   - When format passes: enable Save (or proceed to Tier 2).

2. **Tier 2 — Live probe (async, on Save click):**
   - Before calling `save_auth_key`, call `invoke("validate_provider_key", { provider, key })`.
   - Show a loading spinner during probe (5s max).
   - On success (`ok: true`): proceed to save.
   - On failure (`ok: false` but probe completed): show error toast + "Save anyway" button.
   - On timeout/network error: show "Couldn't verify key (no network). Save anyway?" prompt + "Save anyway" button.
   - If user clicks "Save anyway": skip the probe result and call `save_auth_key` directly.

3. **State additions to `ApiKeyRow`:**
   - `formatStatus`: `"unknown"` | `"valid"` | `"invalid"`
   - `formatHint`: string | null
   - `probeStatus`: `"idle"` | `"probing"` | `"valid"` | `"invalid"` | `"error"`
   - `probeMessage`: string | null
   - `showSaveAnyway`: boolean

4. **"Save anyway" affordance:**
   - A small "Save anyway" link/button next to the probe error message.
   - Clicking it persists the key and dismisses the probe result.

**Tests:** `src/components/settings/Authentication.test.tsx` (or augment existing tests)
- Format check: paste wrong key for selected provider → hint shown, save disabled
- Format check: paste right key → hint cleared, save enabled
- Probe success: save proceeds normally
- Probe failure: error shown, "Save anyway" appears
- Probe timeout: network error shown, "Save anyway" appears
- "Save anyway" click: saves key despite probe failure

### Phase 5: Audit `ProviderAuthSection.tsx`

Check whether this component (used in per-provider detail views) should also have the API key validation flow. Currently it only handles OAuth. If per-provider API key entry paths don't exist, no changes needed. If they do, wire the same validation.

## Non-goals

- No retry logic for probes. Fail fast, surface the error.
- No per-key rate limiting in v1.
- Custom OpenAI-compatible endpoints (user-supplied baseURL) skip Tier 2 entirely.
- The latent bug about `Authentication.tsx` hardcoding `opencode-go` (#150) was already fixed — no additional work needed there.

## Test Plan

| Test area | File | What to test |
|---|---|---|
| Key format regexes | `agent-sidecar/src/providers/key-validator.test.ts` | Each provider's regex matches valid keys and rejects invalid ones. Unknown provider skips. |
| Live probe logic | `agent-sidecar/src/providers/key-validator.test.ts` | Mocked fetch for success/failure/timeout/network-error scenarios. Signal propagation. |
| Combined validation | `agent-sidecar/src/providers/key-validator.test.ts` | Format fail → probe skipped. Format pass + probe pass → both ok. Format pass + probe fail → partial result. |
| IPC command | `agent-sidecar/src/index.test.ts` (or similar) | `validate_provider_key` command dispatches correctly. |
| Tauri relay | Integration test (manual or via Rust test) | Command forwarded, response returned. |
| Frontend format check | `src/components/settings/Authentication.test.tsx` | Key input triggers format check. Wrong key → hint + disabled save. Right key → enabled save. |
| Frontend probe flow | `src/components/settings/Authentication.test.tsx` | Save triggers probe. Loading state. Success → save proceeds. Failure → "Save anyway" appears. |
| Save anyway flow | `src/components/settings/Authentication.test.tsx` | "Save anyway" bypasses probe result and persists key. |

## Edge Cases

- **Empty key:** Save button disabled (already handled by `!key.trim()`).
- **Key with leading/trailing whitespace:** Trim before checking and saving (already done in `handleSave`).
- **Provider picker changes while key is entered:** Re-run format check with new provider.
- **User edits key after format hint:** Dismiss hint and re-check.
- **Probe in-flight + user clicks Save again:** Prevent double-probe (disable button during probe).
- **Probe in-flight + user closes panel:** Abort signal cancels the HTTP request.
- **Multiple `ApiKeyRow` instances on screen:** Each has independent state (React component already isolated).
- **Offline at launch + paste key:** Tier 1 format check works offline. Tier 2 fails with timeout → "Save anyway" prompt.
- **Unknown provider (not in regex table):** Format check passes silently. Live probe runs if registered, else skipped.
- **Provider key prefix changes upstream:** Regex updates are dropped-in. No code changes needed beyond the table.

## Key Design Decisions

1. **Duplicated regex on frontend + sidecar.** The regex table is small (~10 entries), static, and changes rarely. The frontend uses it for instant UX feedback; the sidecar uses it as the source of truth before the probe. Duplication avoids a round-trip for format checking and keeps the frontend snappy.
2. **`AbortSignal` for probe cancellation.** The sidecar receives an `AbortSignal` (via the IPC command) so the UI can cancel an in-flight probe when the user clicks away.
3. **Probe result is advisory, not blocking.** The user can always "Save anyway" — this handles offline/corp-proxy scenarios gracefully.
4. **Format hint text** should say e.g. "This doesn't look like an OpenRouter key. OpenRouter keys start with `sk-or-v1-`." — specific and actionable.
5. **Format check is advisory, not a blocker.** Provider key generation formats can change — the regex table is a best-effort pattern scan, not a guarantee. Format hints are shown as warnings with a note that saving is still permitted.

## Reference: Test patterns in this repo

- **Sidecar tests:** `vitest` with `environment: "node"`. Pure functions, mocked file I/O via `mkdtempSync`/`rmSync`. See `agent-sidecar/src/settings-store.test.ts`.
- **Frontend tests:** `vitest` + `@testing-library/react`. Mock `@tauri-apps/api/core` for `invoke`. See `src/hooks/useAuth.test.ts`.
- **Frontend component tests:** `vitest` + `@testing-library/react` + `jsdom`. See `src/components/settings/CustomProviderRow.test.tsx`.
