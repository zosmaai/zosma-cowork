# Modular Headless Pi Backend Phase 2 Implementation Plan — Runtime Manager and Event-Source Extraction

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the live Pi session runtime (the `AgentSessionWrapper`, the session registry, shared cold-start locks, idle shutdown, and transport-neutral running-session/event subscriptions) out of `web/lib/rpc-manager.ts` into `web/packages/pi-backend/` so later `/api/v1` phases reuse one runtime without touching route transport code.

**Architecture:** `web/packages/pi-backend/runtime.ts` owns the `AgentSessionWrapper` class: a transport-neutral session facade covering events, extension UI adaptation, command dispatch, prompt admission, idle timeout, and teardown. `web/packages/pi-backend/runtime-manager.ts` owns the live-session registry: cold-start locking, per-cwd busy tracking, running-session subscriptions, and session construction, with the expensive SDK session builder injected as a `SessionFactory` so the registry logic is unit-testable without the Pi SDK. The `globalThis` keys and `process.once` cleanup that survive Next.js hot reload move to `web/lib/runtime-state.ts` (host composition, a plain module so the jiti-run tests can import it). `web/lib/rpc-manager.ts` becomes a thin compatibility seam re-exporting the same public names, so every route and test that imports `@/lib/rpc-manager` keeps working.

**Tech Stack:** TypeScript 5, Pi SDK (`@earendil-works/pi-coding-agent`), Node.js test runner + `jiti`, Next.js 16, pnpm.

**Roadmap:** `docs/superpowers/roadmaps/2026-09-07-modular-headless-pi-backend-roadmap.md`

**Phase:** Phase 2: Runtime Manager and Event Source Extraction

---

## Phase Boundary

This plan moves and delegates **existing, already-tested runtime behavior**. It does **not** redesign `AgentSessionWrapper`, prompt admission, the ten-minute idle shutdown, event semantics, or extension UI adaptation. Two deliberate, test-backed changes are permitted:

1. The wrapper gains an optional second constructor argument, `hooks?: { notifyRunningChange?: () => void }`, because after the file split the class can no longer call the registry's free function without a circular import. Production wiring injects it; the existing wrapper tests pass `undefined` (a no-op, matching today when no listeners exist).
2. The old `startRpcSession` body splits into coordination (locks, registry, cwd tracking — `RuntimeManager.startSession`) and SDK construction (wholesale into the default `startAgentSession` factory). The observable ordering is preserved exactly.

This plan intentionally does **not**:

- Touch any route under `web/app/api/`, the browser client, hooks, or components.
- Rename the four `globalThis` keys (`__piSessions`, `__piStartLocks`, `__piStartingSessionCwds`, `__piRunningListeners`) — `rpc-session-info.test.mjs` hard-codes `__piSessions`.
- Add `/api/v1` routes, SSE framing, WebSocket, gRPC, or a standalone process.
- Change `web/packages/pi-backend/index.ts` (the public facade stays at Phase 1 scope; transport-neutral subscriptions ride the runtime manager and the legacy seam until Phase 4 wires route adapters).

**Phase boundary health:** every endpoint and existing test keeps working because the legacy seam delegates every name to the single process-wide runtime manager (one registry, one lock table, one listener set), and the source-scan tests still characterize the same code in its new home.

---

## File Structure

### Create

- `web/packages/pi-backend/runtime.ts` — moved `AgentSessionWrapper` plus its private support types/UI plumbing. No `globalThis`, no `process`.
- `web/packages/pi-backend/runtime-manager.ts` — registry, locks, cwd tracking, running listeners, `RuntimeManager` class, default `startAgentSession` factory. No `globalThis`, no `process`.
- `web/lib/runtime-state.ts` — `globalThis` keys + first-access creation + `process.once` cleanup + the process-wide `getRuntimeManager()` singleton. Host composition; deliberately **not** `server-only` (jiti tests import it).
- `web/packages/pi-backend/runtime-manager.test.mjs` — behavior tests using an injected fake `SessionFactory` and fresh state (no SDK, no `globalThis`).

### Modify

- `web/lib/rpc-manager.ts` — compatibility seam (full content in Task 3 Step 5).
- `web/lib/rpc-manager.test.mjs` — remap source-scan read paths + add seam-parity test.
- `web/lib/project-trust.test.mjs` — remap two source reads to `runtime-manager.ts` / `runtime.ts`.

### Explicitly unchanged

- `web/app/api/**`, `web/lib/agent-event-*.ts`, `web/components/**`, `web/hooks/**`, the browser API client, `web/packages/pi-backend/{contracts,errors,index}.ts`, `web/lib/pi-backend-host.ts`, `web/lib/rpc-manager-shutdown.test.mjs`, `web/lib/rpc-manager-widgets.test.mjs`, `web/lib/rpc-session-info.test.mjs`.

