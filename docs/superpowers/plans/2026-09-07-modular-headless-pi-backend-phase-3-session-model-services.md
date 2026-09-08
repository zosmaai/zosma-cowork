# Modular Headless Pi Backend Phase 3 Implementation Plan — Session Persistence and Chat Model Service Extraction

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move session read/mutation behavior (listing, UUID resolution, context/tree reads, deferred content, rename, delete, export preparation, stats, auto-name) and chat model behavior (listing, scope diagnostics, default selection, startup preferences, cache invalidation) behind transport-independent `PiBackend` service methods, with existing routes delegating to the same public entry points through compatibility seams.

**Architecture:** `web/packages/pi-backend/sessions.ts` becomes the session service: the entire `web/lib/session-reader.ts` behavior moves there verbatim, plus the session-coordination bodies currently inside six route files (details, rename, delete, auto-name, context, thinking, list-merge). `web/packages/pi-backend/models.ts` becomes the model service: `models-cache.ts`, `model-scope.ts`, `startup-preferences.ts`, and the models route's `loadModels` assembly all move there. The four lib modules become re-export/delegation seams exactly like Phase 2's `rpc-manager.ts`: routes keep importing `@/lib/session-reader` etc. and keep calling the same names. The facade (`index.ts`) gains methods that compose the services; service functions that need live-session state take a `RuntimeManager` parameter (type-only import — no runtime cycle, see Risks), and the facade/seams inject the process-wide manager from `runtime-state.ts`.

**Tech Stack:** TypeScript 5, Pi SDK (`@earendil-works/pi-coding-agent`), Node.js test runner + `jiti`, Next.js 16, pnpm.

**Roadmap:** `docs/superpowers/roadmaps/2026-09-07-modular-headless-pi-backend-roadmap.md`

**Phase:** Phase 3: Session Persistence and Chat Model Service Extraction

---

## Phase Boundary

This plan moves and wraps **existing, tested behavior**. It does **not** redesign listing, UUID resolution, context building, deferred thinking, rename, delete re-parenting, auto-name, model scope resolution, default selection, or cache semantics. Two mechanical substitutions are required by the move and are made everywhere:

1. Route-local `getRpcSession(id)` / `startRpcSession(...)` calls become `runtime.getSession(id)` / `runtime.startSession(...)` on a `RuntimeManager` parameter injected by the seam and the facade.
2. Route early-return error responses become **thrown `BackendError`s** (Phase 1 already defined them) with the exact current message strings, because a throwing service is the only way to carry those wire responses out of the moved bodies. The new route-side mapper `web/lib/backend-error-response.ts` restores the exact `{ error }` body and status.

**Explicit non-goals — this plan does NOT:**

