# Issue #276 — Gemini OAuth: client secret not configured guard

**GitHub Issue:** https://github.com/zosmaai/zosma-cowork/issues/276  
**Status:** Open  
**Label:** bug  
**Assignee:** @Shanvit7

---

## Problem

After the Gemini/Google login PR was merged (commit `5072d31`), the provider is
registered unconditionally at startup. In builds where `ANTIGRAVITY_CLIENT_SECRET`
was never injected (the placeholder `__ANTIGRAVITY_CLIENT_SECRET__` is still
present), the provider **appears in the provider list** and the user can click
"Sign in with Google". The moment they do, `runGeminiConsent` detects the
placeholder and immediately throws:

```
Gemini [Google] sign-in isn't configured in this build [missing client secret].
Set ANTIGRAVITY_CLIENT_SECRET.
```

This is a confusing UX — the option is visible but non-functional.

### Root Cause

`agent-sidecar/src/gemini-antigravity/constants.ts` sets:

```ts
export const CLIENT_SECRET =
  process.env.ANTIGRAVITY_CLIENT_SECRET || "__ANTIGRAVITY_CLIENT_SECRET__";
```

`scripts/prebuild.mjs` replaces the placeholder at build time when the secret
is available. When it is NOT available (CI / forks / local dev without the
secret), the placeholder persists at runtime.

`registerGeminiAntigravity()` in `index.ts` currently **does not check** whether
the secret is configured before calling `registerOAuthProvider(provider)`. The
provider is therefore always visible regardless of build environment.

---

## Expected Behaviour (from issue)

Either:
1. **Hide the provider** entirely when the required env var is not set, OR
2. **Show an error only when sign-in is actually attempted** (and keep the
   provider in the list).

**Preferred fix: Option 1** — suppress registration when the secret is missing.
This is cleaner (no dead-end UX path) and aligns with how other conditional
providers behave. Option 2 is an acceptable fallback if Option 1 proves
structurally hard.

---

## Files to Change

| File | Change |
|---|---|
| `agent-sidecar/src/gemini-antigravity/constants.ts` | Export an `isClientSecretConfigured()` helper |
| `agent-sidecar/src/gemini-antigravity/index.ts` | Guard `registerGeminiAntigravity()` with the helper |
| `agent-sidecar/src/gemini-antigravity/oauth.ts` | (unchanged — existing guard is still good as a safety net) |
| `agent-sidecar/src/gemini-antigravity/index.test.ts` | **New** — unit tests (TDD) |

---

## TDD Plan

> Follow the AGENTS.md iron law: write failing tests first, watch them fail,
> then implement.

### Step 1 — Write failing tests

Create `agent-sidecar/src/gemini-antigravity/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We must control the env BEFORE importing the module under test because
// constants.ts reads process.env at module evaluation time.
// Use vi.mock + factory to inject the desired CLIENT_SECRET value.

describe("registerGeminiAntigravity – client secret guard", () => {
  let registerOAuthProvider: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    // Mock the pi-ai oauth registry so we can spy on calls
    registerOAuthProvider = vi.fn();
    vi.mock("@earendil-works/pi-ai/oauth", () => ({
      registerOAuthProvider,
    }));
    vi.mock("../gemini-antigravity/provider.js", () => ({
      registerGeminiApiProvider: vi.fn(),
      PROJECT_HEADER: "x-antigravity-project",
      UPSTREAM_HEADER: "x-antigravity-upstream",
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT register the OAuth provider when CLIENT_SECRET is the build placeholder", async () => {
    // Simulate a build where prebuild.mjs did NOT inject the secret
    vi.stubEnv("ANTIGRAVITY_CLIENT_SECRET", "");
    // constants.ts will fall back to "__ANTIGRAVITY_CLIENT_SECRET__"
    vi.doMock("./constants.js", () => ({
      // spread the real module but override CLIENT_SECRET
      CLIENT_SECRET: "__ANTIGRAVITY_CLIENT_SECRET__",
      CLIENT_ID: "test-client-id",
      PROVIDER_ID: "google-antigravity",
      PROVIDER_NAME: "Gemini (Google)",
      GEMINI_MODELS: [],
      CODE_ASSIST_ENDPOINTS: [],
    }));

    const { registerGeminiAntigravity } = await import("./index.js");
    registerGeminiAntigravity();

    expect(registerOAuthProvider).not.toHaveBeenCalled();
  });

  it("DOES register the OAuth provider when CLIENT_SECRET is a real value", async () => {
    vi.doMock("./constants.js", () => ({
      CLIENT_SECRET: "real-secret-value",
      CLIENT_ID: "test-client-id",
      PROVIDER_ID: "google-antigravity",
      PROVIDER_NAME: "Gemini (Google)",
      GEMINI_MODELS: [],
      CODE_ASSIST_ENDPOINTS: [],
    }));

    const { registerGeminiAntigravity } = await import("./index.js");
    registerGeminiAntigravity();

    expect(registerOAuthProvider).toHaveBeenCalledOnce();
  });

  it("logs a debug message when skipping registration", async () => {
    const consoleSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.doMock("./constants.js", () => ({
      CLIENT_SECRET: "__ANTIGRAVITY_CLIENT_SECRET__",
      CLIENT_ID: "test-client-id",
      PROVIDER_ID: "google-antigravity",
      PROVIDER_NAME: "Gemini (Google)",
      GEMINI_MODELS: [],
      CODE_ASSIST_ENDPOINTS: [],
    }));

    const { registerGeminiAntigravity } = await import("./index.js");
    registerGeminiAntigravity();

    // Some debug output should indicate why registration was skipped
    // (checking stderr because stdout is reserved for the JSON protocol)
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
```