---

## Pre-flight

- [ ] **Step 1: Verify the Phase 1 baseline**

```bash
cd web && pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm lint
```

Expected: 817 tests pass; `tsc --noEmit` exit 0; `eslint .` exit 0.

- [ ] **Step 2: Freeze the module surface**

```bash
grep -n "^export " web/lib/rpc-manager.ts
```

Expected exactly: `AgentEvent`, `RpcSessionStartOptions` (types), `AgentSessionWrapper` (class), `getRpcSession`, `getRpcSessionInfos`, `hasBusyRpcSessionForCwd`, `destroyRpcSessionsForCwd`, `getRunningRpcSessionIds`, `subscribeRunningSessions`, `notifyRunningChange`, `startRpcSession`. Task 3's seam must re-export the same set with the same names.

- [ ] **Step 3: Inventory consumers and source-scan tests**

```bash
grep -rln "rpc-manager" web/lib/*.test.mjs
grep -rln "@/lib/rpc-manager" web/app web/hooks web/components
```

Keep this output open; Task 1 Step 4 and Task 3 Steps 6–7 use it.

- [ ] **Step 4: Back up the file for move-diffing**

```bash
cp web/lib/rpc-manager.ts /tmp/rpc-manager.ts.orig
```

---

### Task 1: Create `web/packages/pi-backend/runtime.ts` (move the wrapper class)

**Files:**
- Create: `web/packages/pi-backend/runtime.ts`
- Modify: `web/lib/rpc-manager.ts` (strip the class; add a re-export)
- Modify: `web/lib/rpc-manager.test.mjs` (class-relative assertions read the new file)

- [ ] **Step 1: Build the new file**

Create `web/packages/pi-backend/runtime.ts` by copying **verbatim** from `web/lib/rpc-manager.ts` the region starting at the `// Types` comment through the end of the `AgentSessionWrapper` class (stop before the `// Session registry` comment):

1. The private types used only by the wrapper: `EventListener`, `PendingUiResponse`, `CustomUiComponent`, `ExtensionWidgetComponent`, `ExtensionWidgetFactory`, `ActiveExtensionWidget`, `ActiveCustomUi`, `ExtensionUiRequestBody`, `ExtensionCommandContextActionsLike`, `ExtensionBindingOptions`.
2. The constants `RUNNING_STATE_EVENT_TYPES`, `IDLE_RESET_EVENT_TYPES`, `CODING_TOOL_NAMES`, `class PlainTextTheme`, `PLAIN_TEXT_THEME`, `CUSTOM_UI_KEYBINDINGS`, and `withExtensionTools`.
3. `export interface AgentEvent` and the complete `export class AgentSessionWrapper` (every public and `private` member — the widget/shutdown tests reach private members like `createExtensionUiContext` through jiti, so names must not change).

The new file's imports are (paths resolve from `web/packages/pi-backend/` upward to `web/lib/`):

```ts
import { getAgentDir, SessionManager, Theme } from "@earendil-works/pi-coding-agent";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, writeFileSync } from "fs";
import { validateAgentImages } from "../../lib/image-attachments";
import { invalidateModelsCache } from "../../lib/models-cache";
import { createProjectCommandBashOperations } from "../../lib/project-command-env";
import { cacheSessionPath, invalidateSessionListCache } from "../../lib/session-reader";
import { getProjectTrustStatus } from "../../lib/project-trust";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "../../lib/pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "../../lib/types";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS, type HeadlessCustomUiTui } from "../../lib/custom-ui-terminal";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface AgentRuntimeHooks {
  notifyRunningChange?: () => void;
}
```

> Note: `SessionManager` is imported because the class's fork branch calls `SessionManager.create`/`SessionManager.open`; `getAgentDir` is used by `syncProjectTrust`; `invalidateModelsCache` fires in the `set_model`/`reload` cases. `SessionMessageEntry` is deliberately **not** imported: it is used only by the registry helpers (`runtimeMessageText`/`runtimeMessageActivityMs`/`getSessionInfos`) that stay behind in `rpc-manager.ts` until Task 3.

- [ ] **Step 2: Make the two surgical edits**

**Constructor** — add the optional hooks parameter:

```ts
  constructor(
    public readonly inner: AgentSessionLike,
    private readonly hooks: AgentRuntimeHooks = {},
  ) {}
```

**Running notifications** — replace every bare `notifyRunningChange()` call inside the class with `this.hooks.notifyRunningChange?.()`. Occurrences: `start()` twice, `withFinalRunningNotification()`, `send()` → `prompt` twice (after `pendingPromptCount += 1`; inside `finishPrompt`), `send()` → `bash` twice (after `executeBash`; in `finally`), `destroy()` (in `finally`). Then verify:

```bash
grep -n "notifyRunningChange" web/packages/pi-backend/runtime.ts
```

Expected: only `this.hooks.notifyRunningChange?.()` references remain.

- [ ] **Step 3: Strip the class from `rpc-manager.ts` and re-export**

Delete the moved code (class + the only-class private types/constants/`PlainTextTheme`/`withExtensionTools`/`CUSTOM_UI_KEYBINDINGS`) from `web/lib/rpc-manager.ts`, and remove the now-unused imports (`Theme`, `TuiKeybindingsManager`, `TUI_KEYBINDINGS`, `randomUUID`, `writeFileSync`, `validateAgentImages`, `createProjectCommandBashOperations`, `getProjectTrustStatus`, `SlashCommandInfo`, `AgentSessionLike`, `ExtensionUiContextLike`, `ToolInfo`, `ExtensionUiRequest`, `ExtensionUiResponse`, `ExtensionWidgetItem`, `HeadlessCustomUiTui`, `createHeadlessCustomUiTui`, `DEFAULT_CUSTOM_UI_COLUMNS`). Do **not** remove `SessionManager`, `getAgentDir`, `invalidateModelsCache`, `SessionMessageEntry`, `existsSync`, `realpathSync`, or `resolve` — the still-present registry code (`getRpcSessionInfos`, `startRpcSession`) uses them until Task 3. Keep `RUNNING_STATE_EVENT_TYPES`/`IDLE_RESET_EVENT_TYPES` only if the remaining registry code uses them (grep; delete if unused).

Then add at the top:

```ts
export { AgentSessionWrapper } from "../packages/pi-backend/runtime";
export type { AgentEvent, AgentRuntimeHooks } from "../packages/pi-backend/runtime";
```

and add a type-only import so the registry code keeps its `Map<string, AgentSessionWrapper>` types:

```ts
import type { AgentSessionWrapper } from "../packages/pi-backend/runtime";
```

- [ ] **Step 4: Remap the class-relative assertions in `rpc-manager.test.mjs`**

For each assertion that slices wrapper-class code (search strings `start(): void`, `setForceEmptySystemPrompt`, `private resetIdleTimer`, `private persistBashOnlySession`, `private requestExtensionCustomUi`, `case "fork"`, `case "reload"`), change only its source read to:

```js
const source = await readFile(new URL("../packages/pi-backend/runtime.ts", import.meta.url), "utf8");
```

Leave registry-relative assertions (`export function notifyRunningChange`, `declare global`, `startRpcSession`) pointing at `./rpc-manager.ts` until Task 3 (Step 6 remaps them).

- [ ] **Step 5: Run the wrapper tests and typecheck**

```bash
cd web && node --experimental-strip-types --test lib/rpc-manager-shutdown.test.mjs lib/rpc-manager-widgets.test.mjs lib/rpc-session-info.test.mjs lib/rpc-manager.test.mjs
cd web && pnpm exec tsc --noEmit
```

Expected: all pass; `tsc` exit 0.

- [ ] **Step 6: Run the pi-backend boundary test**

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/contracts.test.mjs
```

Expected: PASS (`runtime.ts` imports only `../../lib/...` and Pi packages; the Phase 1 scan forbids `next`/`react`/`app`/`components`/`hooks`).

- [ ] **Step 7: Commit**

```bash
git add web/packages/pi-backend/runtime.ts web/lib/rpc-manager.ts web/lib/rpc-manager.test.mjs
git commit -m "refactor(web): move AgentSessionWrapper into pi-backend runtime"
```

---

### Task 2: Create `web/lib/runtime-state.ts` (host composition)

**Files:**
- Create: `web/lib/runtime-state.ts`

Why a separate plain module (not `server-only`): `rpc-session-info.test.mjs` writes `globalThis.__piSessions` and calls the legacy function; the jiti tests must be able to import the seam and reach the same keys. Keeping the keys here preserves that contract exactly, and it keeps `globalThis`/`process` out of the package.

Note: the spec's example puts host composition in the server-only `web/lib/pi-backend-host.ts`, but that file owns only the `PiBackend` facade singleton; the runtime `globalThis` keys live here because the tests and the legacy seam must reach them directly. The facade singleton stays exactly where Phase 1 put it.

- [ ] **Step 1: Write the file in full**

```ts
import {
  createRuntimeManager,
  type ColdStartPromise,
  type RuntimeManager,
  type RuntimeState,
} from "../packages/pi-backend/runtime-manager";
import type { AgentSessionWrapper } from "../packages/pi-backend/runtime";