- Add any `/api/v1` route, SSE/WebSocket/gRPC transport, envelope helper, or browser client change (Phase 4 work).
- Change `web/lib/pi-backend-host.ts` (the facade's new `runtime?` option is optional and defaults to `getRuntimeManager()`, so host wiring is untouched).
- Move or rewire components, hooks, `agent-client.ts`, or any route that is not one of the six named in File Structure.
- Touch `contracts.ts` (facade/service signatures reuse existing `SessionIdInput`, `UpdateSessionInput`, `ListSessionsInput`, `ListModelsInput`, `SessionsResponse`, `SessionDetailsResponse`, `SessionMutationResponse`, `AutoNameResponse`, `ModelsResponse`; no new contract types) or `errors.ts` (no new codes).
- Touch provider credential management, editable model configuration, workspace/file, or Git/worktree behavior.
- Rename or move the four runtime `globalThis` keys (`__piSessions`, `__piStartLocks`, `__piStartingSessionCwds`, `__piRunningListeners`) — they stay in `web/lib/runtime-state.ts` (Phase 2). The session-list/path caches (`__piSessionPathCache`, `__piPathToSessionIdCache`, `__piSessionListPromise*`, `__piSessionListGeneration`, `__piSessionListCache`) and `__piModelsCacheState` move **with their code** into the services — same keys, same module state.

**Phase boundary health:** every endpoint keeps working because the seams delegate every name to the services, and the services run the identical bodies that previously ran in `session-reader.ts`, the models route, and the six session routes. Routes keep importing and calling the **same public entry points from the same module paths**; they never import `@/packages/pi-backend` directly. Route-slimming never changes request/response shapes (see the wire table in Task 3).

---

## File Structure

### Create

- `web/packages/pi-backend/sessions.ts` — session service: moved `session-reader.ts` behavior + seven higher-level service functions (`listSessions`, `getSessionDetails`, `getSessionContext`, `renameSession`, `deleteSession`, `autoNameSession`, `getSessionThinking`). No `globalThis` runtime keys, no `process`.
- `web/packages/pi-backend/models.ts` — model service: moved `models-cache.ts` + `model-scope.ts` + `startup-preferences.ts` behavior + the models route's `loadModels`/`EMPTY_MODELS` assembly, plus `getModels(cwd)`. No `globalThis` runtime keys, no `process`.
- `web/lib/backend-error-response.ts` — route-side mapper: `BackendError` → `NextResponse` with the preserved `{ error: message }` body and Phase 3 compat status. Lives in `lib/` because it returns `next/server` responses; the package boundary test forbids that import inside `packages/`.
- `web/packages/pi-backend/sessions.test.mjs` — Task 4 behavior tests (fake runtime, fresh state, temp JSONL session files).
- `web/packages/pi-backend/models.test.mjs` — Task 4 model service characterization tests.
- `web/packages/pi-backend/index.test.mjs` additions — Task 4 facade wiring tests.

### Modify

- `web/lib/session-reader.ts` — compatibility seam (full content in Task 1 Step 2): pure re-exports for the twelve moved names, delegate wrappers (injecting `getRuntimeManager()`) for the five runtime-dependent service functions.
- `web/lib/models-cache.ts`, `web/lib/model-scope.ts`, `web/lib/startup-preferences.ts` — compatibility seams (Task 2): pure re-exports from `../packages/pi-backend/models`.
- `web/packages/pi-backend/runtime.ts` — import switches only: `../../lib/session-reader` → `./sessions` (Task 1), `../../lib/models-cache` → `./models` (Task 2). No logic changes.
- `web/packages/pi-backend/runtime-manager.ts` — import switches only: `../../lib/session-reader` → `./sessions` (Task 1), `../../lib/models-cache`, `../../lib/model-scope`, `../../lib/startup-preferences` → `./models` (Task 2). No logic changes.
- `web/packages/pi-backend/index.ts` — facade gains session methods (Task 1) and `getModels` (Task 2); `CreatePiBackendOptions` gains optional `runtime?: RuntimeManager`.
- `web/app/api/sessions/route.ts` — body replaced by `listSessions` seam call (Task 1).
- `web/app/api/sessions/[id]/route.ts` — GET/PATCH/DELETE replaced by `getSessionDetails`/`renameSession`/`deleteSession` seam calls (Task 1).
- `web/app/api/sessions/[id]/auto-name/route.ts` — body replaced by `autoNameSession` seam call (Task 1).
- `web/app/api/sessions/[id]/context/route.ts` — body replaced by `getSessionContext` seam call (Task 1).
- `web/app/api/sessions/[id]/entries/[entryId]/thinking/route.ts` — body replaced by `getSessionThinking` seam call (Task 1).
- `web/app/api/models/route.ts` — body replaced by `getModels` seam call; cwd validation stays (Task 2).
- `web/lib/rpc-manager.test.mjs` — remap one assertion in one test (Task 1 Step 6).
- `web/lib/project-trust.test.mjs` — remap one source read in one test (Task 2 Step 6).

### Explicitly unchanged

- `web/app/api/sessions/[id]/export/route.ts` (export **preparation** = the moved `resolveSessionPath`; the CLI/file hygiene and the `patchExportHtml` deep-session safeguard stay put — Phase 7 concern), `web/app/api/sessions/[id]/state/route.ts`, `web/app/api/agent/**`, `web/app/api/project-trust/route.ts`, `web/app/api/auth/**`, `web/lib/file-access.ts`, `web/lib/session-file-references.ts`, `web/lib/models-config-store.ts`, `web/lib/zosma-auth/**`, `web/lib/session-timing.ts`, `web/lib/session-title.ts`, `web/lib/project-tree.ts`, `web/lib/worktree.ts`, `web/lib/pi-backend-host.ts`, `web/lib/runtime-state.ts`, `web/packages/pi-backend/{contracts,errors}.ts`, `web/hooks/**`, `web/components/**`.
- Unchanged tests: `session-reader.test.mjs`, `models-cache.test.mjs`, `model-scope.test.mjs`, `startup-preferences.test.mjs`, `models-config-store.test.mjs` (they all `jiti.import` the seam files — re-export drift breaks their imports immediately, so no remap is needed and no seam-parity guard is required: tsc covers the names only routes use, the jiti imports cover the rest).

---

## Pre-flight

- [ ] **Step 1: Verify the Phase 2 baseline**

```bash
cd web && pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm lint
git status --short
git log --oneline -1
```

Expected: **826 tests pass**; `tsc --noEmit` exit 0; `eslint .` exit 0; working tree clean at `9dc6ca912` (`test(web): characterize pi-backend runtime-manager registry logic`).

- [ ] **Step 2: Freeze the four module surfaces**

```bash
cd web
grep -n "^export " lib/session-reader.ts
grep -n "^export " lib/models-cache.ts
grep -n "^export " lib/model-scope.ts
grep -n "^export " lib/startup-preferences.ts
```

Expected exactly:

- `session-reader.ts`: `getAgentDir`, `attachSessionProjectInfo`, `mergeSessionLists`, `listAllSessions`, `invalidateSessionListCache`, `resolveSessionPath`, `resolveSessionIdByPath`, `cacheSessionPath`, `invalidateSessionPathCache`, `readSessionHeader`, `getSessionEntries`, `buildSessionContext` (12 names).
- `models-cache.ts`: `ModelsData` (type), `invalidateModelsCache`, `withModelRuntimeError`, `withSafeModelLoadFailure`, `loadModelsWithCache`.
- `model-scope.ts`: `ModelScopeResult`, `InitialModelScopeOptions`, `InitialModelScopeResult` (types), `resolveVisibleModels`, `selectInitialModelScope`.
- `startup-preferences.ts`: `ExplicitStartupPreferences`, `EffectiveStartupPreferences` (types), `persistExplicitStartupPreferences`.

Task 1 and Task 2 seams must re-export the same set with the same names.

- [ ] **Step 3: Inventory consumers and source-scan tests**

```bash
cd web
grep -rln "session-reader" lib app packages --include=*.ts | grep -v "\.test\."
grep -rln "models-cache\|model-scope\|startup-preferences" lib app packages --include=*.ts | grep -v "\.test\."
grep -rln "session-reader\|models-cache\|model-scope\|startup-preferences" lib/*.test.mjs
grep -rn "readFile(new URL" lib/rpc-manager.test.mjs lib/project-trust.test.mjs
```

Keep the output open. Expected production consumers: `file-access.ts`, `session-file-references.ts`, the six session routes + `models/route.ts`, `runtime.ts`, `runtime-manager.ts`, `models-config-store.ts`, `zosma-auth/index.ts`, three `auth/**` routes, `project-trust/route.ts`. Expected source-scan tests: `rpc-manager.test.mjs` reads `app/api/sessions/[id]/route.ts` and `app/api/models/route.ts` indirectly; `project-trust.test.mjs` reads `app/api/models/route.ts` directly. The four module files themselves are **never** source-scanned by any test — all test access is jiti import through the seams.

- [ ] **Step 4: Back up the move sources**

```bash
cd web
cp lib/session-reader.ts /tmp/session-reader.ts.orig
cp lib/models-cache.ts /tmp/models-cache.ts.orig
cp lib/model-scope.ts /tmp/model-scope.ts.orig
cp lib/startup-preferences.ts /tmp/startup-preferences.ts.orig
cp "app/api/sessions/route.ts" /tmp/sessions-route.ts.orig
cp "app/api/sessions/[id]/route.ts" /tmp/sessions-id-route.ts.orig
cp "app/api/sessions/[id]/auto-name/route.ts" /tmp/auto-name-route.ts.orig
cp "app/api/sessions/[id]/context/route.ts" /tmp/context-route.ts.orig
cp "app/api/sessions/[id]/entries/[entryId]/thinking/route.ts" /tmp/thinking-route.ts.orig
cp app/api/models/route.ts /tmp/models-route.ts.orig
```

---

### Task 1: Create `web/packages/pi-backend/sessions.ts` and wrap the session routes

**Files:**
- Create: `web/packages/pi-backend/sessions.ts`, `web/lib/backend-error-response.ts`
- Modify: `web/lib/session-reader.ts` (seam), `web/packages/pi-backend/runtime.ts` + `runtime-manager.ts` (import switch), `web/packages/pi-backend/index.ts` (facade methods), six route files, `web/lib/rpc-manager.test.mjs` (one assertion)

- [ ] **Step 1: Build `web/packages/pi-backend/sessions.ts`**

Create the file by copying **verbatim** from `/tmp/session-reader.ts.orig`:

1. The full import block (up to and including `export { getAgentDir };`).
2. `attachSessionProjectInfo`, `mergeSessionLists`, `loadAllSessions` (private), `listAllSessions`.
3. The cache section: `declare global` block (the six `__piSession*` keys), `SESSION_LIST_CACHE_TTL_MS`, `invalidateSessionListCache`, `getPathCache`, `getPathToIdCache`, `resolveSessionPath`, `resolveSessionIdByPath`, `cacheSessionPath`, `invalidateSessionPathCache`.
4. `readSessionHeader`, `getSessionEntries`, `buildSessionContext`, and the private helpers `parseEntryTimestamp`, `isRecord`, `base64ImageInfo`, `omitToolResultBase64Images`, `entryToUiMessage`.

Then append the seven service functions below (new code). The exact imports the file needs are (paths resolve from `web/packages/pi-backend/` upward to `web/lib/`; every identifier is verified against the real source — do not add or drop any):

```ts
import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, normalize as normalizePath } from "path";
import { generateSessionTitle } from "../../lib/session-title";
import { normalizeToolCalls } from "../../lib/normalize";
import { projectIdentityKey } from "../../lib/project-identity";
import { projectTreeForResponse } from "../../lib/project-tree";
import { sessionPathKey } from "../../lib/session-path";
import { computeSessionTotalActiveMs } from "../../lib/session-timing";
import { resolveProject, type ProjectInfo } from "../../lib/worktree";
import type { AgentMessage, SessionContext, SessionEntry, SessionHeader, SessionInfo } from "../../lib/types";
import { BackendError } from "./errors";
import type { AutoNameResponse, ListSessionsInput, SessionDetailsResponse, SessionIdInput, SessionMutationResponse, SessionsResponse, UpdateSessionInput } from "./contracts";
import type { RuntimeManager } from "./runtime-manager";

export { getAgentDir };
```

> `SessionManager` is imported because the details/rename/context/thinking bodies call `SessionManager.open`; `computeSessionTotalActiveMs`, `projectTreeForResponse`, and `generateSessionTitle` come from the leaf lib modules that the routes previously imported. `RuntimeManager` is a **type-only** import — it is erased at runtime, which is what keeps the sessions→runtime-manager→sessions edge from becoming a runtime cycle (runtime-manager.ts imports `cacheSessionPath` as a value from `./sessions`; see Risks).

Service functions (bodies are the current route bodies verbatim, with the two substitutions from the Phase Boundary):

```ts
export async function listSessions(
  input: ListSessionsInput,
  runtime: RuntimeManager,
): Promise<SessionsResponse> {
  const [persistedSessions, runtimeSessions] = await Promise.all([
    listAllSessions(input),
    attachSessionProjectInfo(runtime.getSessionInfos()),
  ]);
  return {
    sessions: mergeSessionLists(persistedSessions, runtimeSessions),
    runningSessionIds: runtime.getRunningSessionIds(),
  };
}

export async function getSessionDetails(
  input: SessionIdInput & { deferThinking?: boolean; deferMedia?: boolean },
  runtime: RuntimeManager,
): Promise<SessionDetailsResponse> {
  const { sessionId: id } = input;
  const rpc = runtime.getSession(id);
  const liveRpc = rpc?.isAlive() ? rpc : undefined;
  const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
  if (!liveRpc && !resolvedPath) {
    throw new BackendError("session_not_found", "Session not found");
  }

  const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(resolvedPath!);
  const filePath = liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
  const entries = sm.getEntries();
  const leafId = sm.getLeafId();
  const tree = projectTreeForResponse(sm.getTree());
  const context = buildSessionContext(entries as never, leafId, {
    deferThinking: input.deferThinking ?? false,
    deferToolResultImages: input.deferMedia ?? false,
  });
  const totalActiveMs = computeSessionTotalActiveMs(entries);

  const header = sm.getHeader();
  let modified = header?.timestamp ?? new Date().toISOString();
  try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
  const parentSessionId = header?.parentSession
    ? await resolveSessionIdByPath(header.parentSession)
    : undefined;
  const info = header ? {
    path: filePath,
    id: header.id,
    cwd: header.cwd ?? "",
    name: sm.getSessionName(),
    created: header.timestamp,
    modified,
    messageCount: context.messages.length,
    firstMessage: context.messages.find((m) => m.role === "user")
      ? (() => {
          const msg = context.messages.find((m) => m.role === "user")!;
          const c = (msg as { content: unknown }).content;
          return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
        })()
      : "(no messages)",
    parentSessionId,
    transient: !filePath || !existsSync(filePath),
  } : null;

  return { sessionId: id, filePath, info, leafId, tree, context, totalActiveMs };
}

export async function getSessionContext(
  input: SessionIdInput & { leafId?: string; deferThinking?: boolean; deferMedia?: boolean },
  runtime: RuntimeManager,
): Promise<SessionContext> {
  const { sessionId: id } = input;
  const rpc = runtime.getSession(id);
  const liveRpc = rpc?.isAlive() ? rpc : undefined;
  const filePath = liveRpc ? null : await resolveSessionPath(id);
  if (!liveRpc && !filePath) {
    throw new BackendError("session_not_found", "Session not found");
  }

  const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
  return buildSessionContext(sm.getEntries() as never, input.leafId, {
    deferThinking: input.deferThinking ?? false,
    deferToolResultImages: input.deferMedia ?? false,
  });
}

export async function renameSession(input: UpdateSessionInput): Promise<SessionMutationResponse> {
  // JSON bodies are a trust boundary: validate at runtime even though the
  // contract type already says `name: string`.
  if (typeof input.name !== "string") {
    throw new BackendError("invalid_request", "name is required");
  }
  const filePath = await resolveSessionPath(input.sessionId);
  if (!filePath) {
    throw new BackendError("session_not_found", "Session not found");
  }
  const sm = SessionManager.open(filePath);
  sm.appendSessionInfo(input.name.trim());
  invalidateSessionListCache();
  return { success: true, sessionId: input.sessionId };
}

export async function deleteSession(
  input: SessionIdInput,
  runtime: RuntimeManager,
): Promise<SessionMutationResponse> {
  const { sessionId: id } = input;
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    throw new BackendError("session_not_found", "Session not found");
  }

  // Preserve the current ordering exactly: read parent, re-parent children,
  // shut down the live wrapper, unlink, invalidate caches.
  const parentSessionPath = readSessionHeader(filePath)?.parentSession;
  const targetPathKey = sessionPathKey(filePath);
  const dir = dirname(filePath);
  try {
    const files = readdirSync(dir).filter(
      (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
    );
    for (const file of files) {
      const childPath = join(dir, file);
      try {
        const content = readFileSync(childPath, "utf8");
        const lines = content.split("\n");
        const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
        if (
          header.type === "session" &&
          header.parentSession &&
          sessionPathKey(header.parentSession) === targetPathKey
        ) {
          header.parentSession = parentSessionPath;
          lines[0] = JSON.stringify(header);
          writeFileSync(childPath, lines.join("\n"));
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* skip if dir unreadable */ }

  await runtime.getSession(id)?.shutdown();
  unlinkSync(filePath);
  invalidateSessionPathCache(id);
  invalidateSessionListCache();
  return { success: true, sessionId: id };
}

export async function autoNameSession(
  input: SessionIdInput,
  runtime: RuntimeManager,
): Promise<AutoNameResponse> {
  const { sessionId: id } = input;
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    throw new BackendError("session_not_found", "Session not found");
  }

  const existing = runtime.getSession(id);
  const { session } = existing?.isAlive()
    ? { session: existing }
    : await runtime.startSession(id, filePath, undefined);

  // globalThis keeps wrappers alive across dev hot reloads; older instances
  // may predate waitUntilReady(), but those have already completed startup.
  await session.waitUntilReady?.();
  const result = await generateSessionTitle(session.inner as unknown as AgentSession);

  if (!session.isAlive()) {
    throw new BackendError(
      "session_not_running",
      "The session was closed while its title was being generated. Please try again.",
    );
  }

  session.inner.setSessionName(result.title);
  invalidateSessionListCache();
  return { title: result.title, usage: result.usage ?? null };
}

export async function getSessionThinking(
  input: SessionIdInput & { entryId: string; blockIndex: number },
): Promise<{ thinking: string }> {
  const { sessionId: id, entryId, blockIndex } = input;
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    throw new BackendError("invalid_request", "Valid blockIndex is required");
  }

  const filePath = await resolveSessionPath(id);
  if (!filePath) throw new BackendError("session_not_found", "Session not found");

  // SessionManager-backed parsing preserves the SDK's malformed-line tolerance.
  const entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
  if (!entry || entry.type !== "message" || entry.message.role !== "assistant") {
    // ponytail: "session_not_found" is the closest stable code and maps to the
    // preserved 404; Phase 4 assigns precise /api/v1 codes for the read contract.
    throw new BackendError("session_not_found", "Assistant message not found");
  }

  const block = entry.message.content[blockIndex];
  if (!block || block.type !== "thinking") {
    throw new BackendError("session_not_found", "Thinking block not found");
  }

  return { thinking: block.thinking };
}
```

- [ ] **Step 2: Make `session-reader.ts` the compatibility seam**

Replace the whole file with:

```ts
import { getRuntimeManager } from "./runtime-state";
import {
  attachSessionProjectInfo,
  autoNameSession as autoNameSessionFromServices,
  buildSessionContext,
  cacheSessionPath,
  deleteSession as deleteSessionFromServices,
  getAgentDir,
  getSessionContext as getSessionContextFromServices,
  getSessionDetails as getSessionDetailsFromServices,
  getSessionEntries,
  getSessionThinking,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  listAllSessions,
  listSessions as listSessionsFromServices,
  mergeSessionLists,
  readSessionHeader,
  renameSession,
  resolveSessionIdByPath,
  resolveSessionPath,
} from "../packages/pi-backend/sessions";

// Pure re-exports: names whose bodies need no live-runtime state.
export {
  attachSessionProjectInfo,
  buildSessionContext,
  cacheSessionPath,
  getAgentDir,
  getSessionEntries,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  listAllSessions,
  mergeSessionLists,
  readSessionHeader,
  renameSession,
  resolveSessionIdByPath,
  resolveSessionPath,
  getSessionThinking,
} from "../packages/pi-backend/sessions";

// Delegation wrappers: inject the process-wide runtime manager so the routes
// keep calling the same names without touching runtime-state themselves.
export async function listSessions(input: { force?: boolean } = {}) {
  return listSessionsFromServices(input, getRuntimeManager());
}
export async function getSessionDetails(input: {
  sessionId: string;
  deferThinking?: boolean;
  deferMedia?: boolean;
}) {
  return getSessionDetailsFromServices(input, getRuntimeManager());
}
export async function getSessionContext(input: {
  sessionId: string;
  leafId?: string;
  deferThinking?: boolean;
  deferMedia?: boolean;
}) {
  return getSessionContextFromServices(input, getRuntimeManager());
}
export async function deleteSession(input: { sessionId: string }) {
  return deleteSessionFromServices(input, getRuntimeManager());
}
export async function autoNameSession(input: { sessionId: string }) {
  return autoNameSessionFromServices(input, getRuntimeManager());
}
```

> Check against Pre-flight Step 2: the twelve frozen names plus `getSessionThinking` (new) are all exported; the five runtime-dependent names are wrappers, the rest are pure re-exports. The unused alias imports at the top exist only to bind the types for the wrappers — the import list and the re-export list must name identical symbols from the same module; if a name appears in **no** wrapper, it must appear only in the re-export list.

- [ ] **Step 3: Switch the runtime modules' session imports**

In `web/packages/pi-backend/runtime.ts` change line 10:

```ts
import { cacheSessionPath, invalidateSessionListCache } from "../../lib/session-reader";
```

to:

```ts
import { cacheSessionPath, invalidateSessionListCache } from "./sessions";
```

In `web/packages/pi-backend/runtime-manager.ts` change line 14:

```ts
import { cacheSessionPath } from "../../lib/session-reader";
```

to:

```ts
import { cacheSessionPath } from "./sessions";
```

No other lines change in either file in this task. The call sites (`runtime.ts` lines 213/379/471/537-538/573-574/596/606/614/754, `runtime-manager.ts` line 222) are untouched — same functions, same `globalThis` keys.

- [ ] **Step 4: Create the route-side error mapper**

Create `web/lib/backend-error-response.ts`:

```ts
import { NextResponse } from "next/server";
import { isBackendError } from "@/packages/pi-backend/errors";

// Phase 3 compatibility status mapping. Phase 4 assigns the final /api/v1
// statuses; codes without an entry here keep the legacy 500 fallback.
const STATUS_BY_CODE: Record<string, number> = {
  invalid_request: 400,
  access_denied: 403,
  session_not_found: 404,
  session_not_running: 409,
};

export function backendErrorResponse(error: unknown): NextResponse | null {
  if (!isBackendError(error)) return null;
  return NextResponse.json(
    { error: error.message },
    { status: STATUS_BY_CODE[error.code] ?? 500 },
  );
}
```

- [ ] **Step 5: Slim the six session routes**

Replace the body of each route (keep `export const dynamic = "force-dynamic";` where present) with a seam call plus mapper-aware error handling. The 500 fallback string must match each route's current formatting exactly (see Task 3 Step 3's wire table).

