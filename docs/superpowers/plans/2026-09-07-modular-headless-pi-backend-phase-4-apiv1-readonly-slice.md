# Modular Headless Pi Backend Phase 4 Implementation Plan — `/api/v1` Discovery and Read-Only Session Slice

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the first `/api/v1` transport: versioned health, capabilities, models, session reads, runtime state, and running-session endpoints as thin adapters over `PiBackend`, plus a typed browser read client, and migrate every read-only browser call to `/api/v1` while all commands, mutations, and streams stay on the unchanged legacy adapters.

**Architecture:** `/api/v1` route handlers live under `web/app/api/v1/**`, are thin adapters that call `PiBackend` methods through the Phase 1 server-only host (`getPiBackend()`), and return the typed envelope `{ data }` / `{ error: { code, message, details? } }` built by two new shared helpers (`web/lib/api-envelope.ts` + the extended `web/lib/backend-error-response.ts` status table). Errors thrown by the Phase 3 services (stable `BackendError` codes) are mapped to the design-doc-documented HTTP statuses in one table. The browser gains a focused versioned read client (`web/lib/api-v1-client.ts`) that centralizes envelope decoding; the three components, `hooks/useAgentSession.ts`, and `MessageView.tsx` swap their read fetches to client methods, keeping mutations (`PATCH`/`DELETE` rename/delete, auto-name, export, `/api/agent/new`, SSE, `/api/agent/[id]` POST commands) on legacy URLs. Route precedence (`/api/v1/agent/running` vs `[id]`) is resolved by explicit static directories plus contract tests.

**Tech Stack:** TypeScript 5, Pi SDK (`@earendil-works/pi-coding-agent`), Node.js test runner + `jiti`, Next.js 16 route handlers + proxy middleware, pnpm.

**Roadmap:** `docs/superpowers/roadmaps/2026-09-07-modular-headless-pi-backend-roadmap.md`

**Phase:** Phase 4: `/api/v1` Discovery and Read-Only Session Slice

---

## Phase-split reconciliation (roadmap vs design doc)

The roadmap splits the versioned migration **by capability**: Phase 4 = read-only discovery + session reads + runtime-state reads + browser read migration; Phase 5 = session creation, core commands (prompt/abort/steer/follow-up/queue), and SSE cutover. The design doc splits it **by transport and client**: its Phase 4 is the full `/api/v1` agent vertical slice *including* events/prompt/abort/steer/follow-up adapters, and its Phase 5 is web-client migration of everything.

**The roadmap is authoritative.** This plan implements ONLY the roadmap's Phase 4 (read-only slice). The design doc's Phase 4/5 "Implementation Phases" section is stale relative to the roadmap and needs a docs-sync edit — see Task 8 Step 6 (separate `docs:` commit, optional but recommended). Consequence for execution: `commandTransports: ["http"]` and `eventTransports: ["sse"]` in `CapabilitiesResponse` advertise transports whose adapters are still Phase 5; they are the approved Phase-1 contract and are kept as-is (they describe the shape of the completed surface, not what Phase 4 ships).

## Phase Boundary

This plan adds the first **read-only** `/api/v1` slice over the existing Phase 3 services and migrates browser reads. It does **not** move, enable, or stub any write/streaming behavior.

**Explicit non-goals — this plan does NOT:**

- Add session creation, session mutation (`PATCH` / `DELETE` / auto-name), prompt/abort/steer/follow-up/queue endpoints, or any `{ accepted: true }`-style command route.
- Add SSE (per-session or running-session), WebSocket/replay, or any streaming transport.
- Add export or Bash plain-text responses.
- Add any non-agent domain (`/api/v1/worktrees`, `/api/v1/files`, `/api/v1/git`, `/api/v1/auth`, `/api/v1/models-config`, `/api/v1/skills`, `/api/v1/plugins`, `/api/v1/app-update`).
- Change `contracts.ts` or `errors.ts` except the single, clearly-scoped Phase-3 ponytail close in Task 1 (two new read-contract codes `entry_not_found` and `thinking_block_not_found`, with its own test commit) — this is the only code change and it is done before the envelope status table needs the full code set.
- Migrate browser *mutations* or *streams*: `SessionSidebar` PATCH/DELETE, `AppShell` auto-name, export link, `/api/agent/new`, the SSE `EventSource` in `useAgentSession.ts`, `sendAgentCommand` in `lib/agent-client.ts`, and `MessageView` bash-output URL stay on legacy URLs (Phase 5).
- Touch the **legacy route handlers at all**. Legacy endpoints remain byte-identical thin adapters over the same backend services; they are *not* migrated (that is Phase 5). Only their wire behavior is asserted to be unchanged by the envelope-task tests.
- Change `web/lib/pi-backend-host.ts`, `web/lib/runtime-state.ts`, `web/packages/pi-backend/runtime.ts` or `runtime-manager.ts`, or the package-boundary rules.