Run and watch ALL three tests fail:

```bash
cd agent-sidecar && npx vitest run src/gemini-antigravity/index.test.ts
```

---

### Step 2 — Implement the fix

#### `agent-sidecar/src/gemini-antigravity/constants.ts`

Add a named export after the `CLIENT_SECRET` line:

```ts
// --- add below the CLIENT_SECRET constant ---

/**
 * Returns true when the client secret is a real injected value.
 * Returns false when the build-time placeholder is still present
 * (i.e. prebuild.mjs did not run or ANTIGRAVITY_CLIENT_SECRET is unset).
 */
export function isClientSecretConfigured(): boolean {
  return Boolean(CLIENT_SECRET) && !CLIENT_SECRET.startsWith("__ANTIGRAVITY");
}
```

#### `agent-sidecar/src/gemini-antigravity/index.ts`

Import the helper and guard the registration:

```ts
// --- change at the top of the file ---
import {
  CLIENT_SECRET,          // ← remove this (no longer needed directly)
  CODE_ASSIST_ENDPOINTS,
  GEMINI_MODELS,
  PROVIDER_ID,
  PROVIDER_NAME,
  isClientSecretConfigured,  // ← add this
} from "./constants.js";

// ... (keep rest of imports) ...

// --- change the registerGeminiAntigravity function ---
export function registerGeminiAntigravity(): void {
  if (registered) return;

  if (!isClientSecretConfigured()) {
    // Log to stderr (stdout is reserved for the JSON protocol).
    process.stderr.write(
      "[gemini-antigravity] Skipping provider registration: " +
      "ANTIGRAVITY_CLIENT_SECRET is not configured in this build.\n"
    );
    return;
  }

  registered = true;
  registerOAuthProvider(provider);
  registerGeminiApiProvider();
}
```

> **Note:** `oauth.ts`'s existing `CLIENT_SECRET.startsWith("__ANTIGRAVITY")`
> guard inside `runGeminiConsent` should be **kept** as a defensive safety net
> for the unlikely case where the provider is registered but the secret somehow
> disappears at runtime. No change required in `oauth.ts`.

---

### Step 3 — Verify tests pass

```bash
cd agent-sidecar && npx vitest run src/gemini-antigravity/index.test.ts
```

All three tests should now be green.

---

### Step 4 — Full test suite

```bash
# From repo root
npm test                          # frontend (Vitest)
cd agent-sidecar && npx tsc --noEmit   # type check
cargo test --workspace            # Tauri relay
```

---

### Step 5 — Manual verification

#### Case A — Secret NOT configured (placeholder build)

```bash
# Ensure env var is unset and no secret file exists
unset ANTIGRAVITY_CLIENT_SECRET
# rm agent-sidecar/antigravity-client-secret  (if it exists)
npm run dev
```

Expected: "Gemini (Google)" does **not** appear in the provider list. No error.
stderr shows the skip message.

#### Case B — Secret IS configured

```bash
ANTIGRAVITY_CLIENT_SECRET=your-real-secret npm run dev
```

Expected: "Gemini (Google)" **appears** in the provider list. Sign-in flow
works normally.

---

## Acceptance Criteria

- [ ] When `ANTIGRAVITY_CLIENT_SECRET` is not set / build placeholder present,
      `registerGeminiAntigravity()` silently skips registration.
- [ ] The provider **does not appear** in the UI provider list in that case.
- [ ] When the secret IS configured, the provider registers and functions
      as before (no regression).
- [ ] `runGeminiConsent`'s existing error guard in `oauth.ts` remains as a
      safety net (no deletion).
- [ ] All 3 new unit tests pass.
- [ ] `tsc --noEmit`, `npm test`, `cargo test --workspace` all pass.
- [ ] No new lint warnings.

---

## Implementation Checklist

- [x] Write failing tests (`index.test.ts`) and watch them fail
- [x] Add `isClientSecretConfigured()` to `constants.ts`
- [x] Guard `registerGeminiAntigravity()` in `index.ts`
- [x] All tests green (9/9)
- [ ] Manual verification (Case A + Case B)
- [x] `tsc --noEmit` clean
- [x] Lint clean (`npx biome check .`)
- [x] Commit: `fix(gemini): skip provider registration when client secret is not configured` (fd5846c)
- [ ] PR references issue #276

---

## Related

- PR `5072d31`: `feat(gemini): "Sign in with Google" provider for Gemini via
  Antigravity / Code Assist`
- `agent-sidecar/src/gemini-antigravity/constants.ts` — env + build-time secret
- `agent-sidecar/src/gemini-antigravity/oauth.ts` — `runGeminiConsent` existing guard
- `agent-sidecar/src/gemini-antigravity/index.ts` — provider registration entry point
- `scripts/prebuild.mjs` — build-time secret injection (do NOT modify)