`web/app/api/sessions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { listSessions } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const result = await listSessions({ force });
    return NextResponse.json(
      result,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
```

`web/app/api/sessions/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { deleteSession, getSessionDetails, renameSession } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = new URL(req.url).searchParams;
  try {
    const details = await getSessionDetails({
      sessionId: id,
      deferThinking: searchParams.has("deferThinking"),
      deferMedia: searchParams.has("deferMedia"),
    });
    return NextResponse.json(details);
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: unknown };
    await renameSession({ sessionId: id, name: name as string });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await deleteSession({ sessionId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

`web/app/api/sessions/[id]/auto-name/route.ts`:

```ts
import { NextResponse } from "next/server";
import { autoNameSession } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await autoNameSession({ sessionId: id });
    return NextResponse.json({ title: result.title, usage: result.usage ?? null });
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
```

`web/app/api/sessions/[id]/context/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  try {
    const context = await getSessionContext({
      sessionId: id,
      leafId: url.searchParams.get("leafId") ?? undefined,
      deferThinking: url.searchParams.has("deferThinking"),
      deferMedia: url.searchParams.has("deferMedia"),
    });
    return NextResponse.json({ context });
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

`web/app/api/sessions/[id]/entries/[entryId]/thinking/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSessionThinking } from "@/lib/session-reader";
import { backendErrorResponse } from "@/lib/backend-error-response";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  try {
    const result = await getSessionThinking({
      sessionId: id,
      entryId,
      blockIndex: blockIndexParam === null ? Number.NaN : Number(blockIndexParam),
    });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = backendErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 6: Remap the one affected assertion in `rpc-manager.test.mjs`**

In the test **"normal session teardown paths use graceful extension shutdown"**, the DELETE body moved out of the route, so change the source read and the assertion:

```js
const deleteRouteSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
```

becomes:

```js
const deleteRouteSource = await readFile(new URL("../packages/pi-backend/sessions.ts", import.meta.url), "utf8");
```

and the assertion

```js
assert.match(deleteRouteSource, /await getRpcSession\(id\)\?\.shutdown\(\)/);
```

becomes:

```js
assert.match(deleteRouteSource, /await runtime\.getSession\(id\)\?\.shutdown\(\)/);
```

The test **"RPC session startup opens an existing session file only once and trusts its cwd"** needs **no** change: its `routeSource`/`eventRouteSource` reads are the agent routes (untouched), and `autoNameRouteSource` still matches `doesNotMatch(route, /SessionManager\.open\(/)` because the auto-name route no longer contains a `SessionManager.open(` (the service does, and the test does not read the service).

- [ ] **Step 7: Add the facade session methods**

Replace `web/packages/pi-backend/index.ts` with:

```ts
import type {
  AutoNameResponse,
  CapabilitiesResponse,
  HealthResponse,
  ListSessionsInput,
  SessionContext,
  SessionDetailsResponse,
  SessionIdInput,
  SessionMutationResponse,
  SessionsResponse,
  UpdateSessionInput,
} from "./contracts";
import {
  autoNameSession as autoNameSessionFromServices,
  deleteSession as deleteSessionFromServices,
  getSessionContext as getSessionContextFromServices,
  getSessionDetails as getSessionDetailsFromServices,
  getSessionThinking as getSessionThinkingFromServices,
  listSessions as listSessionsFromServices,
  renameSession as renameSessionFromServices,
} from "./sessions";
import { getRuntimeManager } from "../../lib/runtime-state";
import type { RuntimeManager } from "./runtime-manager";

export type * from "./contracts";
export { BACKEND_ERROR_CODES, BackendError, isBackendError } from "./errors";

export interface PiBackend {
  getHealth(): Promise<HealthResponse>;
  getCapabilities(): Promise<CapabilitiesResponse>;
  listSessions(input?: ListSessionsInput): Promise<SessionsResponse>;
  getSessionDetails(
    input: SessionIdInput & { deferThinking?: boolean; deferMedia?: boolean },
  ): Promise<SessionDetailsResponse>;
  getSessionContext(
    input: SessionIdInput & { leafId?: string; deferThinking?: boolean; deferMedia?: boolean },
  ): Promise<SessionContext>;
  renameSession(input: UpdateSessionInput): Promise<SessionMutationResponse>;
  deleteSession(input: SessionIdInput): Promise<SessionMutationResponse>;
  autoNameSession(input: SessionIdInput): Promise<AutoNameResponse>;
  getSessionThinking(
    input: SessionIdInput & { entryId: string; blockIndex: number },
  ): Promise<{ thinking: string }>;
}

export interface CreatePiBackendOptions {
  piVersion: string;
  /** Injectable for tests; defaults to the process-wide runtime manager. */
  runtime?: RuntimeManager;
}

export function createPiBackend(options: CreatePiBackendOptions): PiBackend {
  const runtime = () => options.runtime ?? getRuntimeManager();
  return {
    async getHealth() {
      return {
        status: "ok",
        apiVersion: "v1",
        piVersion: options.piVersion,
      };
    },

    async getCapabilities() {
      return {
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
      };
    },

    async listSessions(input = {}) {
      return listSessionsFromServices(input, runtime());
    },
    async getSessionDetails(input) {
      return getSessionDetailsFromServices(input, runtime());
    },
    async getSessionContext(input) {
      return getSessionContextFromServices(input, runtime());
    },
    async renameSession(input) {
      return renameSessionFromServices(input);
    },
    async deleteSession(input) {
      return deleteSessionFromServices(input, runtime());
    },
    async autoNameSession(input) {
      return autoNameSessionFromServices(input, runtime());
    },
    getSessionThinking(input) {
      return getSessionThinkingFromServices(input);
    },
  };
}
```

> The existing `index.test.mjs` health/capabilities tests still pass: `createPiBackend({ piVersion: "0.84.2" })` keeps working (the new option is optional). `pi-backend-host.ts` is untouched. `web/packages/pi-backend/contracts.test.mjs` still passes: `sessions.ts` imports only `../../lib/{normalize,project-identity,session-path,project-tree,session-timing,session-title,worktree,types}` and `models.ts` will import only SDK/pi-ai — none are in the forbidden import list (the boundary test bans `next`, `react`, `@/app`, `@/components`, `@/hooks`, and the six browser-only lib modules).

- [ ] **Step 8: Run the focused suite and typecheck**

```bash
cd web && node --experimental-strip-types --test lib/rpc-manager.test.mjs lib/session-reader.test.mjs lib/models-config-store.test.mjs
cd web && node --experimental-strip-types --test packages/pi-backend/contracts.test.mjs packages/pi-backend/index.test.mjs
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint
```

Expected: all pass; `tsc` exit 0; `eslint .` exit 0. If `contracts.test.mjs` fails on a new import, the offending identifier is a banned module — fix the import, not the test.

- [ ] **Step 9: Commit**

```bash
git add web/packages/pi-backend/sessions.ts web/lib/backend-error-response.ts web/lib/session-reader.ts web/packages/pi-backend/runtime.ts web/packages/pi-backend/runtime-manager.ts web/packages/pi-backend/index.ts "web/app/api/sessions/route.ts" "web/app/api/sessions/[id]/route.ts" "web/app/api/sessions/[id]/auto-name/route.ts" "web/app/api/sessions/[id]/context/route.ts" "web/app/api/sessions/[id]/entries/[entryId]/thinking/route.ts" web/lib/rpc-manager.test.mjs
git commit -m "refactor(web): extract session services into pi-backend"
```

---

### Task 2: Create `web/packages/pi-backend/models.ts` and wrap the models route

**Files:**
- Create: `web/packages/pi-backend/models.ts`
- Modify: `web/lib/models-cache.ts`, `web/lib/model-scope.ts`, `web/lib/startup-preferences.ts` (seams), `web/packages/pi-backend/runtime.ts` + `runtime-manager.ts` (import switches), `web/app/api/models/route.ts`, `web/packages/pi-backend/index.ts` (`getModels`), `web/lib/project-trust.test.mjs` (one read)

- [ ] **Step 1: Build `web/packages/pi-backend/models.ts`**

Create the file by copying **verbatim** from the backups:

1. From `/tmp/models-cache.ts.orig` — everything: `ModelsData`, `ModelsCacheState`, the `declare global` block (`__piModelsCacheState`), `MODELS_CACHE_TTL_MS`, `MAX_MODELS_CACHE_ENTRIES`, `SAFE_MODEL_LOAD_FAILURE_MESSAGE`, `getModelsCacheState`, `invalidateModelsCache`, `withModelRuntimeError`, `withSafeModelLoadFailure`, `loadModelsWithCache`.
2. From `/tmp/model-scope.ts.orig` — everything: `ModelScopeResult`, `InitialModelScopeOptions`, `InitialModelScopeResult`, the private helpers (`matchesModel`, `hasGlob`, `exactReferenceMatches`, `assertNoAmbiguousExactPatterns`, `THINKING_LEVEL_SUFFIXES`), `resolveVisibleModels`, `selectInitialModelScope`.
3. From `/tmp/startup-preferences.ts.orig` — everything: `ExplicitStartupPreferences`, `EffectiveStartupPreferences`, `persistExplicitStartupPreferences`.

Then append the models-route assembly (moved verbatim from `/tmp/models-route.ts.orig` minus the cwd validation, which stays in the route) and the new `getModels` entry point:

```ts
const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

async function loadModels(cwd: string): Promise<ModelsData> {
  // Body of the models route's loadModels — verbatim: nameMap/modelList
  // construction, projectTrustReloadOptions(cwd, agentDir), 
  // createAgentSessionServices, modelRuntime.getError(),
  // resolveVisibleModels(services.modelRuntime, settings.getEnabledModels()),
  // the visible/thinkingLevelPins/warnings mapping, getSupportedThinkingLevels,
  // defaultProvider/defaultModelId + selectInitialModelScope, and the final
  // withModelRuntimeError(...) return.
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
};

export async function getModels(cwd: string): Promise<ModelsData> {
  try {
    return await loadModelsWithCache(cwd, () => loadModels(cwd));
  } catch {
    return withSafeModelLoadFailure(EMPTY_MODELS);
  }
}
```

The imports this file needs (paths resolve upward from `web/packages/pi-backend/`; every identifier is verified against the backups — do not add or drop any):

```ts
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionServices,
  getAgentDir,
  resolveModelScopeWithDiagnostics,
  type ModelRuntime,
  type ScopedModel,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { projectTrustReloadOptions } from "../../lib/project-trust";
```

> `models.ts` imports nothing from the package and nothing from the runtime — it is a leaf service, so there is no cycle concern. `getModels(cwd)` swallows loader failures into the stable safe-failure envelope exactly like the route's `try/catch` did; the cwd `stat`/allowed-roots validation is transport validation and stays in the route.

- [ ] **Step 2: Make the three lib modules pure re-export seams**

Replace `web/lib/models-cache.ts` with:

```ts
export {
  getModels,
  invalidateModelsCache,
  loadModelsWithCache,
  withModelRuntimeError,
  withSafeModelLoadFailure,
} from "../packages/pi-backend/models";
export type { ModelsData } from "../packages/pi-backend/models";
```

Replace `web/lib/model-scope.ts` with:

```ts
export { resolveVisibleModels, selectInitialModelScope } from "../packages/pi-backend/models";
export type {
  InitialModelScopeOptions,
  InitialModelScopeResult,
  ModelScopeResult,
} from "../packages/pi-backend/models";
```

Replace `web/lib/startup-preferences.ts` with:

```ts
export { persistExplicitStartupPreferences } from "../packages/pi-backend/models";
export type {
  EffectiveStartupPreferences,
  ExplicitStartupPreferences,
} from "../packages/pi-backend/models";
```

Check each against Pre-flight Step 2: all names preserved. `startup-preferences.ts` has no production importers after this task except its own test — the seam stays because the test imports it by that path (Phase 2's rule: never delete names from compatibility modules).

- [ ] **Step 3: Switch the runtime modules' model imports**

In `web/packages/pi-backend/runtime.ts` change line 8:

```ts
import { invalidateModelsCache } from "../../lib/models-cache";
```

to:

```ts
import { invalidateModelsCache } from "./models";
```

In `web/packages/pi-backend/runtime-manager.ts` change the three import lines **individually** (lines 11, 12, and 16 — lines 13–15 sit between them and stay untouched):

```ts
import { invalidateModelsCache } from "../../lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "../../lib/model-scope";
import { persistExplicitStartupPreferences } from "../../lib/startup-preferences";
```

to:

```ts
import { invalidateModelsCache } from "./models";
import { resolveVisibleModels, selectInitialModelScope } from "./models";
import { persistExplicitStartupPreferences } from "./models";
```

No other lines change. The call sites (`runtime.ts` lines 537/709, `runtime-manager.ts` lines 327/336/352/366) are untouched — the runtime-manager.test.mjs assertions that grep `persistExplicitStartupPreferences(`, `resolveVisibleModels(`, `selectInitialModelScope(`, `modelDefaultChanged) invalidateModelsCache()` still match because those call sites did not move.

- [ ] **Step 4: Slim the models route**

Replace `web/app/api/models/route.ts` with:

```ts
import { stat } from "fs/promises";
import { resolve } from "path";
import { getModels } from "@/lib/models-cache";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requestedCwd);

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  return Response.json(await getModels(cwd));
}
```

Wire preserved: the 400/403 bodies and statuses are byte-identical to today, and loader failures now surface through `getModels`'s internal safe-failure envelope (the route previously caught the same failures and returned `withSafeModelLoadFailure(EMPTY_MODELS)`).

- [ ] **Step 5: Add `getModels` to the facade**

Edit `web/packages/pi-backend/index.ts`: add `ListModelsInput` and `ModelsResponse` to the contract type imports, import the service function, add the method to the `PiBackend` interface, and add the implementation:

```ts
import { getModels as getModelsFromServices } from "./models";
```

```ts
  getModels(input: ListModelsInput): Promise<ModelsResponse>;
```

```ts
    getModels(input) {
      return getModelsFromServices(input.cwd);
    },
```

> `ModelsData` is structurally identical to `ModelsResponse` (plus the optional `modelError`/`modelScopeWarnings` fields), so `getModels`'s return satisfies the facade signature without a cast.

- [ ] **Step 6: Remap the one source read in `project-trust.test.mjs`**

In the test **"all project resource loaders and reloads enforce project trust"**, the models-route assembly moved, so change:

```js
const modelsSource = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
```

to:

```js
const modelsSource = await readFile(new URL("../packages/pi-backend/models.ts", import.meta.url), "utf8");
```

The two `modelsSource` assertions (`/projectTrustReloadOptions\(cwd, agentDir\)/` and `/resourceLoaderReloadOptions: trustReloadOptions/`) are unchanged — the moved body contains the same text. The test **"the trust API invalidates cached models and restricted runtimes"** needs no change: the project-trust route keeps `invalidateModelsCache()` imported from the seam, and the runtime-manager assertions are call sites that did not move.

- [ ] **Step 7: Run the focused suite and typecheck**

```bash
cd web && node --experimental-strip-types --test lib/models-cache.test.mjs lib/model-scope.test.mjs lib/startup-preferences.test.mjs lib/models-config-store.test.mjs lib/project-trust.test.mjs lib/rpc-manager.test.mjs
cd web && node --experimental-strip-types --test packages/pi-backend/contracts.test.mjs packages/pi-backend/index.test.mjs
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint
```

Expected: all pass; `tsc` exit 0; `eslint .` exit 0.

- [ ] **Step 8: Commit**

```bash
git add web/packages/pi-backend/models.ts web/lib/models-cache.ts web/lib/model-scope.ts web/lib/startup-preferences.ts web/packages/pi-backend/runtime.ts web/packages/pi-backend/runtime-manager.ts web/packages/pi-backend/index.ts web/app/api/models/route.ts web/lib/project-trust.test.mjs
git commit -m "refactor(web): extract model services into pi-backend models"
```

---

### Task 3: Convert remaining service failures to stable backend errors

**Files:**
- Modify: `web/packages/pi-backend/sessions.ts`, `web/packages/pi-backend/models.ts` (only if a stray plain throw appears), `web/lib/backend-error-response.ts` (only if a status needs adding)

- [ ] **Step 1: Sweep the services for non-coded throws**

Every failure path in the services must be a `BackendError` with the exact legacy message. After Task 1/2 the only remaining raw-propagation paths are the generic SDK/file failures (`SessionManager.open`, `appendSessionInfo`, `generateSessionTitle`, `unlinkSync`, `getSessionEntries`, `loadModels` internals). Wrap each raw error at the throw site:

```ts
} catch (error) {
  throw new BackendError("internal_error", error instanceof Error ? error.message : String(error));
}
```

in `autoNameSession` around `generateSessionTitle` and in `getSessionDetails`/`getSessionContext`/`renameSession`/`deleteSession`/`getSessionThinking` around their `SessionManager`/fs bodies. `models.ts` needs no conversion: `getModels` already converts loader failures to the safe-failure envelope, and the models route has no `{ error }`-body failure beyond its own 400/403 validation.

Verify with:

```bash
cd web && grep -n "throw new Error\|String(error)" packages/pi-backend/sessions.ts packages/pi-backend/models.ts
```

Expected: no `throw new Error` remains (only `BackendError` throws); `String(error)` appears only inside `internal_error` wrappers.

- [ ] **Step 2: Verify every modified route maps through the mapper**

The six routes rewritten in Tasks 1–2 must all import `backendErrorResponse` and use `const mapped = backendErrorResponse(error); if (mapped) return mapped;` before their legacy 500 fallback. Grep to confirm:

```bash
cd web && grep -rn "backendErrorResponse" app/api/sessions app/api/models/route.ts | wc -l
```

Expected: 6 (one per rewritten route file; `export/` and `state/` routes intentionally do not use it).

- [ ] **Step 3: Wire-shape parity spot check**

Confirm the moved bodies produce the exact legacy bodies/statuses. The preserved table (do not change any of these):

| Route | Success | Error body formatting | Statuses |
|---|---|---|---|
| `GET /api/sessions` | `{ sessions, runningSessionIds }` + `Cache-Control: no-store` | `String(error)` | 500 |
| `GET /api/sessions/[id]` | `{ sessionId, filePath, info, leafId, tree, context, totalActiveMs }` | `String(error)` | 404, 500 |
| `PATCH /api/sessions/[id]` | `{ ok: true }` | `String(error)` | 400, 404, 500 |
| `DELETE /api/sessions/[id]` | `{ ok: true }` | `String(error)` | 404, 500 |
| `POST .../auto-name` | `{ title, usage }` | `error.message` (not `String(error)`) | 404, 409, 500 |
| `GET .../context` | `{ context }` | `String(error)` | 404, 500 |
| `GET .../thinking` | `{ thinking }` | `String(error)` | 400, 404, 500 |
| `GET /api/models` | ModelsData JSON | `error: "Directory does not exist: ..."` / `"Not a directory: ..."` / `"Access denied"` | 400, 403; loader failures → safe-failure envelope |

All 4xx bodies come from `BackendError.message` with the exact legacy strings ("Session not found", "name is required", "Valid blockIndex is required", "Assistant message not found", "Thinking block not found", "The session was closed while its title was being generated. Please try again.").

- [ ] **Step 4: Run the full validation**

```bash
cd web && pnpm test
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint
```

Expected: all pass; `tsc` exit 0; `eslint .` exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/packages/pi-backend/sessions.ts web/packages/pi-backend/models.ts
git commit -m "refactor(web): convert service failures to stable backend errors"
```

---

### Task 4: Behavioral and characterization tests for the new service surfaces

**Files:**
- Create: `web/packages/pi-backend/sessions.test.mjs`, `web/packages/pi-backend/models.test.mjs`
- Modify: `web/packages/pi-backend/index.test.mjs`

- [ ] **Step 1: Write `web/packages/pi-backend/sessions.test.mjs`**

Tests use a real `RuntimeManager` over fresh state with a fake `SessionFactory` (never the Pi SDK session builder), real JSONL session files in `mkdtemp` directories seeded into the path cache via `cacheSessionPath`, and `resetSessionListState()`-style key clearing so the list-cache state is fresh per test. The session-file recipe is the same one `session-reader.test.mjs` already uses: a header line `{"type":"session","version":3,"id":...,"timestamp":...,"cwd":...,"parentSession":...}` plus message entries.

```js
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  autoNameSession,
  deleteSession,
  getSessionContext,
  getSessionDetails,
  getSessionThinking,
  listSessions,
  renameSession,
  cacheSessionPath,
} = await jiti.import("./sessions.ts");
const { BackendError } = await jiti.import("./errors.ts");
const { createRuntimeManager } = await jiti.import("./runtime-manager.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

function freshRuntime() {
  const state = {
    registry: new Map(),
    startLocks: new Map(),
    startingSessionCwds: new Map(),
    runningListeners: new Set(),
  };
  const runtime = createRuntimeManager(state, async () => {
    throw new Error("fake factory must not be called in these tests");
  });
  return { state, runtime };
}

function resetListState() {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListPromise = undefined;
  globalThis.__piSessionListPromiseGeneration = undefined;
  globalThis.__piSessionListGeneration = 0;
}

function writeSession(dir, fileName, id, parentSession) {
  const filePath = join(dir, fileName);
  writeFileSync(filePath, `${JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    ...(parentSession ? { parentSession } : {}),
  })}\n${JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "hello" } })}\n`);
  return filePath;
}

test("listSessions merges the persisted list with an empty runtime snapshot", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-list-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "list-session");
    cacheSessionPath("list-session", filePath);
    const originalListAll = SessionManager.listAll;
    SessionManager.listAll = async () => [{
      path: filePath,
      id: "list-session",
      cwd: dir,
      name: "Session",
      created: new Date("2026-01-01T00:00:00.000Z"),
      modified: new Date("2026-01-01T00:00:01.000Z"),
      messageCount: 1,
      firstMessage: "hello",
      parentSessionPath: undefined,
    }];
    try {
      const result = await listSessions({}, runtime);
      assert.equal(result.sessions.length, 1);
      assert.equal(result.sessions[0].id, "list-session");
      assert.deepEqual(result.runningSessionIds, []);
    } finally {
      SessionManager.listAll = originalListAll;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionDetails reads a cold session from its cached path", async () => {
  const { runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-details-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "cold-session");
    cacheSessionPath("cold-session", filePath);
    const details = await getSessionDetails({ sessionId: "cold-session" }, runtime);
    assert.equal(details.filePath, filePath);
    assert.equal(details.info?.id, "cold-session");
    assert.equal(details.context.messages.length, 1);
    assert.equal(details.context.messages[0].content, "hello");
    assert.ok(Number.isFinite(details.totalActiveMs));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionDetails serves a live runtime session from the registry", async () => {
  const { state, runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-live-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "live-session");
    const sm = SessionManager.open(filePath);
    state.registry.set("live-session", {
      isAlive: () => true,
      sessionFile: filePath,
      inner: { sessionManager: sm },
    });
    const details = await getSessionDetails({ sessionId: "live-session" }, runtime);
    assert.equal(details.filePath, filePath);
    assert.equal(details.info?.transient, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionDetails rejects unknown sessions as session_not_found", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  await assert.rejects(
    getSessionDetails({ sessionId: "no-such-session" }, runtime),
    (error) => error instanceof BackendError && error.code === "session_not_found" && error.message === "Session not found",
  );
});

test("getSessionContext defers assistant thinking in the returned context", async () => {
  const { runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-context-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({ type: "session", version: 3, id: "ctx-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n${JSON.stringify({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", provider: "test", model: "m", content: [{ type: "thinking", thinking: "secret reasoning" }, { type: "text", text: "answer" }] } })}\n`);
    cacheSessionPath("ctx-session", filePath);
    const context = await getSessionContext({ sessionId: "ctx-session", deferThinking: true }, runtime);
    const thinking = context.messages[0].content.find((block) => block.type === "thinking");
    assert.equal(thinking.thinking, "");
    assert.equal(thinking.deferred, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renameSession appends the new name and invalidates the list cache", async () => {
  const { runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-rename-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "rename-session");
    cacheSessionPath("rename-session", filePath);
    const result = await renameSession({ sessionId: "rename-session", name: "New Name" });
    assert.deepEqual(result, { success: true, sessionId: "rename-session" });
    assert.equal(SessionManager.open(filePath).getSessionName(), "New Name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renameSession rejects unknown sessions as session_not_found", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  await assert.rejects(
    renameSession({ sessionId: "no-such-session", name: "x" }),
    (error) => error instanceof BackendError && error.code === "session_not_found",
  );
});