// The four keys below are a deliberate compatibility contract:
// - web/lib/rpc-session-info.test.mjs writes `globalThis.__piSessions`
//   directly and calls the legacy `getRpcSessionInfos()`.
// - Hot reload must survive with one registry, one lock table, and one
//   listener set per process.
// Do not rename these keys without updating both files.

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, ColdStartPromise> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
  var __piRuntimeManager: RuntimeManager | undefined;
}

export function getRuntimeState(): RuntimeState {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((session) => session.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  if (!globalThis.__piStartingSessionCwds) globalThis.__piStartingSessionCwds = new Map();
  if (!globalThis.__piRunningListeners) globalThis.__piRunningListeners = new Set();
  return {
    registry: globalThis.__piSessions,
    startLocks: globalThis.__piStartLocks,
    startingSessionCwds: globalThis.__piStartingSessionCwds,
    runningListeners: globalThis.__piRunningListeners,
  };
}

export function getRuntimeManager(): RuntimeManager {
  return (globalThis.__piRuntimeManager ??= createRuntimeManager(getRuntimeState()));
}
```

> The `process.once("exit"...)` cleanup registers only when the registry map is first created — exactly the current `getRegistry()` semantics: hot reload finds the existing map and does not re-register.

- [ ] **Step 2: Does not compile until Task 3** (`runtime-manager` is a type-only skeleton then). Do **not** commit this file alone; it ships in Task 3's commit.

---

### Task 3: Implement `web/packages/pi-backend/runtime-manager.ts` and swap `rpc-manager.ts` to the seam

**Files:**
- Create: `web/packages/pi-backend/runtime-manager.ts` (types + `RuntimeManager` class + `startAgentSession` + `createRuntimeManager`)
- Modify: `web/lib/rpc-manager.ts` (pure seam — full content below)
- Modify: `web/lib/rpc-manager.test.mjs` (remap remaining reads; add parity test)
- Modify: `web/lib/project-trust.test.mjs` (remap reads)

- [ ] **Step 1: Types (top of the new file)**

```ts
import type { AgentSessionLike } from "../../lib/pi-types";
import type { AgentSessionWrapper } from "./runtime";

export interface RpcSessionStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: import("@earendil-works/pi-agent-core").ThinkingLevel;
}

export type RuntimeSessionResult = { session: AgentSessionWrapper; realSessionId: string };
export type ColdStartPromise = Promise<RuntimeSessionResult>;

export interface RuntimeState {
  registry: Map<string, AgentSessionWrapper>;
  startLocks: Map<string, ColdStartPromise>;
  startingSessionCwds: Map<string, number>;
  runningListeners: Set<(ids: string[]) => void>;
}

/**
 * Builds the inner Pi session only. Registry wiring, locks, cwd tracking, and
 * wrapper construction happen in RuntimeManager.startSession, so tests can
 * substitute a fake factory and never touch the Pi SDK.
 */
export type SessionFactory = (
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions,
) => Promise<{ inner: AgentSessionLike; realSessionId: string }>;
```

- [ ] **Step 2: Implement `RuntimeManager` with the moved registry bodies**

The registry helpers are the current module functions moved into methods, with these substitutions:

- `getRegistry()` → `this.state.registry`
- `getLocks()` → `this.state.startLocks`
- `getStartingSessionCwds()` → `this.state.startingSessionCwds`
- `getRunningListeners()` → `this.state.runningListeners`
- `lastRunningSnapshot` → `private lastRunningSnapshot = ""`
- `normalizeRpcCwd(cwd)` stays a module free function (`resolve` + `realpathSync`).

Full class (bodies are the existing implementations; only the four substitutions differ):

```ts
export class RuntimeManager {
  private lastRunningSnapshot = "";

  constructor(
    private readonly state: RuntimeState,
    private readonly createSession: SessionFactory = startAgentSession,
  ) {}

  getSession(sessionId: string): AgentSessionWrapper | undefined {
    return this.state.registry.get(sessionId);
  }

  getSessionInfos(): SessionInfo[] {
    // Body of getRpcSessionInfos (iterates this.state.registry, reads
    // session.isAlive()/inner.sessionManager, filters unpersisted idle
    // sessions) — verbatim.
  }

  hasBusySessionForCwd(cwd: string): boolean {
    // Body of hasBusyRpcSessionForCwd (normalizeRpcCwd + startingSessionCwds + scan)
  }

  async destroySessionsForCwd(cwd: string): Promise<number> {
    // Body of destroyRpcSessionsForCwd (Promise.all shutdown) — verbatim.
  }

  getRunningSessionIds(): string[] {
    // Body of getRunningRpcSessionIds — verbatim.
  }

  subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
    const listeners = this.state.runningListeners;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  notifyRunningChange(): void {
    // Body of notifyRunningChange (no-listeners → reset lastRunningSnapshot;
    // else compute ids, skip if snapshot unchanged, broadcast) — verbatim,
    // using this.lastRunningSnapshot.
  }

  async startSession(
    sessionId: string,
    sessionFile: string,
    cwd: string | undefined,
    options: RpcSessionStartOptions = {},
  ): Promise<RuntimeSessionResult> {
    const { toolNames, initialModel, thinkingLevel } = options;
    const registry = this.state.registry;
    const locks = this.state.startLocks;

    const existing = registry.get(sessionId);
    if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };
    const inflight = locks.get(sessionId);
    if (inflight) return inflight;

    let sessionManager: SessionManager;
    if (sessionFile) {
      sessionManager = SessionManager.open(sessionFile, undefined);
    } else {
      if (!cwd) throw new Error("cwd is required for a new session");
      sessionManager = SessionManager.create(cwd, undefined);
    }
    const sessionCwd = sessionManager.getCwd();
    const finishStartingSession = this.trackStartingSession(sessionCwd);

    const starting = (async () => {
      const { inner, realSessionId } = await this.createSession(
        sessionId, sessionFile, cwd, { toolNames, initialModel, thinkingLevel },
      );

      const wrapper = new AgentSessionWrapper(inner, {
        notifyRunningChange: () => this.notifyRunningChange(),
      });
      // Preserve the original ordering exactly:
      // wrapper.start() publishes session_start, then path cache, then registry.
      if (toolNames?.length === 0) wrapper.setForceEmptySystemPrompt(true);
      wrapper.start();

      const realSessionFile = inner.sessionFile as string | undefined;
      if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

      wrapper.onDestroy(() => registry.delete(realSessionId));
      registry.set(realSessionId, wrapper);
      wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

      return { session: wrapper, realSessionId };
    })().finally(() => {
      locks.delete(sessionId);
      finishStartingSession();
    });

    locks.set(sessionId, starting);
    return starting;
  }

  private trackStartingSession(cwd: string): () => void {
    const startingCwds = this.state.startingSessionCwds;
    const key = normalizeRpcCwd(cwd);
    startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
    return () => {
      const remaining = (startingCwds.get(key) ?? 1) - 1;
      if (remaining > 0) startingCwds.set(key, remaining);
      else startingCwds.delete(key);
    };
  }
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}
```

- [ ] **Step 3: The default SDK factory (moved verbatim)**

```ts
export async function startAgentSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions,
): Promise<{ inner: AgentSessionLike; realSessionId: string }> {
  // The FULL original startRpcSession body (initTheme → toolsOption → services →
  // resolveVisibleModels/selectInitialModelScope → createAgentSessionFromServices →
  // persistExplicitStartupPreferences → withExtensionTools/active tools),
  // MINUS the wrapper construction and registry wiring (new home:
  // RuntimeManager.startSession). Returns { inner, realSessionId }.
  // The `export async function startRpcSession` name is replaced by this one.
}

export function createRuntimeManager(
  state: RuntimeState,
  factory: SessionFactory = startAgentSession,
): RuntimeManager {
  return new RuntimeManager(state, factory);
}
```

> The heavy lifting the original `startRpcSession` did (SDK services, trust, model resolution, the `const { session: inner }` destructuring) stays in the factory; the map/registry/tracking/`beginExtensionBinding` stays in the manager. The `initTheme`/`withExtensionTools`/`persistExplicitStartupPreferences`/`invalidateModelsCache` calls stay in the factory.

- [ ] **Step 4: Imports the runtime-manager file needs (beyond Step 1's)**

```ts
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "fs";
import { resolve } from "path";
import { invalidateModelsCache } from "../../lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "../../lib/model-scope";
import { createProjectCommandBashExtension, preferUserBashExtension } from "../../lib/project-command-env";
import { cacheSessionPath } from "../../lib/session-reader";
import { projectTrustReloadOptions } from "../../lib/project-trust";
import { persistExplicitStartupPreferences } from "../../lib/startup-preferences";
import type { SessionInfo, SessionMessageEntry } from "../../lib/types";
import { AgentSessionWrapper } from "./runtime";
```

> Note: `invalidateSessionListCache` is not imported — it was used only by the wrapper class, so it moved to `runtime.ts` (Task 1). `SessionMessageEntry` is required here by the moved helpers (`runtimeMessageText`/`runtimeMessageActivityMs` behind `getSessionInfos`).

- [ ] **Step 5: Make `rpc-manager.ts` the pure seam**

Replace the whole file with (check against Pre-flight Step 2: all names, same signatures):

```ts
import { getRuntimeManager } from "./runtime-state";
import type { RpcSessionStartOptions } from "../packages/pi-backend/runtime-manager";