**Explicitly in scope (the roadmap's Phase 4 essentials):** mixed transport is intentional, tested, and coherent — browser READS use `/api/v1`, while all commands/streams continue through the working legacy adapters.

**Phase boundary health:** every legacy endpoint keeps working because nothing about them changes; every migrated read produces identical data through the versioned envelope, and any read that fails at runtime falls back to the same UI state as today (the client throws `ApiV1Error`, callers keep their legacy error semantics; see Task 7 remap table). This leaves the app fully functional with green tests at the end of every task commit.

---

## File Structure

### Create

```
web/lib/api-envelope.ts                  # { data } success envelope + { error } mapping (new)
web/lib/api-v1-client.ts                 # typed browser read client with central envelope decoding
web/app/api/v1/health/route.ts          # GET -> { data: HealthResponse }
web/app/api/v1/capabilities/route.ts    # GET -> { data: CapabilitiesResponse }
web/app/api/v1/models/route.ts          # GET -> { data: ModelsResponse } (same cwd validation as legacy)
web/app/api/v1/sessions/route.ts        # GET -> { data: SessionsResponse } (?force=1 -> invalidate)
web/app/api/v1/sessions/[id]/route.ts   # GET -> { data: SessionDetailsResponse } (?deferThinking&deferMedia)
web/app/api/v1/sessions/[id]/context/route.ts                    # GET -> { data: SessionContext }
web/app/api/v1/sessions/[id]/entries/[entryId]/thinking/route.ts # GET -> { data: { thinking } }
web/app/api/v1/agent/running/route.ts   # GET -> { data: { runningSessionIds } }
web/app/api/v1/agent/[id]/state/route.ts # GET -> { data: { running, state? } }
web/app/api/v1/test-helper.mjs          # jiti factory (aliases "@" and stubs "server-only")
web/app/api/v1/empty-server-only.mjs    # zero-byte module aliased over "server-only" for jiti
# plus one route.test.mjs next to each route file (see per-task lists)
```

### Modify

- `web/lib/backend-error-response.ts` — replace the private `STATUS_BY_CODE` with an exported `Record<BackendErrorCode, number>` covering all codes (Task 1); `backendErrorResponse` keeps legacy `{ error: message }` body and the same statuses for every reachable legacy path.
- `web/packages/pi-backend/contracts.ts` — add `entry_not_found` + `thinking_block_not_found` to the `BackendErrorCode` union (Task 1 ponytail close ONLY; no DTO changes).
- `web/packages/pi-backend/errors.ts` — append the two new codes to `BACKEND_ERROR_CODES` (Task 1).
- `web/packages/pi-backend/sessions.ts` — `getSessionThinking` throws the new codes instead of `session_not_found` for entry/block misses (Task 1; message strings unchanged).
- `web/packages/pi-backend/index.ts` — facade gains `getRunningSessionIds()` and `getAgentState(input)` (Task 5). No other file changes in `packages/**`.
- `web/components/AppShell.tsx` (2 session-list reads), `web/components/SessionSidebar.tsx` (1 session-list read + 1 running-snapshot read), `web/components/ChatWindow.tsx` (1 session-list read), `web/components/MessageView.tsx` (1 thinking read), `web/hooks/useAgentSession.ts` (7 reads: detail + context + state + 5 agent-state + models) — see Task 7 for the exact per-call swap.
- Tests: `web/packages/pi-backend/errors.test.mjs` (code-list remap), `web/packages/pi-backend/sessions.test.mjs` (2 new tests), `web/packages/pi-backend/index.test.mjs` (facade methods), `web/hooks/useAgentSession.test.mjs` (one assertion remap).

### Explicitly unchanged

- `web/lib/pi-backend-host.ts`, `web/lib/runtime-state.ts`, `web/lib/rpc-manager.ts`, `web/lib/session-reader.ts`, `web/lib/models-cache.ts` (seam files), `web/app/api/**` legacy routes (ALL of them, including `agent/[id]/route.ts`, `sessions/[id]/state`, `sessions/[id]/auto-name`, `sessions/[id]/export`), `web/lib/agent-client.ts`, `web/lib/agent-event-stream.ts`, `web/lib/agent-event-connection.ts`, `web/hooks/useAgentSession.ts` (only the read call-swaps from Task 7), `web/components/**` (only Task 7 swaps), `web/proxy.ts`, `web/lib/request-security.ts`.
- Unchanged tests: `lib/agent-client.test.mjs` (command client untouched), `lib/rpc-manager.test.mjs`, `app/api/**` legacy route tests, `packages/pi-backend/contracts.test.mjs` (boundary scan — the facade only adds imports inside the package), `lib/pi-backend-host.test.mjs` (host never imported by components/hooks; `api-v1-client.ts` lives in `lib/`, uses only type imports from `contracts`, so it stays out of the browser bundle).

---

## Pre-flight

- [ ] **Step 1: Verify the Phase 3 baseline**

```bash
cd web && pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm lint
git status --short
git log --oneline -1
```

Expected: **844 tests pass**; `tsc --noEmit` exit 0; `eslint .` exit 0; working tree clean at `5acc1b34f` (`test(web): normalize Phase-4 comment to keep service transport audit clean`).

- [ ] **Step 2: Freeze the envelope/error-map surface**

```bash
cd web
grep -n "export const BACKEND_ERROR_CODES" -A 14 packages/pi-backend/errors.ts
cat lib/backend-error-response.ts
grep -n "BackendErrorCode" packages/pi-backend/contracts.ts | head
```

Expected: 9 codes (`invalid_request`, `access_denied`, `session_not_found`, `session_not_running`, `session_busy`, `prompt_rejected`, `model_not_found`, `startup_failed`, `internal_error`); the Phase 3 compat table (`invalid_request: 400`, `access_denied: 403`, `session_not_found: 404`, `session_not_running: 409`); and the design spec's five documented status rows (400 invalid, 403 denied, 404 not found, 409 busy/invalid runtime state, 500 unexpected). Task 1 replaces the compat table with the complete map below (same statuses for every code a legacy route can actually throw) and closes the ponytail so the map is total over the code union.

| `/api/v1` code (all) | HTTP status |
|---|---:|
| `invalid_request` | 400 |
| `access_denied` | 403 |
| `session_not_found` / `model_not_found` / `entry_not_found` / `thinking_block_not_found` | 404 |
| `session_not_running` / `session_busy` | 409 |
| `prompt_rejected` | 409 — reachable only from Phase 5 command routes; "busy or invalid runtime state" per the design table. Ponytail comment: revisit when commands land. |
| `startup_failed` / `internal_error` | 500 |

- [ ] **Step 3: Inventory legacy read routes → `/api/v1` correspondence, and their consumers**

```bash
cd web
grep -rn '"/api/sessions\|`/api/sessions\|"/api/models\b\|`/api/models\b\|"/api/agent/running\|`/api/agent/running\|`/api/agent/${' components hooks lib --include=*.ts --include=*.tsx | grep -v '\.test\.'
```

Keep the output open. The read-route correspondence Task 7 relies on:

| Legacy read URL | Backend method | `/api/v1` route |
|---|---|---|
| `GET /api/sessions` (+ `?force=1`) | `listSessions({ force })` | `GET /api/v1/sessions` (+ `?force=1`) |
| `GET /api/sessions/[id]?...` | `getSessionDetails` | `GET /api/v1/sessions/[id]` |
| `GET /api/sessions/[id]/context` | `getSessionContext` | `GET /api/v1/sessions/[id]/context` |
| `GET /api/sessions/[id]/entries/[entryId]/thinking` | `getSessionThinking` | `GET /api/v1/sessions/[id]/entries/[entryId]/thinking` |
| `GET /api/agent/running` | `getRunningSessionIds()` (new facade method) | `GET /api/v1/agent/running` |
| `GET /api/agent/[id]` and `GET /api/sessions/[id]/state` (identical `{ running, state }`/`{ running:false }` bodies) | `getAgentState()` (new facade method) | `GET /api/v1/agent/[id]/state` |
| `GET /api/models` | `getModels({ cwd })` | `GET /api/v1/models` |
| health/capabilities | `getPiBackend().getHealth()` / `.getCapabilities()` | `GET /api/v1/health`, `GET /api/v1/capabilities` (new — no legacy URL) |

Consumers (all verified against the tree): `SessionSidebar.tsx:390` (main list + `force` + running-set fallback), `SessionSidebar.tsx:462` (running poll), `AppShell.tsx:516` (workspace restore) and `:749` (hydrate selected), `ChatWindow.tsx:238` (workspace selector), `MessageView.tsx:161` (thinking), `hooks/useAgentSession.ts:468` (loadSession detail), `:497` (loadSession state), `:530` (loadContext), `:833` (event-stream-idle checkServerIdle), `:908` (waitForPromptSettlement), `:935` (waitForBashSettlement), `:961` (reconcileAgentState), `:1053` (`agent_end` state read), `:1524` (loadModels). Keep on legacy (mutations/streams stay legacy): `AppShell.tsx:846/960`, `SessionSidebar.tsx:2075/2091`, `MessageView.tsx:1550`, `hooks/useAgentSession.ts:352/590`, `lib/agent-client.ts:32`.

- [ ] **Step 4: Find source-scan tests that could be affected**

```bash
cd web
grep -rn 'readFile(new URL' hooks/useAgentSession.test.mjs hooks/model-scope-startup.test.mjs lib/rpc-manager.test.mjs
```

Precisely: `hooks/useAgentSession.test.mjs` test **"keeps the session event stream open through the idle grace window"** asserts `assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/)` on the `scheduleEventStreamClose` slice — this breaks in Task 7 and is remapped to `getAgentState(sid)` (see Task 7 Step 4). `hooks/model-scope-startup.test.mjs` asserts only body-level tokens of `loadModels` (`if (isNew && !sessionIdRef.current)`, `thinkingLevelOverrideRef.current === null`, `setThinkingLevel((pinned ...) ?? "auto")`) — those survive Task 7 because the swap is fetch→client call at the top of the same body (verified below). `lib/rpc-manager.test.mjs` scans legacy route files that Task 7 does not touch. No other test scans migrated URLs.

- [ ] **Step 5: Back up the move sources**

```bash
cd web
cp lib/backend-error-response.ts /tmp/backend-error-response.ts.orig
cp lib/agent-client.ts /tmp/agent-client.ts.orig
for f in components/AppShell.tsx components/SessionSidebar.tsx components/ChatWindow.tsx components/MessageView.tsx hooks/useAgentSession.ts; do
  cp "$f" "/tmp/$(basename $f .tsx).orig.tsx"; done
cp hooks/useAgentSession.ts /tmp/useAgentSession.orig.ts
```

- [ ] **Step 6: Confirm proxy coverage and the design-spec acceptance gates**

```bash
cd web
cat proxy.ts
grep -n '"/api/:path*"' proxy.ts
```

Expected: `proxy.ts` matcher `["/", "/api/:path*"]` guards every `/api/*` — `/api/v1/*` automatically inherits same-origin host validation and the optional Basic auth. No proxy change. Also note the design spec's acceptance criteria that apply here: v1 routes are thin adapters over the one host-managed backend instance; responses/errors follow the typed envelopes; no new runtime dependency; auth/security behavior unchanged.

---

### Task 1: Close the Phase-3 thinking-code ponytail and add the shared `/api/v1` envelope + error-status map

Two commits. Commit 1 closes the ponytail so the status map (commit 2) can be total over the 11-code union without a dangling reference. Keep each commit green.

**Files:**
- Modify: `web/packages/pi-backend/contracts.ts`, `web/packages/pi-backend/errors.ts`, `web/packages/pi-backend/sessions.ts`, `web/packages/pi-backend/errors.test.mjs`, `web/packages/pi-backend/sessions.test.mjs`
- Create: `web/lib/api-envelope.ts`, `web/lib/api-envelope.test.mjs`
- Modify: `web/lib/backend-error-response.ts`

- [ ] **Step 1: Write the failing test for the new codes**

In `web/packages/pi-backend/errors.test.mjs`, replace the second test's expected array with the 11-code list:

```js
test("backend error codes match the approved v1 contract", () => {
  assert.deepEqual(BACKEND_ERROR_CODES, [
    "invalid_request",
    "access_denied",
    "session_not_found",
    "session_not_running",
    "session_busy",
    "prompt_rejected",
    "model_not_found",
    "startup_failed",
    "internal_error",
    "entry_not_found",
    "thinking_block_not_found",
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/errors.test.mjs
```

Expected: FAIL — `actual: ["invalid_request",...,"internal_error"]` vs `expected: [...,"entry_not_found","thinking_block_not_found"]`.

- [ ] **Step 3: Write the two failing service tests**

Append to `web/packages/pi-backend/sessions.test.mjs` (it already has `getSessionThinking` fixtures — `writeSession`, `cacheSessionPath`, `rmSync` cleanup; reuse `resetListState()`):

```js
test("getSessionThinking rejects a missing assistant entry as entry_not_found", async () => {
  resetListState();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-entry-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "thinking-session");
    cacheSessionPath("thinking-session", filePath);
    await assert.rejects(
      getSessionThinking({ sessionId: "thinking-session", entryId: "missing-entry", blockIndex: 0 }),
      (error) => error instanceof Error
        && error.code === "entry_not_found"
        && error.message === "Assistant message not found",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionThinking rejects a non-thinking block as thinking_block_not_found", async () => {
  resetListState();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-block-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(
      filePath,
      `${JSON.stringify({ type: "session", version: 3, id: "thinking-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n${JSON.stringify({
        type: "message",
        id: "a1",
        timestamp: "2026-01-01T00:00:00.100Z",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: "2026-01-01T00:00:00.100Z" },
      })}\n`,
    );
    cacheSessionPath("thinking-session", filePath);
    await assert.rejects(
      getSessionThinking({ sessionId: "thinking-session", entryId: "a1", blockIndex: 0 }),
      (error) => error instanceof Error
        && error.code === "thinking_block_not_found"
        && error.message === "Thinking block not found",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `cd web && node --experimental-strip-types --test packages/pi-backend/sessions.test.ts`
Expected: FAIL with `TypeError: error.code is undefined` (service still throws `" not found` `session_not_found`).

- [ ] **Step 5: Implement the code changes**

`web/packages/pi-backend/contracts.ts` — `BackendErrorCode` union:

```ts
export type BackendErrorCode =
  | "invalid_request"
  | "access_denied"
  | "session_not_found"
  | "session_not_running"
  | "session_busy"
  | "prompt_rejected"
  | "model_not_found"
  | "entry_not_found"
  | "thinking_block_not_found"
  | "startup_failed"
  | "internal_error";
```

`web/packages/pi-backend/errors.ts` — append the two codes to `BACKEND_ERROR_CODES` (keep the existing nine in their current order; append after `model_not_found`):

```ts
export const BACKEND_ERROR_CODES = [
  "invalid_request",
  "access_denied",
  "session_not_found",
  "session_not_running",
  "session_busy",
  "prompt_rejected",
  "model_not_found",
  "entry_not_found",
  "thinking_block_not_found",
  "startup_failed",
  "internal_error",
] as const satisfies readonly BackendErrorCode[];
```

`web/packages/pi-backend/sessions.ts` — `getSessionThinking`, replace the two ponytail throws (and delete the ponytail comment):

```ts
  if (!entry || entry.type !== "message" || entry.message.role !== "assistant") {
    throw new BackendError("entry_not_found", "Assistant message not found");
  }

  const block = entry.message.content[blockIndex];
  if (!block || block.type !== "thinking") {
    throw new BackendError("thinking_block_not_found", "Thinking block not found");
  }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/errors.test.mjs packages/pi-backend/sessions.test.mjs
pnpm exec tsc --noEmit
```

Expected: PASS for the code-list and the two new `sessions` tests; `rpc-manager` legacy thinking route still passes (message strings unchanged, so legacy `{ error: message }` bodies are byte-identical); `tsc` exit 0. The existing `sessions.test.mjs` "rejects unknown sessions as `session_not_found`" test is untouched — unknown *sessions* still map to `session_not_found`; only *entry/block* misses get the precise codes.

- [ ] **Step 7: Commit**

```bash
git add web/packages/pi-backend/contracts.ts web/packages/pi-backend/errors.ts web/packages/pi-backend/sessions.ts web/packages/pi-backend/errors.test.mjs web/packages/pi-backend/sessions.test.mjs
git commit -m "refactor(web): assign precise read-contract codes for thinking reads"
```

- [ ] **Step 8: Write the failing envelope tests (commit 2)**

Create `web/lib/api-envelope.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { BackendError } from "../packages/pi-backend/errors";
import { STATUS_BY_CODE } from "./backend-error-response";
import { apiSuccess, apiErrorResponse } from "./api-envelope";
```

Wait — the jiti-imported `BackendError` from `./errors` must be the same class identity the mapper checks. Use jiti for everything, exactly like the other package tests:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { apiSuccess, apiErrorResponse } = await jiti.import("./api-envelope.ts");
const { BackendError } = await jiti.import("../packages/pi-backend/errors.ts");
const { STATUS_BY_CODE } = await jiti.import("./backend-error-response.ts");

test("apiSuccess wraps any payload in { data } and forwards status/headers", async () => {
  const res = apiSuccess({ sessions: [], runningSessionIds: [] }, { headers: { "Cache-Control": "no-store" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.deepEqual(body, { data: { sessions: [], runningSessionIds: [] } });
});

test("apiErrorResponse maps every backend code to the documented status", async () => {
  const expectations = [
    ["invalid_request", 400],
    ["access_denied", 403],
    ["session_not_found", 404],
    ["model_not_found", 404],
    ["entry_not_found", 404],
    ["thinking_block_not_found", 404],
    ["session_not_running", 409],
    ["session_busy", 409],
    ["prompt_rejected", 409],
    ["startup_failed", 500],
    ["internal_error", 500],
  ];
  for (const [code, status] of expectations) {
    const res = apiErrorResponse(new BackendError(code, "boom"));
    assert.equal(res.status, status, code);
    const body = await res.json();
    assert.deepEqual(body, { error: { code, message: "boom" } }, code);
  }
});

test("apiErrorResponse emits details only when present", async () => {
  const withDetails = apiErrorResponse(new BackendError("internal_error", "boom", { retryable: false }));
  assert.deepEqual(await withDetails.json(), { error: { code: "internal_error", message: "boom", details: { retryable: false } } });
  const without = apiErrorResponse(new BackendError("internal_error", "boom"));
  assert.deepEqual(await without.json(), { error: { code: "internal_error", message: "boom" } });
});

test("apiErrorResponse maps unknown failures to internal_error 500", async () => {
  const res = apiErrorResponse(new Error("raw"));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: "internal_error", message: "raw" } });
});

test("STATUS_BY_CODE is total over the contract code union", () => {
  const expectedCodes = new Set([
    "invalid_request", "access_denied", "session_not_found", "session_not_running",
    "session_busy", "prompt_rejected", "model_not_found", "entry_not_found",
    "thinking_block_not_found", "startup_failed", "internal_error",
  ]);
  assert.deepEqual(new Set(Object.keys(STATUS_BY_CODE)), expectedCodes);
});
```


- [ ] **Step 9: Run them to verify they fail**

Run: `cd web && node --experimental-strip-types --test lib/api-envelope.test.mjs`
Expected: FAIL — `api-envelope.ts` does not exist (module not found).

- [ ] **Step 10: Implement the envelope helpers**

`web/lib/backend-error-response.ts` — replace the private table and keep legacy behavior byte-identical (see below):

```ts
import { NextResponse } from "next/server";
import { isBackendError } from "@/packages/pi-backend/errors";
import type { BackendErrorCode } from "@/packages/pi-backend/contracts";

// /api/v1 documented status mapping (design spec: "Routes map errors
// consistently"): 400 invalid, 403 denied, 404 session/model/entry/block not
// found, 409 busy/invalid runtime, 500 unexpected.
export const STATUS_BY_CODE: Record<BackendErrorCode, number> = {
  invalid_request: 400,
  access_denied: 403,
  session_not_found: 404,
  model_not_found: 404,
  entry_not_found: 404,
  thinking_block_not_found: 404,
  session_not_running: 409,
  session_busy: 409,
  prompt_rejected: 409, // reachable only via Phase 5 command routes; maps to "busy or invalid runtime state"
  startup_failed: 500,
  internal_error: 500,
};

export function backendErrorResponse(error: unknown): NextResponse | null {
  if (!isBackendError(error)) return null;
  return NextResponse.json(
    { error: error.message },
    { status: STATUS_BY_CODE[error.code] ?? 500 },
  );
}
```

> The only behavior change for legacy consumers is that a legacy-thrown `model_not_found`, `session_busy`, `prompt_rejected`, `startup_failed`, `entry_not_found`, or `thinking_block_not_found` would now map to its documented status instead of the 500 fallback. Today **no legacy route throws any of these through `backendErrorResponse`** (route bodies show only `invalid_request`/`session_not_found`/`session_not_running`/`internal_error`; the agent POST route returns `prompt_rejected` raw, unchanged). `entry_not_found`/`thinking_block_not_found` (legacy `session_not_found` code) rewrite to 404 — same status + same message. So the legacy wire is byte-identical; the v1-wire ever changes.

`web/lib/api-envelope.ts` (new):

```ts
import { NextResponse } from "next/server";
import { isBackendError } from "@/packages/pi-backend/errors";
import { STATUS_BY_CODE } from "./backend-error-response";

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (isBackendError(error)) {
    const body = {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
    return NextResponse.json(
      { error: body },
      { status: STATUS_BY_CODE[error.code] ?? 500 },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      },
    },
    { status: 500 },
  );
}
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `cd web && node --experimental-strip-types --test lib/api-envelope.test.mjs`
Expected: PASS for all five tests.

- [ ] **Step 12: Prove the legacy wire is unchanged**

```bash
cd web
pnpm test lib/session-reader.test.mjs lib/models-cache.test.mjs lib/rpc-manager.test.mjs app/api/sessions app/api/agent 2>&1 | tail -4
git diff --stat
```

Expected: the legacy session suite stays green; only the 5 files from Task 1 appear in `git diff --stat`.

- [ ] **Step 13: Commit**

```bash
git add web/lib/backend-error-response.ts web/lib/api-envelope.ts web/lib/api-envelope.test.mjs
git commit -m "feat(web): add shared /api/v1 envelope and error-status mapping"
```

---

### Task 2: `/api/v1/health` + `/api/v1/capabilities` thin adapters and their test scaffolding

**Files:**
- Create: `web/app/api/v1/test-helper.mjs`, `web/app/api/v1/empty-server-only.mjs`, `web/app/api/v1/health/route.ts`, `web/app/api/v1/health/route.test.mjs`, `web/app/api/v1/capabilities/route.ts`, `web/app/api/v1/capabilities/route.test.mjs`

- [ ] **Step 1: Create the shared jiti scaffolding**

`web/app/api/v1/empty-server-only.mjs` — an empty file (zero bytes). `web/app/api/v1/test-helper.mjs`:

```js
// jiti factory for /api/v1 route tests. The `server-only` package is a
// Next.js build alias that does not resolve under plain node/jiti; alias it
// to an empty module so routes can import `getPiBackend()` unchanged.
import { createJiti } from "jiti";

const EMPTY_SERVER_ONLY = new URL("./empty-server-only.mjs", import.meta.url).href;

export function createV1Jiti() {
  return createJiti(import.meta.url, {
    alias: { "@": process.cwd(), "server-only": EMPTY_SERVER_ONLY },
    interopDefault: true,
    moduleCache: false,
  });
}
```

- [ ] **Step 2: Write the failing health route test**

`web/app/api/v1/health/route.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/health returns the typed envelope and starts no Pi runtime", async () => {
  // A truly blank registry proves the adapter never constructs a runtime.
  globalThis.__piSessions = undefined;
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.apiVersion, "v1");
  assert.equal(typeof body.data.piVersion, "string");
  assert.equal(body.error, undefined);
  assert.equal(globalThis.__piSessions, undefined);
});
```

- [ ] **Step 3: Write the failing capabilities test**

`web/app/api/v1/capabilities/route.test.mjs` mirrors the health test:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/capabilities advertises the typed transports and features", async () => {
  globalThis.__piSessions = undefined;
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.data, {
    apiVersion: "v1",
    commandTransports: ["http"],
    eventTransports: ["sse"],
    features: {
      concurrentSessions: true,
      prompt: true,
      abort: true,
      steering: true,
      followUp: true,
      sessionBranches: true,
      bash: true,
      extensions: true,
    },
  });
  assert.equal(globalThis.__piSessions, undefined);
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `cd web && node --experimental-strip-types --test app/api/v1/health/route.test.mjs app/api/v1/capabilities/route.test.mjs`
Expected: FAIL with module-not-found for `./route.ts`.

- [ ] **Step 5: Implement the routes**

`web/app/api/v1/health/route.ts`:

```ts
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiSuccess(await getPiBackend().getHealth());
}
```

`web/app/api/v1/capabilities/route.ts`:

```ts
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiSuccess(await getPiBackend().getCapabilities());
}
```

- [ ] **Step 6: Run to verify they pass, then commit**

Run: `cd web && node --experimental-strip-types --test app/api/v1/health/route.test.mjs app/api/v1/capabilities/route.test.mjs; pnpm exec tsc --noEmit`
Expected: both pass; `tsc` exit 0.

```bash
git add web/app/api/v1
git commit -m "feat(web): add /api/v1 health and capabilities adapters"
```

---

### Task 3: `/api/v1/models` thin adapter

**Files:**
- Create: `web/app/api/v1/models/route.ts`, `web/app/api/v1/models/route.test.mjs`

- [ ] **Step 1: Write the failing tests**

`web/app/api/v1/models/route.test.mjs` (mirrors the legacy models route's cwd validation but pushes failures through `BackendError` → envelope):

```js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/models returns the model catalog under { data }", async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-v1-models-"));
  try {
    const res = await GET(new Request(`http://localhost/api/v1/models?cwd=${encodeURIComponent(dir)}`));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data.modelList));
    assert.equal(typeof body.data.models, "object");
    assert.equal(typeof body.data.thinkingLevels, "object");
    assert.equal(body.error, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/v1/models rejects a missing cwd with invalid_request 400", async () => {
  const missing = join(tmpdir(), "definitely-not-a-dir-xyz");
  const res = await GET(new Request(`http://localhost/api/v1/models?cwd=${encodeURIComponent(missing)}`));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "invalid_request");
  assert.match(body.error.message, /^Directory does not exist:/);
});

test("GET /api/v1/models rejects a non-directory cwd with invalid_request 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-v1-models-file-"));
  const filePath = join(dir, "file.txt");
  writeFileSync(filePath, "x");
  try {
    const res = await GET(new Request(`http://localhost/api/v1/models?cwd=${encodeURIComponent(filePath)}`));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "invalid_request");
    assert.match(body.error.message, /^Not a directory:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

> The legacy `access_denied` branch (403) requires an allowed-roots configuration state that is awkward to drive in a route test; its status mapping is proven by the Task 1 envelope test (code → 403), and the legacy models route itself stays covered by its own behavior.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && node --experimental-strip-types --test app/api/v1/models/route.test.mjs`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

`web/app/api/v1/models/route.ts` — mirror the legacy models route, but throw `BackendError`s so the envelope maps them, and only map output:

```ts
import { stat } from "fs/promises";
import { resolve } from "path";
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { BackendError } from "@/packages/pi-backend/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
    const cwd = resolve(requestedCwd);

    let cwdStat;
    try {
      cwdStat = await stat(cwd);
    } catch {
      throw new BackendError("invalid_request", `Directory does not exist: ${cwd}`);
    }
    if (!cwdStat.isDirectory()) {
      throw new BackendError("invalid_request", `Not a directory: ${cwd}`);
    }
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      throw new BackendError("access_denied", "Access denied");
    }

    return apiSuccess(await getPiBackend().getModels({ cwd }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
```

- [ ] **Step 4: Run to verify, then commit**

Run: `cd web && node --experimental-strip-types --test app/api/v1/models/route.test.mjs; pnpm exec tsc --noEmit`
Expected: 3 pass; `tsc` exit 0.

```bash
git add web/app/api/v1/models
git commit -m "feat(web): add /api/v1 models adapter"
```

---

### Task 4: `/api/v1` session list, detail, context, and deferred-thinking adapters

**Files:**
- Create: `web/app/api/v1/sessions/route.ts`, `web/app/api/v1/sessions/route.test.mjs`, `web/app/api/v1/sessions/[id]/route.ts`, `web/app/api/v1/sessions/[id]/route.test.mjs`, `web/app/api/v1/sessions/[id]/context/route.ts`, `web/app/api/v1/sessions/[id]/context/route.test.mjs`, `web/app/api/v1/sessions/[id]/entries/[entryId]/thinking/route.ts`, `web/app/api/v1/sessions/[id]/entries/[entryId]/thinking/route.test.mjs`

The four route handlers are read-only mirrors of the legacy session routes; they differ only in calling `getPiBackend()` methods and wrapping `{ data }` / `apiErrorResponse`.

- [ ] **Step 1: Implement the list route and its test**

`web/app/api/v1/sessions/route.ts`:

```ts
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    return apiSuccess(await getPiBackend().listSessions({ force }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
```

`web/app/api/v1/sessions/route.test.mjs` — the list route needs a real (temp) agent dir with one session so it returns deterministic data. Mirror `packages/pi-backend/sessions.test.ts` fixtures (write a `session.jsonl`, `cacheSessionPath`, reset list state):

```js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createV1Jiti } from "../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);
const { cacheSessionPath } = await jiti.import("../../../../packages/pi-backend/sessions.ts");

function resetListState() {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListPromise = undefined;
  globalThis.__piSessionListPromiseGeneration = undefined;
  globalThis.__piSessionListGeneration = 0;
}

test("GET /api/v1/sessions returns the list under { data } with no-store", async () => {
  resetListState();
  const dir = mkdtempSync(join(tmpdir(), "api-v1-sessions-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({
      type: "session", version: 3, id: "v1-list-session",
      timestamp: "2026-01-01T00:00:00.000Z", cwd: dir,
    })}\n`);
    cacheSessionPath("v1-list-session", filePath);
    const res = await GET(new Request("http://localhost/api/v1/sessions"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const body = await res.json();
    assert.ok(Array.isArray(body.data.sessions));
    assert.ok(Array.isArray(body.data.runningSessionIds));
    assert.ok(body.data.sessions.some((s) => s.id === "v1-list-session"));
    assert.equal(body.error, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

> The fixture writes a header-only JSONL. `listSessions` is the existing service (covered exhaustively by `packages/pi-backend/sessions.test.mjs`); this route test only proves the v1 adapter wires the envelope, so keep the assertions shape-only.

- [ ] **Step 2: Fail → pass for the list route**

```bash
cd web && node --experimental-strip-types --test app/api/v1/sessions/route.test.mjs
```

Expected first: FAIL (no route); after writing the route: PASS.

- [ ] **Step 3: Detail route + legacy parity test**

`web/app/api/v1/sessions/[id]/route.ts`:

```ts
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const searchParams = new URL(req.url).searchParams;
    const data = await getPiBackend().getSessionDetails({
      sessionId: id,
      deferThinking: searchParams.has("deferThinking"),
      deferMedia: searchParams.has("deferMedia"),
    });
    return apiSuccess(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
```

`web/app/api/v1/sessions/[id]/route.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createV1Jiti } from "../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);
const { cacheSessionPath } = await jiti.import("../../../../../packages/pi-backend/sessions.ts");

function rebuildParams(sessionId) {
  return { params: Promise.resolve({ id: sessionId }) };
}

test("GET /api/v1/sessions/[id] returns details in { data } with defer flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-v1-detail-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({
      type: "session", version: 3, id: "detail-session",
      timestamp: "2026-01-01T00:00:00.000Z", cwd: dir,
    })}\n${JSON.stringify({
      type: "message", id: "m1", timestamp: "2026-01-01T00:00:00.100Z",
      message: { role: "user", content: "hello" },
    })}\n`);
    cacheSessionPath("detail-session", filePath);
    const res = await GET(new Request("http://localhost/api/v1/sessions/detail-session?deferThinking=1&deferMedia=1"), rebuildSession("detail-session"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.sessionId, "detail-session");
    assert.equal(body.data.info.id, "detail-session");
    assert.ok(Array.isArray(body.data.context.messages));
    assert.equal(body.error, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/v1/sessions/[id] maps a missing session to session_not_found 404", async () => {
  const res = await GET(new Request("http://localhost/api/v1/sessions/nope"), rebuildSession("nope"));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
  assert.equal(body.error.message, "Session not found");
});
```

- [ ] **Step 4: Context route + test**

`web/app/api/v1/sessions/[id]/context/route.ts`:

```ts
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  try {
    const context = await getPiBackend().getSessionContext({
      sessionId: id,
      leafId: url.searchParams.get("leafId") ?? undefined,
      deferThinking: url.searchParams.has("deferThinking"),
      deferMedia: url.searchParams.has("deferMedia"),
    });
    return apiSuccess(context);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
```

`context/route.test.mjs` (shape-only; same fixture pattern as the detail test): assert `body.data.messages`, `body.data.entryIds` present, `body.error` undefined for an existing session; 404 for missing.

- [ ] **Step 5: Thinking route + test**

`web/app/api/v1/sessions/[id]/entries/[entryId]/thinking/route.ts`:

```ts
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  try {
    const data = await getPiBackend().getSessionThinking({
      sessionId: id,
      entryId,
      blockIndex: blockIndexParam === null ? Number.NaN : Number(blockIndexParam),
    });
    return apiSuccess(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
```

`thinking/route.test.mjs`: two tests — (1) a session with an assistant entry containing a thinking block at index 0 returns `{ data: { thinking: "..." } }`; (2) a missing block returns `{ error: { code: "thinking_block_not_found", ... } }` status 404 (fixture = the assistant-text entry from Task 1, no thinking block).

- [ ] **Step 6: Run the four route tests + `tsc` + `lint`, then commit**

```bash
cd web && node --experimental-strip-types --test app/api/v1/sessions
pnpm exec tsc --noEmit
pnpm lint
```

Expected: all session route tests, `tsc`, `lint` green.

```bash
git add web/app/api/v1/sessions
git commit -m "feat(web): add /api/v1 session read adapters"
```

---

### Task 5: `/api/v1/agent` running snapshot and per-session state adapters (facade methods over the runtime manager)

**Files:**
- Modify: `web/packages/pi-backend/index.ts` (add `getRunningSessionIds` + `getAgentState`)
- Modify: `web/packages/pi-backend/index.test.mjs` (facade tests)
- Create: `web/app/api/v1/agent/running/route.ts` + `route.test.mjs`, `web/app/api/v1/agent/[id]/state/route.ts` + `route.test.mjs`

- [ ] **Step 1: Write the failing facade tests**

Append to `web/packages/pi-backend/index.test.mjs`:

```js
test("PiBackend.getRunningSessionIds delegates to the runtime manager", async () => {
  const state = { registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() };
  state.registry.set("idle-session", { isAlive: () => true, isRunning: () => true, sessionId: "idle-session", cwd: "/tmp" });
  const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager(state, async () => { throw new Error("factory unused"); }) });
  assert.deepEqual(await backend.getRunningSessionIds(), ["idle-session"]);
});

test("PiBackend.getAgentState reports live state, running:false, or session_not_found", async () => {
  const state = { registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() };
  state.registry.set("live-session", {
    isAlive: () => true,
    send: async () => ({ model: { id: "m", provider: "p" }, messageCount: 3 }),
    sessionId: "live-session",
  });
  const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager(state, async () => { throw new Error("factory unused"); }) });
  const live = await backend.getAgentState({ sessionId: "live-session" });
  assert.equal(live.running, true);
  assert.equal(live.state.messageCount, 3);
});

test("PiBackend.getAgentState uses path existence to distinguish idle from missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-state-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({ type: "session", version: 3, id: "cold-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n`);
    cacheSessionPath("cold-session", filePath);
    globalThis.__piSessionListCache = undefined;
    globalThis.__piSessionListGeneration = 0;
    const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager({ registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() }, async () => { throw new Error("factory unused"); }) });
    const idle = await backend.getAgentState({ sessionId: "cold-session" });
    assert.deepEqual(idle, { running: false });
    await assert.rejects(
      backend.getAgentState({ sessionId: "no-such-session" }),
      (error) => error instanceof Error && error.code === "session_not_found" && error.message === "Session not found",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /web && node --experimental-strip-types --test packages/pi-backend/index.test.mjs`
Expected: FAIL — `getRunningSessionIds`/`getAgentState` not found on `PiBackend` interface (`TypeError: backend.getRunningSessionIds is not a function`).

- [ ] **Step 3: Implement the facade methods**

Add to `web/packages/pi-backend/index.ts` imports: `resolveSessionPath` from `./sessions` (already imported in that module position? no — add it), `BackendError` is already imported from `./errors`, `AgentStateResponse` type import. The `PiBackend` interface gains:

```ts
  getRunningSessionIds(): Promise<string[]>;
  getAgentState(
    input: SessionIdInput,
  ): Promise<{ running: boolean; state?: AgentStateResponse }>;
```

and the factory gains (mirroring the legacy `sessions/[id]/state` get path + the `agent/[id]/route` GET path, which are the canonical read semantics):

```ts
    async getRunningSessionIds() {
      return runtime().getRunningSessionIds();
    },
    async getAgentState(input) {
      const manager = runtime();
      const session = manager.getSession(input.sessionId);
      if (session?.isAlive()) {
        return { running: true, state: await session.send({ type: "get_state" }) as AgentStateResponse };
      }
      if (!(await resolveSessionPath(input.sessionId))) {
        throw new BackendError("session_not_found", "Session not found");
      }
      return { running: false };
    },
```

Also add `resolveSessionPath` to the `./sessions` import list and `AgentStateResponse` to the `./contracts` type-import list. The `send({ type: "get_state" })` call (`AgentSessionWrapper.send`) must **not** be imported from the services; it stays on the wrapper (exact legacy behavior — the session identity comes in via the input channel, no inference).

- [ ] **Step 4: Run to verify, then `tsc`**

Run: `cd web && node --experimental-strip-types --test packages/pi-backend/index.test.mjs; pnpm exec tsc --noEmit`
Expected: 3 tests; `tsc` exit 0.

- [ ] **Step 5: Running-snapshot route + test**

`web/app/api/v1/agent/running/route.ts`:

```ts
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess } from "@/lib/api-envelope";

export const dynamic = "force-dynamic";

export async function GET() {
  const runningSessionIds = await getPiBackend().getRunningSessionIds();
  return apiSuccess({ runningSessionIds }, { headers: { "Cache-Control": "no-store" } });
}
```

`web/app/api/v1/agent/running/route.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/agent/running returns the snapshot under { data }", async () => {
  // Fresh registry so the snapshot is deterministic (the route process has none).
  globalThis.__piSessions = new Map();
  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.ok(Array.isArray(body.data.runningSessionIds));
  assert.equal(body.error, undefined);
  delete globalThis.__piSessions;
});
```

- [ ] **Step 6: Per-session state route + test**

`web/app/api/v1/agent/[id]/state/route.ts`:

```ts
import { getPiBackend } from "@/lib/pi-backend-host";
import { apiSuccess, apiErrorResponse } from "@/lib/api-envelope";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await getPiBackend().getAgentState({ sessionId: id });
    return apiSuccess(data);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
```

`web/app/api/v1/agent/[id]/state/route.test.mjs` — three cases mirroring the facade test: live registry entry → `{ data: { running: true, state: {...} } }`; cold session on disk → `{ data: { running: false } }`; unknown → `{ error: { code: "session_not_found" } }` 404. Use the same `writeSession`/`cacheSessionPath` fixture helpers from the detail test (extract them to `web/app/api/v1/sessions/_fixtures.mjs` if you prefer — duplication is acceptable here to keep tasks atomic).

- [ ] **Step 7: Route-precedence contract test**

The one structural risk in this task: `running` vs `[id]`. Next.js resolves a static segment over a dynamic one, so `/api/v1/agent/running` never reaches the `[id]` directory — but a future refactor could delete the static dir and capture `"running"` as an id. Add `web/app/api/v1/agent/route-precedence.test.mjs` that pins the requirement as a filesystem + export contract (Next.js routing itself is exercised by the dev smoke test in Task 8):

```js
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const agentDir = fileURLToPath(new URL("./", import.meta.url));

test("agent namespace separates the static running route from dynamic state routes", async () => {
  const entries = await readdir(agentDir, { withFileTypes: true });
  assert.ok(entries.some((e) => e.isDirectory() && e.name === "running"), "static running directory exists");
  assert.ok(entries.some((e) => e.isDirectory() && e.name === "[id]"), "dynamic [id] directory exists");
  const runningRoute = await readFile(join(agentDir, "running/route.ts"), "utf8");
  const stateRoute = await readFile(join(agentDir, "[id]/state/route.ts"), "utf8");
  assert.match(runningRoute, /getRunningSessionIds\(\)/);
  assert.doesNotMatch(runningRoute, /getAgentState\(/);
  assert.match(stateRoute, /getAgentState\(/);
  // No bare `[id]/route.ts` exists at the agent root, so an id can never be "running".
  await assert.rejects(stat(join(agentDir, "[id]/route.ts")));
});
```

- [ ] **Step 8: Run all agent tests, `tsc`, `lint`, commit**

```bash
cd web && node --experimental-strip-types --test app/api/v1/agent packages/pi-backend/index.test.mjs
pnpm exec tsc --noEmit
pnpm lint
```

```bash
git add web/packages/pi-backend/index.ts web/packages/pi-backend/index.test.mjs web/app/api/v1/agent
git commit -m "feat(web): add /api/v1 agent state and running-session adapters"
```

---

### Task 6: Versioned browser read client with centralized envelope decoding

**Files:**
- Create: `web/lib/api-v1-client.ts`, `web/lib/api-v1-client.test.mjs`

The design doc's "browser client" requirement is met here: one module owns envelope decoding, so components/hooks never branch on the wire shape (Task 7 risk item "envelope migration altering hook assumptions" is preempted).

- [ ] **Step 1: Write the failing client tests**

`web/lib/api-v1-client.test.mjs` (mock `globalThis.fetch`; assert decode + error):a

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { ApiV1Error, listSessions, getSessionDetails, getSessionThinking, getRunningSessionIds, getAgentState, getModels } = await jiti.import("./api-v1-client.ts");

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test("api-v1 client decodes { data } and unwraps it", async (t) => {
  t.after(mockFetch(async (url) => new Response(JSON.stringify({ data: { sessions: [], runningSessionIds: [] } }), { status: 200 })));
  const data = await listSessions();
  assert.deepEqual(data, { sessions: [], runningSessionIds: [] });
});

test("api-v1 client throws ApiV1Error with status and code on { error }", async (t) => {
  t.after(mockFetch(async () => new Response(JSON.stringify({ error: { code: "session_not_found", message: "Session not found" } }), { status: 404 })));
  await assert.rejects(
    listSessions(),
    (error) => error instanceof ApiV1Error && error.status === 404 && error.code === "session_not_found" && error.message === "Session not found",
  );
});

test("api-v1 client surfaces transport failures unchanged", async (t) => {
  const transportError = new TypeError("network down");
  t.after(mockFetch(async () => { throw transportError; }));
  await assert.rejects(listSessions(), (error) => error === transportError);
});

test("api-v1 client builds the correct URL and payloads", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => { seen.push([url, init]); return new Response(JSON.stringify({ data: { modelList: [] } }), { status: 200 }); }));
  await getModels("/home/me/project");
  await getModels();
  await getRunningSessionIds();
  await getAgentState("sid-1");
  assert.match(seen[0][0], /\/api\/v1\/models\?cwd=/);
  assert.equal(seen[1][0], "/api/v1/models");
  assert.equal(seen[2][0], "/api/v1/agent/running");
  assert.match(seen[3][0], /\/api\/v1\/agent\/sid-1\/state$/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /web && node --experimental-strip-types --test lib/api-v1-client.test.mjs`
Expected: FAIL (module not found) + TypeError from `ApiV1Error` undefined.

- [ ] **Step 3: Implement the client**

`web/lib/api-v1-client.ts`:

```ts
// Client-side helper for the /api/v1 read surface.
//
// Every /api/v1 read route returns one of:
//   { data: <result> }                 (2xx)
//   { error: { code, message } }       (non-2xx)
//
// This module centralizes envelope decoding so call sites never branch on the
// wire shape. Type-only imports keep the contract types out of the browser
// bundle (Phase 1 boundary rule: browser code must not import server runtime).
import type {
  AgentStateResponse,
  ModelsResponse,
  SessionContext,
  SessionDetailsResponse,
  SessionsResponse,
} from "@/packages/pi-backend/contracts";

export class ApiV1Error extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiV1Error";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!res.ok || body.error) {
    throw new ApiV1Error(
      body.error?.message ?? `HTTP ${res.status}`,
      res.status,
      body.error?.code ?? "internal_error",
    );
  }
  return body.data as T;
}

export function listSessions(force = false): Promise<SessionsResponse> {
  return apiFetch(`/api/v1/sessions${force ? "?force=1" : ""}`, { cache: "no-store" });
}

export function getSessionDetails(
  sessionId: string,
  options: { deferThinking?: boolean; deferMedia?: boolean } = {},
): Promise<SessionDetailsResponse> {
  const params = new URLSearchParams();
  if (options.deferThinking) params.set("deferThinking", "1");
  if (options.deferMedia) params.set("deferMedia", "1");
  const query = params.toString();
  return apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`);
}

export function getSessionContext(
  sessionId: string,
  leafId?: string | null,
): Promise<SessionContext> {
  const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
  if (leafId) params.set("leafId", leafId);
  return apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/context?${params}`);
}

export function getSessionThinking(
  sessionId: string,
  entryId: string,
  blockIndex: number,
): Promise<{ thinking: string }> {
  return apiFetch(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
  );
}

export function getRunningSessionIds(signal?: AbortSignal): Promise<string[]> {
  return apiFetch<{ runningSessionIds: string[] }>("/api/v1/agent/running", {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  }).then((data) => data.runningSessionIds);
}

export interface AgentStateData {
  running: boolean;
  state?: AgentStateResponse;
}

export function getAgentState(sessionId: string): Promise<AgentStateData> {
  return apiFetch(`/api/v1/agent/${encodeURIComponent(sessionId)}/state`);
}

export function getModels(cwd?: string): Promise<ModelsResponse> {
  return apiFetch(cwd ? `/api/v1/models?cwd=${encodeURIComponent(cwd)}` : "/api/v1/models");
}
```

Note the `running` route has the same shape a `Session` id route would — the client always pins `running` via the static URL and the route contributes no path collision; the contract test from Task 5 guards it.

- [ ] **Step 4: Run to verify pass, then `tsc` / `lint`

```bash
cd web && node --experimental-strip-types --test lib/api-v1-client.test.mjs
pnpm exec tsc --noEmit
pnpm lint
```

Expected: 4 tests, `tsc` exit 0, `lint` exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api-v1-client.ts web/lib/api-v1-client.test.mjs
git commit -m "feat(web): add versioned browser read client with envelope decoding"
```

---

### Task 7: Migrate browser reads to `/api/v1` and add the reversion-guard source scan

**Files:**
- Modify: `web/components/AppShell.tsx`, `web/components/SessionSidebar.tsx`, `web/components/ChatWindow.tsx`, `web/components/MessageView.tsx`, `web/hooks/useAgentSession.ts`
- Create: `web/lib/api-v1-read-scan.test.mjs`
- Modify: `web/hooks/useAgentSession.test.mjs` (one assertion remap)

The migration is a **read-only URL swap**: each call site keeps its surrounding logic byte-for-byte except the fetch lines, and the client methods return the exact objects the legacy `.json()` produced (the `{ running, state }` shape is unchanged). This is the instruction that keeps the phase coherent with legacy mutation/stream URLs (they don't move; the scan below proves reads moved).

Read-call → client-method table (all verified sites):

| # | File:line (pre-Task-7) | Legacy call | New call | Changes |
|---|---|---|---|---|
| 1 | `SessionSidebar.tsx:390` | `fetch(force ? "/api/sessions?force=1" : "/api/sessions", { cache: "no-store" })` | `listSessions(force)` | keep body (`setAllSessions`, running-set fallback guard, unread sweep) |
| 2 | `SessionSidebar.tsx:462` | `fetch("/api/agent/running", { cache: "no-store", signal })` | `getRunningSessionIds(current.signal)` | keep arrival guard + `setRunningSessionIds(new Set(ids))` |
| 3 | `AppShell.tsx:516` | `fetch("/api/sessions")` | `listSessions()` with `(d) => d, () => null` | keep stale-token check + `find` |
| 4 | `AppShell.tsx:749` | `fetch("/api/sessions", { cache: "no-store" })` | `listSessions()` same guard | keep hydrate body |
| 5 | `ChatWindow.tsx:238` | `fetch("/api/sessions")` | `listSessions()` | keep `cancelled` closure |
| 6 | `hooks/useAgentSession.ts:468` | `fetch(`/api/sessions/${sid}?${params}`)` | `getSessionDetails(sid, { deferThinking: true, deferMedia: true })` with a 404-specific catch | **see Step 2** for the 404 branch |
| 7 | `hooks/useAgentSession.ts:497` | `fetch(`/api/sessions/${sid}/state`)` | `getAgentState(sid)` with `.catch((e) => ... return null)` | keep state-fanout body |
| 8 | `hooks/useAgentSession.ts:530` | `fetch(`/api/sessions/${sid}/context?${params}`)` | `getSessionContext(sid, leafId)` | keep `setMessages` body |
| 9 | `hooks/useAgentSession.ts:833` | `fetch(`/api/agent/${encodeURIComponent(sid)}`)` | `getAgentState(sid)` | keep `!res.ok`→ `promptActive` logic |
| 10 | `hooks/useAgentSession.ts:908` | same | `getAgentState(sid)` | settled-ping loop |
| 11 | `hooks/useAgentSession.ts:935` | same | `getAgentState(sid)` | `waitForBashSettlement` |
| 12 | `hooks/useAgentSession.ts:961` | same | `getAgentState(sid)` | `reconcileAgentState` |
| 13 | `hooks/useAgentSession.ts:1053` | `fetch(`/api/agent/${...}`).then(r=>r.json())` | `getAgentState(sid).then` | `contextUsage`/`systemPrompt` block |
| 14 | `hooks/useAgentSession.ts:1524` | `modelsUrl ? fetch(modelsUrl)` | `getModels(modelCwd || undefined)` | keep the rest of `loadModels` body verbatim |
| 15 | `MessageView.tsx:161` | `fetch(`/api/sessions/${sid}/entries/${eid}/thinking?...`)` | `getSessionThinking(sessionId, entryId, blockIndex)` | keep cache + error handling |

AppShell/SessionSidebar/ChatWindow change the `fetch` import-line shape only; every `// [ ]` step below is the exact edit.

**Remap for `hooks/model-scope-startup.test.mjs`:** the `loadModels` edits keep the body tokens the scan matches (`loadModelsSource` slice boundary `const loadModels = useCallback` → `const handleBuiltinSlashCommand` is unchanged), so those tests stay green unchanged.

- [ ] **Step 1: Add the import + swap the two `SessionSidebar` reads**

Add at the import section (with the other `@/lib` imports in `SessionSidebar.tsx`):

```ts
import { getRunningSessionIds, listSessions } from "@/lib/api-v1-client";
```

Replace `SessionSidebar.tsx:390` inside `loadSessions`:

```ts
      const data = await listSessions(force);
```

(Remove the `const res = await fetch(...)` and `if (!res.ok) throw new Error(...)` and `const data = await res.json() as {...}` lines; the `data` variable type is inferred. Everything below — `setAllSessions`, the `runningPollAuthoritativeRef` fallback, the unread-set sweep, `setSessionRefreshDone` — stays.)

Replace `SessionSidebar.tsx:462` inside the running poll:

```ts
        const data = await getRunningSessionIds(current.signal);
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        setRunningSessionIds(new Set(data));
```

(remove the `const res = await fetch("/api/agent/running", {...})`, `if (!res.ok) return;`, and `const data = await res.json() as { runningSessionIds?: string[] }`. The abort signal is still forwarded; `getRunningSessionIds` returns `string[]`.)

- [ ] **Step 2: Swap the two `AppShell` and the `ChatWindow` session-list reads**

Add to `web/components/AppShell.tsx` imports:

```ts
import { listSessions } from "@/lib/api-v1-client";
```

`AppShell.tsx:516` (restoreWorkspaceContext) — replace the fetch chain with:

```ts
    void listSessions()
      .then((d) => d, () => null)
      .then((d) => {
        if (token !== workspaceRestoreTokenRef.current) return;
        const s = d?.sessions.find((x) => x.id === lastOpenSessionId);
        // ...below identical: `if (!s) { if (d) clearLastOpen(projectKey); return; }` etc.
```

`AppShell.tsx:749` (hydrateSelectedSession):

```ts
    void listSessions()
      .then((d) => d, () => null)
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (
          prev?.id === sessionId
            ? { ...prev, ...full, transient: full.transient ?? false }
            : prev
        ));
      })
      .catch(() => {});
```

Add the same import + swap to `web/components/ChatWindow.tsx:238`:

```ts
    listSessions()
      .then((data) => {
        if (!cancelled) setSessions(data.sessions);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
```

- [ ] **Step 3: Swap the `loadSession` / `loadContext` / agent-state / models reads in `useAgentSession.ts`**

Add to the import block:

```ts
import {
  ApiV1Error,
  getAgentState,
  getModels,
  getSessionContext,
  getSessionDetails,
  listSessions,
  type AgentStateData,
} from "@/lib/api-v1-client";
```

`useAgentSession.ts:468` (loadSession detail) — replace the fetch + 404 branch with:

```ts
      let d;
      try {
        d = await getSessionDetails(sid, { deferThinking: true, deferMedia: true });
      } catch (error) {
        if (error instanceof ApiV1Error && error.status === 404) {
          if (showLoading) {
            setData(null);
            setActiveLeafId(null);
            setMessages([]);
            setError(null);
          }
          return null;
        }
        throw error;
      }
```

(the rest of `loadSession` after `const d` — `setData(d)`, `setActiveLeafId(d.leafId)`, `setMessages(persistedMessages)`, `setThinkingLevel` — stays; the `includeState` block uses): `const agentState = await getAgentState(sid).catch((e) => { console.error("Failed to load agent state:", e); return null; });`

`useAgentSession.ts:530` (loadContext):

```ts
      const d = await getSessionContext(sid, leafId);
      setMessages(d.messages);
      setEntryIds(d.entryIds ?? []);
```

(remove `const url = ...`; the client always sends deferThinking/deferMedia. The existing `try/catch` stays for the other failures.)

`useAgentSession.ts:833/908/935/961` — each `const res = await fetch(...)` + `if (!res.ok) ...` + `const data = await res.json())` collapses to `const data = await getAgentState(sid);` with the same surrounding guards. **Status 404**: for the reconcile/poll goroutines the old `if (!res.ok) return;` (or skip) is now a caught `ApiV1Error` — behavior identical (they resume anyway).

`useAgentSession.ts:1053` (the `agent_end` fetch) becomes:

```ts
          getAgentState(sessionIdRef.current)
            .then((d) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
              if (d.state?.extensionStatuses !== undefined) setExtensionStatuses(d.state.extensionStatuses ?? []);
              if (d.state?.extensionWidgets !== undefined) setExtensionWidgets(d.state.extensionWidgets ?? []);
              setQueuedMessages(normalizeQueuedMessages(d.state?.queuedMessages));
            })
            .catch(() => {});
```

`useAgentSession.ts:1524` (loadModels) — replace the first two lines with:

```ts
  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    const d = await getModels(modelCwd || undefined);
    if (signal?.aborted) return;
    setModelNames(d.models);
    // ...the existing body is unchanged below (setModelError, setModelScopeWarnings,
    // setModelThinkingLevels, the isNew default-model + thinking pin block).
```

> Note the `signal` parameter remains part of the signature (callers pass it) — the client ignores it on this method, which matches the current behavior: the legacy `fetch(modelsUrl, signal ? { signal } : undefined)` aborted the *request* on unmount but `loadModels` already guards `if (signal?.aborted) return;` after the fetch. To be precise, keep that exact guard and pass the signal through the client only where it matters (`getRunningSessionIds`). If tests flag aborts, `getModels` can accept `{ signal?: AbortSignal }` later — do not add in this task.

- [ ] **Step 4: Swap the `MessageView` thinking read + remap the hook test**

In `web/components/MessageView.tsx` add to imports:

```ts
import { getSessionThinking } from "@/lib/api-v1-client";
```

In `loadThinkingContent` replace the fetch with:

```ts
  const request = getSessionThinking(sessionId, entryId, blockIndex)
    .then((data) => {
      if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
      return data.thinking;
    })
    .catch((error) => {
      thinkingContentCache.delete(key);
      throw error;
    });
```

(keep the `thinkingContentCache` set/eviction lines exactly.)

`web/hooks/useAgentSession.test.mjs` — in "keeps the session event stream open through the idle grace window", remap the assertion:

```js
assert.match(graceSource, /getAgentState\(sid\)/);
```

(from `assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/)`).

- [ ] **Step 5: Write the reversion-guard source scan**

Create `web/lib/api-v1-read-scan.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

const BROWSER_FILES = [
  "components/AppShell.tsx",
  "components/SessionSidebar.tsx",
  "components/ChatWindow.tsx",
  "components/MessageView.tsx",
  "hooks/useAgentSession.ts",
];

// One pattern per *migrated read*. Mutations/streams still use legacy URLs and
// must NOT match: /api/sessions/${id}/auto-name, /export, PATCH/DELETE
// fetches, the EventSource /events URL, /bash-output, the /api/agent/new POST.
const LEGACY_READ_PATTERNS = [
  /fetch\(["'`]\/api\/sessions(?=["'`?])/,                              // session list
  /fetch\(["'`]\/api\/sessions\/\$\{encodeURIComponent\([^)]*\)\}\/?\?/, // session detail (any ?-query)
  /\/api\/sessions\/\$\{encodeURIComponent\([^)]*\)\}\/context\?/,        // context
  /\/api\/sessions\/\$\{encodeURIComponent\([^)]*\)\}\/entries\/\$\{encodeURIComponent\([^)]*\)\}\/thinking/, // thinking
  /fetch\(["'`]\/api\/agent\/running/,               // running snapshot
  /fetch\(\s*["'`]\/api\/agent\/\$\{encodeURIComponent\([^)]*\)\}\)(?!\/)/, // bare agent state GET
  /fetch\(["'`]\/api\/models(?=["'`?])/,             // model list
];

test("migrated browser reads never revert to legacy URLs", async () => {
  for (const file of BROWSER_FILES) {
    const source = await readFile(new URL(file, webRoot), "utf8");
    for (const pattern of LEGACY_READ_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} ${pattern}`);
    }
  }
});

test("migrated browser reads are served by the v1 client", async () => {
  for (const file of BROWSER_FILES) {
    const source = await readFile(new URL(file, webRoot), "utf8");
    assert.match(source, /from ["'`]@\/lib\/api-v1-client["'`]/, file);
  }
  const clientSource = await readFile(new URL("api-v1-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(clientSource, /\/api\/(?!\/v1)\//); // no legacy path inside the v1 client
});
```

Double-check the patterns against the migration: after Task 7 the browser files contain none of the literal legacy read fetches, while `PATCH`, `DELETE`, `auto-name`, `export`, `EventSource`, `/api/agent/new` forms (`fetch("/api/agent/new"`, `/events`, `/bash-output`) do not match any pattern (verify with `grep -n` mentally for each). Run the two tests; they pass.

- [ ] **Step 6: Run the full environment**

```bash
cd web && pnpm test
pnpm exec tsc --noEmit
pnpm lint
```

Expected: **~881 tests** (844 + Task-1/5/6/7 additions, minus 0 removals; the one remap in `useAgentSession.test.mjs` updates an existing assertion, the other 21 assertions in that file stay green — verify them individually if any fail). `tsc` exit 0; `eslint .` exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/components/AppShell.tsx web/components/SessionSidebar.tsx web/components/ChatWindow.tsx web/components/MessageView.tsx web/hooks/useAgentSession.ts web/hooks/useAgentSession.test.mjs web/lib/api-v1-read-scan.test.mjs
git commit -m "refactor(web): migrate browser reads to /api/v1 and guard reversion"
```

---

### Task 8: Phase-boundary audit, parity proof, and full-suite verification

**Files:**
- Modify: none expected; optional `docs/superpowers/specs/2026-09-07-modular-headless-pi-backend-design.md` docs-sync commit (separate commit, see Step 6)

- [ ] **Step 1: Full suite, typecheck, lint**

```bash
cd web && pnpm test && pnpm exec tsc --noEmit && pnpm lint
```

Expected: **~881 tests pass** (adjust to the actual count — 844 baseline + ~37 added across Tasks 1–7); `tsc` exit 0; `eslint .` exit 0.

- [ ] **Step 2: Prove the phase boundary (no commands/SSE/creation in the diff)**

```bash
cd /home/arjun/code/zosmaai/zosma-cowork-headless-api
git diff --stat
git diff -- web/app/api/v1 web/lib | grep -nE "prompt|abort|steer|follow_up|EventSource|WebSocket|/events" || echo "no command/stream surface in /api/v1"
git diff --stat -- app/api | grep -v "api/v1" || echo "no legacy route changed"
```

Expected: the first grep prints nothing (no command/SSE tokens in the v1 diff); the second shows no legacy `app/api/**` file outside `api/v1` in the diff.

- [ ] **Step 3: Prove the envelope + no-runtime-start and client parity claims**

```bash
cd /home/arjun/code/zosmaai/zosma-cowork-headless-api
grep -rn "apiSuccess\|apiErrorResponse" web/app/api/v1 --include=route.ts | wc -l   # ≥ 9 route files
grep -rn "globalThis.__piSessions" web/app/api/v1 --include=route.test.mjs | wc -l  # ≥ 3 (health, capabilities, running)
diff <(sed -n '1,40p' web/app/api/v1/models/route.ts) <(sed -n '1,40p' web/app/api/models/route.ts) > /dev/null && echo "models body in sync" || echo "compare manually"
```

Expected: 9 route files use the envelope; 3+ route tests assert `globalThis.__piSessions` stays undefined; the models validation body is in sync with the legacy route (only error-shape differs by design).

- [ ] **Step 4: Route-precedence smoke (manual, dev server)**

Per the roadmap read of the repo's Next.js route docs: start `pnpm dev`, then

```bash
curl -s localhost:3000/api/v1/agent/running | head -c 200
curl -s localhost:3000/api/v1/agent/nope/state -o /dev/null -w "%{http_code}\n"   # expect 404 { error }
```

Expected: `{"data":{"runningSessionIds":[]}}` (the static segment wins) and req 2 returns 404 with the envelope. Stop any running dev server first only if a production build is needed (per `web/AGENTS.md`); for this smoke a dev server is fine.

- [ ] **Step 5: Parity proof**

```bash
cd /home/arjun/code/zosmaai/zosma-cowork-headless-api
diff <(git show 5acc1b34f:web/app/api/sessions/route.ts) web/app/api/sessions/route.ts > /dev/null && echo "sessions list legacy untouched"
diff <(git show 5acc1b34f:web/app/api/models/route.ts) web/app/api/models/route.ts > /dev/null && echo "models legacy untouched"
diff <(git show 5acc1b34f:web/app/api/agent/[id]/route.ts) web/app/api/agent/[id]/route.ts > /dev/null && echo "agent legacy untouched"
git status --short
```

Expected: three legacy route files are byte-identical to the Phase-3 baseline; working tree clean except this plan doc (untracked).

- [ ] **Step 6: Optional docs-sync commit (design doc phase split)**

The design doc's `## Implementation Phases` (Phase 4 bullet lists "events, prompt, abort, steer, and follow-up adapters" and Phase 5 is "Web client migration") predates the roadmap's split. Keep the plan and the report's finding aligned by syncing both bullets to the roadmap, as a **separate commit**:

Replace the design doc's Phase 4 bullet with:

```markdown
### Phase 4: `/api/v1` discovery and read-only session slice

- Add health, capabilities, models, session list/detail/context/thinking, runtime state, and running-session adapters.
- Add consistent envelope and error mapping tests.
- Migrate the browser's read calls (startup, sidebar refresh, cold load, running reconciliation, model selection) to the shared typed client.

### Phase 5: Session creation, core commands, and SSE cutover

- Add session creation, prompt/abort/steer/follow-up/queue adapters, and per-session + running-session SSE.
- Migrate the browser's creation prompts, commands, and streams to `/api/v1`.
- Retain the legacy combined create-and-prompt route as a composing adapter.

### Phase 6: Runtime controls, tools, compaction, and Bash

- (unchanged from the roadmap's Phase 6 … the following design bullets move up accordingly; keep the remaining "Remaining API roadmap" phase numbering intact.)
```

Then:

```bash
git add docs/superpowers/specs/2026-09-07-modular-headless-pi-backend-design.md
git commit -m "docs: sync design doc phase split with the roadmap"
```

If anything in that diff extends beyond the two bullets (e.g. the design doc's "Testing strategy" already covers SSE under its own header and does not need changing), revert the overreach and commit only the bullets. If touching the spec feels risky, skip the commit and leave a `// docs-caveat:` note in this plan's risks instead — the roadmap remains the authority either way.

- [ ] **Step 7: Final manual smoke of a migrated read**

In `npm run dev`, refresh a sidebar, select a session (cold load), send a prompt (still legacy), and watch the running pill — all data must come from `/api/v1` with no console errors (the scan in Task 7 already guarantees URL routing; this smoke catches caching/headers regressions).

---

## Roadmap-required Phase 4 verification, mapped

- **Every successful JSON response uses `{ N }`; failures use the stable `{ error }` envelope and documented status mapping** → Task 1 envelope tests (every code → its documented status, `{ error: { code, message } }` shape), and every v1 route test asserts `{ data }` / `{ error: { code } }` exactly (Tasks 2–5).
- **Health/capabilities do not start a Pi runtime** → Task 2 route tests assert `globalThis.__piSessions === undefined` after `GET`; façade `getHealth`/`getCapabilities` are pure shape (Phase 1). Task 8 Step 3 re-verifies with `grep` coverage counts.
- **Browser startup, sidebar refresh, cold session loading, active-run reconciliation, and model selection data work through `/api/v1`** → Task 6 client + Task 7 swaps: startup (`AppShell.tsx:516`), sidebar refresh (`SessionSidebar.tsx:390` + `462` running poll + `ChatWindow.tsx:238`), cold session loading (`useAgentSession.ts:468/497/530`), active-run reconciliation (`useAgentSession.ts:833/908/935/961/1053`), model selection (`useAgentSession.ts:1524`), thinking (`MessageView.tsx:161`).
- **A focused source scan prevents migrated read paths from returning to legacy URLs** → Task 7 Step 5 `web/lib/api-v1-read-scan.test.mjs` (negative patterns over the migrated read shapes + positive client-import assertions + client file self-scan).
- **Legacy endpoints remain ad-hoc adapters over the same backend** → Tasks 2–5 add `web/app/api/v1/**` only; Task 8 Step 5 diffs the three canonical legacy read routes against the Phase-3 baseline. No legacy handler is edited.

## Risks and countermeasures

- **Route precedence (`running` vs `:id`).** Next.js resolves a static segment over a dynamic one, and the `/api/v1/agent` tree never defines a bare `[id]/route.ts` (only `[id]/state`), so `running` can never be captured as a session id. The Task 5 `route-precedence.test.mjs` pins the layout + exports + absence of `[id]/route.ts`; Task 8 Step 4 adds a curl smoke against a live dev server.
- **Envelope migration altering hook assumptions.** All decoding lives in `web/lib/api-v1-client.ts` (one `apiFetch`). Components and hooks receive the same object shapes they decoded from raw `res.json()` today (`{ sessions, runningSessionIds }`, `{ running, state }`, `ModelsResponse`, …), so no hook branches on the wire. The only intentional exception is `loadSession`'s pre-existing 404-session-deleted branch, which now catches `ApiV1Error(404)` — same SQL semantics.
- **Browser read migration introducing UI regressions.** Legacy reads keep running (they are untouched server code), and every swap preserves the call site's guard/fallback behavior (verified against each captured `git show 5acc1b34f:...` copy / `$` in Task 7). The reversion-guard source scan fails the build if a migrated read shape returns to a legacy URL. Mixed transport is intentional and coherent (both route generations share one backend instance and one runtime registry), which is exactly the Phase 3 state that was already working.
- **`server-only` breaking jiti route tests.** `getPiBackend()` imports `server-only`, which resolves only inside Next's bundler. The fix is scoped: `app/api/v1/test-helper.mjs` aliases it to an empty module; probe-verified that the equivalence is stable. Do not remove the alias.
- **Total status mapping vs. legacy fallback.** `backendErrorResponse` now routes all 11 codes by table; the only legacy-visible change would be codes no legacy route throws (none do — verified in Task 1 Step 12). Entry/block 404s preserve the legacy message and 404 status, so the legacy thinking route's wire is byte-identical.
- **Design-doc/roadmap split drift.** The design doc's Phase 4/5 bullets describe the full slice (commands + client). The roadmap is authoritative; the design doc sync is a separate `docs:` commit (Task 8 Step 6) — executor may skip with a risk note.
- Working state between commits: Tasks 1–7 each leave the tree green (their commits are independently runnable); Task 4's first commit (ponytail) is green on its own, Task 1's envelope commit needs the ponytail codes to type-check — hence the locked ordering.

## Out-of-scope

- Session creation (`/api/agent/new`), prompt/abort/steer/follow-up/queue endpoints, and `/api/v1/sessions` POST mutate — Phase 5.
- SSE (per-session or running-session), WebSocket/replay, heartbeat/commentary framing — Phase 5.
- Export, Bash plain-text responses, tools/model-mutation/thinking changes/compaction/reload/branch/navigate — Phase 6/7.
- Non-agent domains (workspace/files/Git, auth, models-config catalog, skills/plugins, app-update, cwd validate) — later phases.
- Changing legacy handlers, `rpc-manager.ts` internals, `pi-backend-host.ts`, `runtime-state.ts`, the package boundaries (except the Task 1 ponytail in `contracts.ts`/`errors.ts`/`sessions.ts` and Task 5 facade additions to `index.ts`).
- Provider credential/auth flows; CORS/remote networking; mobile auth (deferred by design spec).
- Bare `[id]/route.ts` GET under `/api/v1/agent` (we only ship `[id]/state`).

---

Plan complete. Ready to execute this phase with /skill:executing-plans (it intentionally does not start Phase 5).