test("deleteSession re-parents children, shuts down the live wrapper, and unlinks", async () => {
  const { state, runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-delete-"));
  try {
    const parentPath = writeSession(dir, "parent.jsonl", "parent-session");
    const childPath = writeSession(dir, "child.jsonl", "child-session", parentPath);
    cacheSessionPath("parent-session", parentPath);
    cacheSessionPath("child-session", childPath);
    let shutdownCalls = 0;
    state.registry.set("parent-session", {
      isAlive: () => true,
      shutdown: async () => { shutdownCalls += 1; },
    });
    const result = await deleteSession({ sessionId: "parent-session" }, runtime);
    assert.deepEqual(result, { success: true, sessionId: "parent-session" });
    assert.equal(shutdownCalls, 1);
    let parentStillExists = true;
    try { statSync(parentPath); } catch { parentStillExists = false; }
    assert.equal(parentStillExists, false);
    const childHeader = JSON.parse(readFileSync(childPath, "utf8").split("\n")[0]);
    assert.equal(childHeader.parentSession, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("autoNameSession rejects unknown sessions as session_not_found", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  await assert.rejects(
    autoNameSession({ sessionId: "no-such-session" }, runtime),
    (error) => error instanceof BackendError && error.code === "session_not_found",
  );
});

test("getSessionThinking returns a deferred thinking block", async () => {
  const { runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-thinking-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({ type: "session", version: 3, id: "think-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n${JSON.stringify({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", provider: "test", model: "m", content: [{ type: "thinking", thinking: "deferred text" }, { type: "text", text: "answer" }] } })}\n`);
    cacheSessionPath("think-session", filePath);
    const result = await getSessionThinking({ sessionId: "think-session", entryId: "a1", blockIndex: 0 });
    assert.deepEqual(result, { thinking: "deferred text" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionThinking rejects a missing or non-integer blockIndex as invalid_request", async () => {
  resetListState();
  await assert.rejects(
    getSessionThinking({ sessionId: "x", entryId: "a1", blockIndex: Number.NaN }),
    (error) => error instanceof BackendError && error.code === "invalid_request" && error.message === "Valid blockIndex is required",
  );
});
```

> Notes: the duck-typed registry entries work because jiti performs no runtime type checks — the manager methods only call the members these fakes provide. `SessionManager.open` on a temp file is real SDK parsing (same as the existing suite); no `SessionManager.create` runs, so there is no `mkdir` side effect and no HOME dependence beyond what the existing suite already has. `autoNameSession`'s happy path needs a live LLM title generation and is intentionally not unit-tested (it was not tested as a route either); the `session_not_found` path above covers its failure wiring.

- [ ] **Step 2: Write `web/packages/pi-backend/models.test.mjs`**

The scope/cache/preferences unit behavior is already covered by `models-cache.test.mjs`, `model-scope.test.mjs`, and `startup-preferences.test.mjs` (still green through the seams). `getModels` itself is SDK-bound (`createAgentSessionServices` never throws — it populates `modelRuntime.getError()` instead, and jiti snapshots bare-function bindings so monkey-patching the SDK does not propagate), so this file is an integration smoke test with tolerant shape assertions:

```js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { getModels, invalidateModelsCache } = await jiti.import("./models.ts");

test("getModels returns a ModelsData-shaped catalog for a real services instance", async () => {
  invalidateModelsCache();
  const cwd = mkdtempSync(join(tmpdir(), "pi-backend-models-"));
  try {
    const data = await getModels(cwd);
    assert.equal(typeof data.models, "object");
    assert.ok(Array.isArray(data.modelList));
    assert.equal(typeof data.thinkingLevels, "object");
    assert.equal(typeof data.thinkingLevelMaps, "object");
    assert.equal(typeof data.thinkingLevelPins, "object");
    assert.ok(data.defaultModel === null || typeof data.defaultModel === "object");
    assert.ok(data.modelError === undefined || typeof data.modelError === "string");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Add facade wiring tests to `index.test.mjs`**

`web/packages/pi-backend/index.test.mjs` already creates a `jiti` and imports `createPiBackend` at the top. Extend its top imports to add the fs/os/path helpers it lacks (it currently imports only `assert`, `test`, and `createJiti`):

```js
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Then append below the existing `jiti.import` block (reusing the existing `jiti` instance and adding the new imports to it):

```js
const { createRuntimeManager } = await jiti.import("./runtime-manager.ts");
const { cacheSessionPath } = await jiti.import("./sessions.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

test("PiBackend.listSessions delegates to the session service with the injected runtime", async () => {
  const state = { registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() };
  const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager(state, async () => { throw new Error("factory unused"); }) });
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-facade-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({ type: "session", version: 3, id: "facade-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n`);
    cacheSessionPath("facade-session", filePath);
    globalThis.__piSessionListCache = undefined;
    globalThis.__piSessionListGeneration = 0;
    const originalListAll = SessionManager.listAll;
    SessionManager.listAll = async () => [{
      path: filePath, id: "facade-session", cwd: dir, name: "S",
      created: new Date("2026-01-01T00:00:00.000Z"), modified: new Date("2026-01-01T00:00:00.000Z"),
      messageCount: 0, firstMessage: "(no messages)", parentSessionPath: undefined,
    }];
    try {
      const result = await backend.listSessions({});
      assert.deepEqual(result.runningSessionIds, []);
      assert.equal(result.sessions[0].id, "facade-session");
    } finally {
      SessionManager.listAll = originalListAll;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PiBackend.getModels delegates to the model service", async () => {
  const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager({ registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() }, async () => { throw new Error("factory unused"); }) });
  const cwd = mkdtempSync(join(tmpdir(), "pi-backend-facade-models-"));
  try {
    const data = await backend.getModels({ cwd });
    assert.ok(Array.isArray(data.modelList));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run the new tests plus typecheck and lint**

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/sessions.test.mjs packages/pi-backend/models.test.mjs packages/pi-backend/index.test.mjs
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint
```

Expected: all pass; `tsc` exit 0; `eslint .` exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/packages/pi-backend/sessions.test.mjs web/packages/pi-backend/models.test.mjs web/packages/pi-backend/index.test.mjs
git commit -m "test(web): characterize pi-backend session and model services"
```

---

### Task 5: Phase-boundary audit and parity proof

- [ ] **Step 1: Full suite, typecheck, lint**

```bash
cd web && pnpm test && pnpm exec tsc --noEmit && pnpm lint
```

Expected: **826 (Phase 2) + 15 new = 841 pass** (adjust to the actual count if the runner reports differently); `tsc` exit 0; `eslint .` exit 0.

- [ ] **Step 2: Prove the runtime globalThis keys stayed out of the services**

```bash
cd web
grep -n "__piSessions\|__piStartLocks\|__piStartingSessionCwds\|__piRunningListeners" packages/pi-backend/sessions.ts packages/pi-backend/models.ts || echo "no runtime keys in service code"
```

Expected: no output — those four keys belong to `lib/runtime-state.ts` (Phase 2) and must not appear in either service. The services' own cache keys (`__piSessionPathCache`, `__piPathToSessionIdCache`, `__piSessionList*`, `__piModelsCacheState`) are expected and unchanged.

- [ ] **Step 3: Prove no transport or Phase 4 scope entered the diff**

```bash
cd web
grep -rn "api/v1\|new WebSocket\|EventSource" packages/pi-backend/sessions.ts packages/pi-backend/models.ts || echo "no transport in service code"
git diff --stat -- app/api hooks components lib/agent-client.ts
git diff --check
```

Expected: no transport references in the services (`EventSource`/`WebSocket` appear nowhere; the word `"sse"` appears only in `contracts.ts`'s capabilities, which is Phase 1); the route diff touches only the six rewritten route files; `git diff --check` emits nothing.

- [ ] **Step 4: Parity proof**

```bash
cd web
diff /tmp/session-reader.ts.orig <(sed -n '1,/^export async function listSessions/p' packages/pi-backend/sessions.ts | head -n -1) > /dev/null && echo "moved lib bodies match verbatim"
grep -n "^export " lib/session-reader.ts lib/models-cache.ts lib/model-scope.ts lib/startup-preferences.ts
```

Re-run Pre-flight Step 2's greps on the seams and diff the names against the frozen lists. Keep the plan doc untracked. Commit any remaining `web/**` change (expected: none) or skip.

---

## Roadmap-required Phase 3 verification, mapped

- **Backend methods and existing routes produce equivalent session/model data for representative cold, running, branched, and deferred sessions** → Task 1 moves the exact route bodies into `getSessionDetails`/`getSessionContext`/`getSessionThinking` (cold = Task 4 test 2, running = Task 4 test 3, branched/deferred = Task 4 tests 5 and 10, plus `session-reader.test.mjs` context/branch tests staying green); Task 2 moves the exact models assembly into `getModels` (Task 4 models test).
- **Session deletion coordinates with live runtime cleanup and preserves current child re-parenting behavior** → Task 1 `deleteSession` (ordering preserved: re-parent → `runtime.getSession(id)?.shutdown()` → unlink → invalidate); Task 4 test 8 (shutdown spy + re-parented child header); Task 1 Step 6 remaps `rpc-manager.test.mjs`'s shutdown assertion to the service.
- **Model scope patterns, thinking pins, warnings, and fallback behavior remain unchanged** → Task 2 moves `model-scope.ts`/`models-cache.ts`/`startup-preferences.ts` verbatim; `model-scope.test.mjs`, `models-cache.test.mjs`, `startup-preferences.test.mjs`, and the models route's safe-failure envelope (inside `getModels`) stay green.
- **Existing tests, typecheck, and lint remain green** → Task 1 Step 8, Task 2 Step 7, Task 3 Step 4, Task 5 Step 1.
- **Routes no longer coordinate Pi lifecycle directly** → Task 1 Step 5 and Task 2 Step 4 replace every `SessionManager.open`/`createAgentSessionServices` call in the six routes with seam calls; `project-trust.test.mjs` and `rpc-manager.test.mjs` verify the moved call sites live in the services.

## Risks and countermeasures

- **Cache-invalidation coupling (double import/cycle):** `invalidateSessionListCache`/`cacheSessionPath` are used by BOTH `session-reader` consumers AND `runtime.ts`/`runtime-manager.ts`. After Task 1 both runtime modules import them from `./sessions` directly, while routes reach the same functions through the seam — one module instance, one cache. The sessions service must **never** runtime-import `runtime-manager.ts`; the `RuntimeManager` parameter is type-only (erased), so the sessions→runtime-manager→sessions edge is acyclic at runtime. Task 5 Step 2 and the `contracts.test.mjs` boundary run prove it.
- **Seam export churn:** never delete names from `session-reader.ts`, `models-cache.ts`, `model-scope.ts`, or `startup-preferences.ts` — routes, `file-access.ts`, `session-file-references.ts`, `models-config-store.ts`, `zosma-auth/index.ts`, auth routes, and jiti tests import them by name. Drift is caught immediately: tsc covers names only production imports, and the jiti test imports cover the rest.
- **Wire-shape preservation:** every 4xx body comes from a `BackendError` carrying the exact legacy message; every route keeps its legacy 500 formatting (`String(error)` everywhere except auto-name's `error.message`). Task 3 Step 3's table is the ground truth; the mapper returns `null` for non-`BackendError` so unknown failures keep the legacy fallback byte-for-byte.
- **Live state vs JSONL disagreement:** preserved — `getSessionDetails`/`getSessionContext` keep the current authority rule (live runtime first, JSONL snapshot otherwise); no second cache was introduced.
- **Project grouping / parent-session / deep-export safeguards:** `attachSessionProjectInfo` moves with `resolveProject` untouched; the DELETE re-parent scan and the export route's `patchExportHtml`/bounded reads move or stay verbatim (export stays entirely). No safeguard semantics change.
- **BackendError code fidelity for entry/block 404s:** `getSessionThinking` uses `session_not_found` for "Assistant message not found"/"Thinking block not found" because it is the closest stable code that maps to 404; the exact legacy message is preserved. Phase 4 assigns precise read-contract codes.
- **SessionManager.create side effects in tests:** Task 4 tests never call `SessionManager.create` (only `open` on temp files), so no `mkdir` under `~/.pi/agent` is triggered. The one `listSessions` test mocks `SessionManager.listAll` on the shared SDK class (the same pattern `session-reader.test.mjs` already uses — it works because the class object identity is shared; jiti does **not** propagate patches to bare function exports, which is why `models.test.mjs` uses real services instead of monkey-patching).
- **Intermediate state:** Task 1 and Task 2 commits are each green on their own — Task 1 does not touch the model seams, and Task 2 finishes them. There is no window where a seam points at a missing service module. Do not stop the branch mid-task.
- **Facade weight:** `index.ts` now imports `runtime-state.ts` (allowed by the Phase 1 boundary test), so jiti facade tests load the runtime stack; the `runtime?` option lets tests inject fresh managers instead of touching `globalThis`.

## Out-of-scope

- `/api/v1` routes, envelope helpers, HTTP status mapping for the versioned API, browser client migration, and SSE/WebSocket/gRPC transports (Phases 4–7).
- Changing `web/lib/pi-backend-host.ts`, hooks, components, `agent-client.ts`, or any route other than the six rewritten files.
- Provider credential management, editable model configuration, and auth flows.
- Workspace/file, Git/worktree, skills/plugins, or app-update extraction.
- Deleting the compatibility seams or renaming any `globalThis` key.
- Adding codes to `errors.ts` or new DTOs to `contracts.ts`.

---

Plan complete. Ready to execute this phase with /skill:executing-plans (it intentionally does not start Phase 4).