export { AgentSessionWrapper } from "../packages/pi-backend/runtime";
export type { AgentEvent, AgentRuntimeHooks } from "../packages/pi-backend/runtime";
export type { RpcSessionStartOptions } from "../packages/pi-backend/runtime-manager";

export function getRpcSession(sessionId: string) {
  return getRuntimeManager().getSession(sessionId);
}
export function getRpcSessionInfos() {
  return getRuntimeManager().getSessionInfos();
}
export function hasBusyRpcSessionForCwd(cwd: string) {
  return getRuntimeManager().hasBusySessionForCwd(cwd);
}
export async function destroyRpcSessionsForCwd(cwd: string) {
  return getRuntimeManager().destroySessionsForCwd(cwd);
}
export function getRunningRpcSessionIds() {
  return getRuntimeManager().getRunningSessionIds();
}
export function subscribeRunningSessions(listener: (ids: string[]) => void) {
  return getRuntimeManager().subscribeRunningSessions(listener);
}
export function notifyRunningChange() {
  return getRuntimeManager().notifyRunningChange();
}
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
) {
  return getRuntimeManager().startSession(sessionId, sessionFile, cwd, options);
}
```

> `AgentSessionWrapper` is exported as a value from the runtime module, so consumers that `import type { AgentSessionWrapper }` from the seam get it from that value re-export — do not add a second type-only re-export of the same name.

- [ ] **Step 6: Remap the registry assertions in `rpc-manager.test.mjs`**

For each registry-relative assertion (still reading `./rpc-manager.ts` and slicing the old free-function bodies), point the read at `../packages/pi-backend/runtime-manager.ts` and remap by test title:

- Tests "RPC session startup preloads extension-registered providers before restoring models", "RPC session startup resolves and passes the SDK-native enabled model scope", "RPC session startup treats only sessions with messages as continuing", and "RPC session startup persists explicit preferences without replaying setters": slice from `"export async function startAgentSession"` (the moved SDK body lives there now; the old `"export async function startRpcSession"` anchor no longer exists).
- Test "RPC session startup opens an existing session file only once and trusts its cwd": read the whole `runtime-manager.ts` and drop the slice. Its assertions — exactly one `SessionManager.open(`, `const sessionCwd = sessionManager.getCwd()`, `projectTrustReloadOptions(sessionCwd, agentDir)`, `cwd: sessionCwd` — now describe `RuntimeManager.startSession`, which sits above the factory anchor, so all four hold on a whole-file read.
- Test "RPC wrapper avoids per-chunk idle and running-state maintenance", `notifySource` half: slice from `"notifyRunningChange(): void"` to `"startSession("` (method anchors in `RuntimeManager`; the old free-function anchors `export function notifyRunningChange` / `export async function startRpcSession` no longer exist). Its `startSource` half (`"  start(): void"` → `"  setForceEmptySystemPrompt"`) was already remapped in Task 1 Step 4.

Route-file reads (`../app/api/agent/[id]/route.ts`, events route, auto-name, session routes) stay unchanged.

- [ ] **Step 7: Remap `project-trust.test.mjs`**

Replace the reads:

```js
const runtimeSource = await readFile(new URL("../packages/pi-backend/runtime.ts", import.meta.url), "utf8");
const managerSource = await readFile(new URL("../packages/pi-backend/runtime-manager.ts", import.meta.url), "utf8");
```

Assertions move to `managerSource`: `sessionManager.getCwd()`, `projectTrustReloadOptions(sessionCwd, agentDir)`, `resourceLoaderReloadOptions: trustReloadOptions`, `trackStartingSession(sessionCwd)`, `realpathSync(resolvedCwd)`. The two `syncProjectTrust(); await this.inner.reload` matches move to `runtimeSource` (wrapper's `reload` command + `createExtensionCommandContextActions().reload`).

- [ ] **Step 8: Add the seam-parity guard**

Append to `web/lib/rpc-manager.test.mjs`:

```js
test("legacy rpc-manager is a thin re-export seam with no runtime logic", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /globalThis|process\.once|declare global|class AgentSessionWrapper|new Map\(\)/);
  for (const name of [
    "getRpcSession", "getRpcSessionInfos", "hasBusyRpcSessionForCwd",
    "destroyRpcSessionsForCwd", "getRunningRpcSessionIds",
    "subscribeRunningSessions", "notifyRunningChange", "startRpcSession",
  ]) {
    assert.match(source, new RegExp(`export (async )?function ${name}`));
  }
});
```

- [ ] **Step 9: Full validation**

```bash
cd web && node --experimental-strip-types --test lib/rpc-manager.test.mjs lib/rpc-manager-shutdown.test.mjs lib/rpc-manager-widgets.test.mjs lib/rpc-session-info.test.mjs lib/project-trust.test.mjs
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint
cd web && pnpm test
```

Expected: all pass; `tsc` exit 0; `eslint .` exit 0.

- [ ] **Step 10: Commit**

```bash
git add web/packages/pi-backend/runtime-manager.ts web/lib/runtime-state.ts web/lib/rpc-manager.ts web/lib/rpc-manager.test.mjs web/lib/project-trust.test.mjs
git commit -m "refactor(web): extract runtime registry into pi-backend runtime-manager"
```

---

### Task 4: Behavioral tests for the manager (fake factory, fresh state)

**Files:**
- Create: `web/packages/pi-backend/runtime-manager.test.mjs`

- [ ] **Step 1: Write the test file**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { createRuntimeManager } = await jiti.import("./runtime-manager.ts");

function freshState() {
  return { registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() };
}

function fakeFactory(calls) {
  return async (sessionId, sessionFile, cwd, options) => {
    calls.push({ sessionId, sessionFile, cwd, options });
    return {
      inner: {
        sessionId,
        sessionFile: undefined,
        sessionManager: { getCwd: () => cwd },
        extensionRunner: {},
        subscribe: () => () => {},
        dispose: () => {},
        isBashRunning: false,
      },
      realSessionId: sessionId,
    };
  };
}

async function makeManager(calls = []) {
  const state = freshState();
  const manager = createRuntimeManager(state, fakeFactory(calls));
  return { manager, state };
}

test("concurrent starts for one session resolve to one runtime", async () => {
  const calls = [];
  const { manager, state } = await makeManager(calls);
  try {
    const [a, b] = await Promise.all([
      manager.startSession("one", "", "/tmp", {}),
      manager.startSession("one", "", "/tmp", {}),
    ]);
    assert.equal(a.session, b.session);
    assert.equal(calls.length, 1);
  } finally {
    for (const s of state.registry.values()) s.destroy();
  }
});

test("different session ids start independent runtimes", async () => {
  const calls = [];
  const { manager, state } = await makeManager(calls);
  try {
    const [a, b] = await Promise.all([
      manager.startSession("a", "", "/tmp", {}),
      manager.startSession("b", "", "/tmp", {}),
    ]);
    assert.equal(calls.length, 2);
    assert.notEqual(a.session, b.session);
  } finally {
    for (const s of state.registry.values()) s.destroy();
  }
});

test("the running-session subscription unsubscribes cleanly", async () => {
  const { manager, state } = await makeManager();
  const seen = [];
  const unsubscribe = manager.subscribeRunningSessions((ids) => seen.push(ids));
  manager.notifyRunningChange();
  assert.ok(seen.length >= 1);
  unsubscribe();
  manager.notifyRunningChange();
  assert.equal(state.runningListeners.size, 0);
  assert.equal(seen.length, 1);
});

test("notifyRunningChange clears its snapshot when the last listener leaves", async () => {
  const { manager } = await makeManager();
  const first = [];
  const unsubscribe = manager.subscribeRunningSessions((ids) => first.push(ids));
  manager.notifyRunningChange();
  unsubscribe();
  manager.notifyRunningChange(); // no listeners → snapshot resets
  const second = [];
  const unsubscribe2 = manager.subscribeRunningSessions((ids) => second.push(ids));
  manager.notifyRunningChange();
  assert.equal(second.length, 1); // fresh snapshot delivered, not skipped as stale
  unsubscribe2();
});

test("destroySessionsForCwd shuts down only matching sessions", async () => {
  const { manager, state } = await makeManager();
  await Promise.all([
    manager.startSession("a", "", "/tmp/a", {}),
    manager.startSession("b", "", "/tmp/b", {}),
  ]);
  assert.equal(await manager.destroySessionsForCwd("/tmp/a"), 1);
  assert.equal(state.registry.has("a"), false);
  assert.equal(state.registry.has("b"), true);
  for (const s of state.registry.values()) s.destroy();
});
```

> These tests substitute a fake `SessionFactory`, so they never construct a real Pi SDK agent session and never touch `globalThis`. One caveat: `RuntimeManager.startSession` calls the real `SessionManager.create(cwd, undefined)` for the `sessionFile === ""` path **before** the fake factory runs. That performs an idempotent `mkdir` under `~/.pi/agent/sessions/<encoded-cwd>/` (verified benign — in-memory session, no JSONL writes), so the tests pass with a normal `HOME` but would fail on a HOME read-only CI. The existing suite already exercises Pi SDK session code in-process, so this is par for the course — do not refactor the split purely to avoid it.

> Why the fakes work: the wrapper accepts any object with the `AgentSessionLike` members the move exercises (`sessionManager.getCwd`, `extensionRunner.emit?.()`, `subscribe`, `dispose`, `isBashRunning`, `sessionId`). `destroySessionsForCwd` calls `wrapper.shutdown()` → `extensionRunner.emit?.()` (no-op on `{}`) → `destroy()` → registry `delete` via onDestroy. Idle timers are cleared by `destroy()` in the `finally` blocks, so the test runner never hangs.

- [ ] **Step 2: Run the new tests + typecheck + lint**

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/runtime-manager.test.mjs
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add web/packages/pi-backend/runtime-manager.test.mjs
git commit -m "test(web): characterize pi-backend runtime-manager semantics"
```

---

### Task 5: Phase-boundary audit and full parity

- [ ] **Step 1: Full suite**

```bash
cd web && pnpm test && pnpm exec tsc --noEmit && pnpm lint
```

Expected: 817 (Phase 1) + 5 new = **822 pass**; `tsc` exit 0; `eslint .` exit 0.

- [ ] **Step 2: Prove one registry and zero route drift**

```bash
cd web
grep -n "globalThis\|process\.once" packages/pi-backend/runtime.ts packages/pi-backend/runtime-manager.ts || echo "no global state in package runtime code"
grep -rln "pi-backend/runtime" app/api || echo "routes still import the legacy seam only"
git diff --stat -- 'web/app' 'web/components' web/hooks web/lib/agent-event-stream.ts web/lib/agent-event-wire.ts web/lib/agent-event-connection.ts
```

Expected: no `globalThis`/`process.once` in the package, no route importing the package directly, empty diff in routes/components/hooks/event files.

- [ ] **Step 3: Parity proof**

Re-run Pre-flight Step 2's grep on the new seam and diff the names against the frozen list. Also re-run `/tmp/rpc-manager.ts.orig` diff on the registry bodies (methods move with no logic changes).

- [ ] **Step 4: Diff check and final commit**

```bash
git diff --check
git status --short
```

Keep the plan doc untracked. Commit any remaining `web/**` change (expected: none) or skip.

---

## Roadmap-required Phase 2 verification, mapped

- **Concurrent starts for one session resolve to one runtime** → Task 4 test 1.
- **Different sessions remain independent** → Task 4 test 2.
- **Subscription cleanup and running-session notifications match current behavior** → Task 4 tests 3–4 (snapshot-reset semantics).
- **Existing legacy agent routes and tests remain green through delegation** → Task 3 Step 9 + Task 5 Step 1.
- **No duplicated live-session registry** → Task 5 Step 2 (single `globalThis.__piSessions`, single `getRuntimeManager()`).

## Risks and countermeasures

- **Cycle risk:** `runtime-manager.ts` never imports `runtime-state.ts`; state flows in via `createRuntimeManager(state, factory)`. `runtime-state.ts` imports the manager (one direction). `rpc-manager.ts` imports both. No cycles.
- **Private member access in tests:** the widget/shutdown tests invoke `createExtensionUiContext`/`createExtensionCommandContextActions` on the wrapper — keep those exact private names when moving.
- **`globalThis` key fidelity:** `rpc-session-info.test.mjs` writes `__piSessions`; `runtime-state.ts` reads the same key; the seam's `getRpcSessionInfos` delegates to `getRuntimeManager().getSessionInfos()` which reads that map.
- **startRpcSession's signature:** `/api/agent/new` and `/api/agent/[id]/events` pass `(tempKey, "", cwd, { toolNames/initialModel/thinkingLevel })` — the seam keeps the identical signature.
- **Idle timers in tests:** fakes `dispose()` and wrappers are destroyed in `finally`, clearing the 10-minute idle `setTimeout`.
- **Intermediate state (Task 1 → Task 3 commits):** between the Task 1 and Task 3 commits, rpc-manager.ts's still-local startRpcSession constructs `new AgentSessionWrapper(inner)` without the hooks argument, so running-state broadcasting is temporarily dead (wrappers default hooks = {}). No test observes this window, the seam lands two tasks later in the same branch, and the intermediate states are never released — no action needed, just don't stop the branch inside it.
- **Seam export churn:** never delete names from `rpc-manager.ts` — consumers type- and value-import them (`import type { AgentSessionWrapper }` and `import { startRpcSession }` both appear in tests/routes). Re-export them, don't redefine.

## Out-of-scope

- `/api/v1` adapters, SSE consumers, WebSocket, gRPC, standalone process.
- `index.ts` gaining command methods.
- Deleting the legacy `rpc-manager.ts` (separately approved breaking phase).
- Renaming the four `globalThis` keys or the `process.once` semantics.

---

Plan complete. Ready to execute this phase with /skill:executing-plans (it intentionally does not start Phase 3).