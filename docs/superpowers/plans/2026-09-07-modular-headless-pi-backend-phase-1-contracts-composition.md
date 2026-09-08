# Modular Headless Pi Backend Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish transport-independent API contracts, stable backend errors, a minimal composed `PiBackend` facade, and one server-only host singleton without changing any existing route or browser behavior.

**Architecture:** `web/packages/pi-backend/` becomes the inward-facing module boundary. It initially owns serializable `/api/v1` DTOs, backend errors, and only the health/capability facade methods that can be implemented without moving runtime behavior; later roadmap phases extend the same facade as real services are extracted. `web/lib/pi-backend-host.ts` is the sole Next.js process-composition seam and stores one facade instance on `globalThis` for hot-reload stability.

**Tech Stack:** TypeScript 5, Node.js test runner, `jiti`, Next.js 16 server-only modules, pnpm.

**Roadmap:** `docs/superpowers/roadmaps/2026-09-07-modular-headless-pi-backend-roadmap.md`

**Phase:** Phase 1: Contracts, Errors, and Backend Composition Seam

---

## Phase Boundary

This plan intentionally does **not** move `AgentSessionWrapper`, session persistence, model loading, route handlers, or browser requests. Existing code continues to use `web/lib/rpc-manager.ts`, `web/lib/session-reader.ts`, `/api/agent`, `/api/sessions`, and `/api/models`. The new facade exposes only discovery methods with real implementations; later methods are added only when their underlying behavior is extracted in later phase plans.

## File Structure

### Create

- `web/packages/pi-backend/contracts.ts`: serializable API inputs, responses, events, and type-only re-exports of current session/message DTOs.
- `web/packages/pi-backend/contracts.type-test.ts`: compile-time fixtures that lock the important DTO fields and opaque session-id usage.
- `web/packages/pi-backend/contracts.test.mjs`: import-boundary test proving package source has no Next.js, React, component, hook, or route dependency.
- `web/packages/pi-backend/errors.ts`: stable backend error codes, `BackendError`, and its type guard.
- `web/packages/pi-backend/errors.test.mjs`: behavior tests for coded errors, details, and causes.
- `web/packages/pi-backend/index.ts`: minimal composed `PiBackend` facade and public exports.
- `web/packages/pi-backend/index.test.mjs`: discovery-method behavior tests.
- `web/lib/pi-backend-host.ts`: server-only singleton composition using the Next-injected Pi version.
- `web/lib/pi-backend-host.test.mjs`: source-boundary test for server-only marking and `globalThis` singleton ownership.

### Modify

- `web/package.json`: include `packages/**/*.test.mjs` in the existing Node test command.

### Explicitly unchanged

- `web/lib/types.ts`: remains the canonical shared session/message DTO source in this phase; `contracts.ts` re-exports those types without introducing runtime imports.
- `web/lib/rpc-manager.ts`, `web/lib/session-reader.ts`, `web/app/api/**`, `web/hooks/**`, `web/components/**`: no production changes in Phase 1.

## Pre-flight

The worktree currently has no `web/node_modules`, so test/typecheck commands fail with missing `jiti`, Pi packages, and TypeScript. Restore the locked dependencies before establishing the baseline.

- [ ] **Step 1: Install the existing locked web dependencies**

Run:

```bash
cd web && pnpm install --frozen-lockfile
```

Expected: exit 0; `pnpm-lock.yaml` remains unchanged.

- [ ] **Step 2: Verify the pre-change baseline**

Run:

```bash
cd web && pnpm test
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint
```

Expected: all commands exit 0. If a command fails after dependencies are installed, stop and report the baseline failure instead of hiding it in this refactor.

---

### Task 1: Register Package Tests and Lock the Serializable Contract

**Files:**
- Modify: `web/package.json`
- Create: `web/packages/pi-backend/contracts.type-test.ts`
- Create: `web/packages/pi-backend/contracts.test.mjs`
- Create: `web/packages/pi-backend/contracts.ts`

- [ ] **Step 1: Add package tests to the existing test command**

Change only the `test` script in `web/package.json` to:

```json
"test": "node --experimental-strip-types --test \"app/**/*.test.mjs\" \"components/**/*.test.mjs\" \"hooks/**/*.test.mjs\" \"lib/**/*.test.mjs\" \"packages/**/*.test.mjs\" \"public/**/*.test.mjs\""
```

Do not add a package workspace, build script, or dependency.

- [ ] **Step 2: Write the compile-time contract fixture**

Create `web/packages/pi-backend/contracts.type-test.ts`:

```ts
import type {
  AgentStateResponse,
  ApiErrorResponse,
  ApiSuccess,
  CapabilitiesResponse,
  CommandAcceptedResponse,
  HealthResponse,
  ModelsResponse,
  PromptInput,
  SessionDetailsResponse,
  SessionEvent,
  SessionIdInput,
} from "./contracts";

const health = {
  status: "ok",
  apiVersion: "v1",
  piVersion: "0.84.2",
} satisfies HealthResponse;

const capabilities = {
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
} satisfies CapabilitiesResponse;

const accepted = {
  data: { accepted: true },
} satisfies ApiSuccess<CommandAcceptedResponse>;

const failure = {
  error: {
    code: "session_not_found",
    message: "Session not found",
  },
} satisfies ApiErrorResponse;

const modelResponse = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
  modelError: "Model list is temporarily unavailable.",
} satisfies ModelsResponse;

const state = {
  running: true,
  sessionId: "session-uuid",
  messageCount: 0,
  queuedMessages: { steering: [], followUp: [] },
} satisfies AgentStateResponse;

const sessionId = {
  sessionId: "session-uuid",
} satisfies SessionIdInput;

const prompt = {
  message: "hello",
  streamingBehavior: "followUp",
} satisfies PromptInput;

const event = {
  sessionId: "session-uuid",
  event: { type: "agent_start" },
} satisfies SessionEvent;

declare const details: SessionDetailsResponse;
const opaqueId: string = details.sessionId;

void [health, capabilities, accepted, failure, modelResponse, state, sessionId, prompt, event, opaqueId];
```

This deliberately keeps `sessionId` as an opaque string and keeps the route-body `PromptInput` separate from `SessionIdInput`; backend methods combine them as `SessionIdInput & PromptInput` when introduced.

- [ ] **Step 3: Write the package import-boundary test**

Create `web/packages/pi-backend/contracts.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const packageRoot = fileURLToPath(new URL("./", import.meta.url));

async function packageTypeScriptSources() {
  const entries = await readdir(packageRoot, { recursive: true });
  return entries.filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"));
}

test("pi-backend source stays independent of Next and browser application modules", async () => {
  const forbiddenImport = /(?:from\s+|import\s*)["'](?:next(?:\/[^"']*)?|react(?:\/[^"']*)?|@\/(?:app|components|hooks)(?:\/[^"']*)?|(?:\.\.\/)+(?:app|components|hooks)(?:\/[^"']*)?)["']/;

  const browserOnlyLibImport = /(?:from\s+|import\s*)["'](?:@\/lib\/|(?:\.\.\/)+lib\/)(?:agent-client|agent-event-connection|browser-notifications|draft-store|file-explorer-state|panel-layout)["']/;

  for (const relativePath of await packageTypeScriptSources()) {
    const source = await readFile(join(packageRoot, relativePath), "utf8");
    assert.doesNotMatch(source, forbiddenImport, relativePath);
    assert.doesNotMatch(source, browserOnlyLibImport, relativePath);
  }
});
```

- [ ] **Step 4: Run the tests to verify they fail for the expected reason**

Run:

```bash
cd web && pnpm exec tsc --noEmit
cd web && node --experimental-strip-types --test packages/pi-backend/contracts.test.mjs
```

Expected: typecheck fails because `./contracts` does not exist. The boundary test may also fail while reading the absent implementation set; do not proceed unless the typecheck failure is specifically the missing contracts module/types.

- [ ] **Step 5: Add the serializable contract module**

Create `web/packages/pi-backend/contracts.ts`:

```ts
import type {
  AgentMessage,
  ExtensionStatusItem,
  ExtensionWidgetItem,
  SessionContext,
  SessionInfo,
  SessionTreeNode,
} from "../../lib/types";

export type {
  AgentMessage,
  BlockingExtensionUiRequest,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionUiResponse,
  ExtensionWidgetItem,
  SessionContext,
  SessionInfo,
  SessionTreeNode,
} from "../../lib/types";

export interface ApiSuccess<T> {
  data: T;
}

export type BackendErrorCode =
  | "invalid_request"
  | "access_denied"
  | "session_not_found"
  | "session_not_running"
  | "session_busy"
  | "prompt_rejected"
  | "model_not_found"
  | "startup_failed"
  | "internal_error";

export interface ApiErrorResponse {
  error: {
    code: BackendErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type StreamingBehavior = "steer" | "followUp";

export interface SessionIdInput {
  sessionId: string;
}

export interface ListModelsInput {
  cwd: string;
}

export interface ListSessionsInput {
  force?: boolean;
}

export interface UpdateSessionInput extends SessionIdInput {
  name: string;
}

export interface AgentImageInput {
  type: "image";
  data: string;
  mimeType: string;
}

export interface CreateSessionInput {
  cwd: string;
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  toolNames?: string[];
}

export interface PromptInput {
  message: string;
  images?: AgentImageInput[];
  streamingBehavior?: StreamingBehavior;
}

export interface MessageCommandInput {
  message: string;
  images?: AgentImageInput[];
}

export interface HealthResponse {
  status: "ok";
  apiVersion: "v1";
  piVersion: string;
}

export interface CapabilitiesResponse {
  apiVersion: "v1";
  commandTransports: ["http"];
  eventTransports: ["sse"];
  features: {
    concurrentSessions: true;
    prompt: true;
    abort: true;
    steering: true;
    followUp: true;
    sessionBranches: true;
    bash: true;
    extensions: true;
  };
}

export interface ModelSummary {
  id: string;
  name: string;
  provider: string;
}

export interface ModelsResponse {
  models: Record<string, string>;
  modelList: ModelSummary[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  thinkingLevelPins: Record<string, string>;
  modelScopeWarnings?: string[];
  modelError?: string;
}

export interface SessionsResponse {
  sessions: SessionInfo[];
  runningSessionIds: string[];
}

export interface SessionCreatedResponse {
  sessionId: string;
  model: { provider: string; modelId: string } | null;
  thinkingLevel: string;
}

export interface SessionDetailsResponse {
  sessionId: string;
  filePath: string;
  info: SessionInfo | null;
  leafId: string | null;
  tree: SessionTreeNode[];
  context: SessionContext;
  totalActiveMs: number;
}

export interface AgentStateResponse {
  running: boolean;
  sessionId?: string;
  sessionFile?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;
  model?: { id: string; provider: string };
  messageCount?: number;
  pendingMessageCount?: number;
  queuedMessages?: { steering: string[]; followUp: string[] };
  contextUsage?: {
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
}

export interface CommandAcceptedResponse {
  accepted: true;
}

export interface SessionMutationResponse {
  success: true;
  sessionId: string;
}

export interface AutoNameResponse {
  title: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  } | null;
}

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface SessionEvent {
  sessionId: string;
  event: AgentEvent;
}

export interface SessionSubscription {
  unsubscribe(): void;
}
```

- [ ] **Step 6: Run focused validation**

Run:

```bash
cd web && pnpm exec tsc --noEmit
cd web && node --experimental-strip-types --test packages/pi-backend/contracts.test.mjs
cd web && pnpm exec eslint packages/pi-backend/contracts.ts packages/pi-backend/contracts.type-test.ts packages/pi-backend/contracts.test.mjs
```

Expected: all commands exit 0; the boundary test reports one passing test.

- [ ] **Step 7: Commit the contract boundary**

```bash
git add web/package.json web/packages/pi-backend/contracts.ts web/packages/pi-backend/contracts.type-test.ts web/packages/pi-backend/contracts.test.mjs
git commit -m "feat(web): define pi backend contracts"
```

---

### Task 2: Add Stable Backend Errors

**Files:**
- Create: `web/packages/pi-backend/errors.test.mjs`
- Create: `web/packages/pi-backend/errors.ts`

- [ ] **Step 1: Write failing backend-error tests**

Create `web/packages/pi-backend/errors.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  BACKEND_ERROR_CODES,
  BackendError,
  isBackendError,
} = await jiti.import("./errors.ts");

test("BackendError keeps a stable code, safe message, optional details, and cause", () => {
  const cause = new Error("SDK failure");
  const error = new BackendError(
    "startup_failed",
    "Unable to start the session",
    { retryable: true },
    { cause },
  );

  assert.equal(error.name, "BackendError");
  assert.equal(error.code, "startup_failed");
  assert.equal(error.message, "Unable to start the session");
  assert.deepEqual(error.details, { retryable: true });
  assert.equal(error.cause, cause);
  assert.equal(isBackendError(error), true);
  assert.equal(isBackendError(new Error("other")), false);
});

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
  ]);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/errors.test.mjs
```

Expected: FAIL because `packages/pi-backend/errors.ts` does not exist.

- [ ] **Step 3: Implement the backend error contract**

Create `web/packages/pi-backend/errors.ts`:

```ts
import type { BackendErrorCode } from "./contracts";

export type { BackendErrorCode } from "./contracts";

export const BACKEND_ERROR_CODES = [
  "invalid_request",
  "access_denied",
  "session_not_found",
  "session_not_running",
  "session_busy",
  "prompt_rejected",
  "model_not_found",
  "startup_failed",
  "internal_error",
] as const satisfies readonly BackendErrorCode[];

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly details: unknown;

  constructor(
    code: BackendErrorCode,
    message: string,
    details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BackendError";
    this.code = code;
    this.details = details;
  }
}

export function isBackendError(error: unknown): error is BackendError {
  return error instanceof BackendError;
}
```

Do not add HTTP status codes here. HTTP mapping belongs to the Phase 4 Next.js adapter.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/errors.test.mjs packages/pi-backend/contracts.test.mjs
cd web && pnpm exec tsc --noEmit
cd web && pnpm exec eslint packages/pi-backend
```

Expected: all commands exit 0; three focused tests pass.

- [ ] **Step 5: Commit the backend errors**

```bash
git add web/packages/pi-backend/errors.ts web/packages/pi-backend/errors.test.mjs
git commit -m "feat(web): add stable pi backend errors"
```

---

### Task 3: Add the Minimal Composed Backend Facade

**Files:**
- Create: `web/packages/pi-backend/index.test.mjs`
- Create: `web/packages/pi-backend/index.ts`

- [ ] **Step 1: Write failing facade tests**

Create `web/packages/pi-backend/index.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { createPiBackend } = await jiti.import("./index.ts");

test("PiBackend reports health without starting a runtime", async () => {
  const backend = createPiBackend({ piVersion: "0.84.2" });

  assert.deepEqual(await backend.getHealth(), {
    status: "ok",
    apiVersion: "v1",
    piVersion: "0.84.2",
  });
});

test("PiBackend advertises only the transports and preserved capabilities in scope", async () => {
  const backend = createPiBackend({ piVersion: "0.84.2" });

  assert.deepEqual(await backend.getCapabilities(), {
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
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/index.test.mjs
```

Expected: FAIL because `packages/pi-backend/index.ts` does not exist.

- [ ] **Step 3: Implement the minimal facade and public exports**

Create `web/packages/pi-backend/index.ts`:

```ts
import type { CapabilitiesResponse, HealthResponse } from "./contracts";

export type * from "./contracts";
export { BACKEND_ERROR_CODES, BackendError, isBackendError } from "./errors";

export interface PiBackend {
  getHealth(): Promise<HealthResponse>;
  getCapabilities(): Promise<CapabilitiesResponse>;
}

export interface CreatePiBackendOptions {
  piVersion: string;
}

export function createPiBackend(options: CreatePiBackendOptions): PiBackend {
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
  };
}
```

Do not add throwing placeholders for session/runtime methods. Extend `PiBackend` only when later phases provide real implementations.

- [ ] **Step 4: Run facade, boundary, error, and type checks**

Run:

```bash
cd web && node --experimental-strip-types --test packages/pi-backend/*.test.mjs
cd web && pnpm exec tsc --noEmit
cd web && pnpm exec eslint packages/pi-backend
```

Expected: all commands exit 0; five focused tests pass.

- [ ] **Step 5: Commit the facade**

```bash
git add web/packages/pi-backend/index.ts web/packages/pi-backend/index.test.mjs
git commit -m "feat(web): add pi backend facade"
```

---

### Task 4: Add the Server-Only Next.js Host Singleton

**Files:**
- Create: `web/lib/pi-backend-host.test.mjs`
- Create: `web/lib/pi-backend-host.ts`

- [ ] **Step 1: Write the failing host-boundary test**

Create `web/lib/pi-backend-host.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = fileURLToPath(new URL("../", import.meta.url));


async function sourceFiles(directory) {
  const root = join(webRoot, directory);
  const entries = await readdir(root, { recursive: true });
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
      .map(async (entry) => ({
        path: join(directory, entry),
        source: await readFile(join(root, entry), "utf8"),
      })),
  );
}

test("pi backend host is server-only and owns one hot-reload-stable instance", async () => {
  const source = await readFile(new URL("./pi-backend-host.ts", import.meta.url), "utf8");

  assert.match(source, /^import "server-only";/);
  assert.match(source, /globalThis\.__piBackend \?\?= createPiBackend\(/);
  assert.match(source, /process\.env\.NEXT_PUBLIC_PI_VERSION \?\? "unknown"/);
});

test("browser modules do not import the server-only backend host", async () => {
  for (const { path, source } of [
    ...await sourceFiles("components"),
    ...await sourceFiles("hooks"),
  ]) {
    assert.doesNotMatch(source, /pi-backend-host/, path);
  }
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd web && node --experimental-strip-types --test lib/pi-backend-host.test.mjs
```

Expected: FAIL with `ENOENT` for `lib/pi-backend-host.ts`.

- [ ] **Step 3: Implement the server-only host**

Create `web/lib/pi-backend-host.ts`:

```ts
import "server-only";

import {
  createPiBackend,
  type PiBackend,
} from "@/packages/pi-backend";

declare global {
  var __piBackend: PiBackend | undefined;
}

export function getPiBackend(): PiBackend {
  return globalThis.__piBackend ??= createPiBackend({
    piVersion: process.env.NEXT_PUBLIC_PI_VERSION ?? "unknown",
  });
}
```

The host owns only composition. Do not move the current runtime maps or startup locks in this phase; Phase 2 moves them into backend dependencies while preserving this accessor.

- [ ] **Step 4: Run focused tests and static validation**

Run:

```bash
cd web && node --experimental-strip-types --test lib/pi-backend-host.test.mjs packages/pi-backend/*.test.mjs
cd web && pnpm exec tsc --noEmit
cd web && pnpm exec eslint lib/pi-backend-host.ts lib/pi-backend-host.test.mjs packages/pi-backend
```

Expected: all commands exit 0; seven focused tests pass.

- [ ] **Step 5: Commit the host composition seam**

```bash
git add web/lib/pi-backend-host.ts web/lib/pi-backend-host.test.mjs
git commit -m "feat(web): add pi backend host"
```

---

### Task 5: Verify the Phase 1 Boundary

**Files:**
- No production file changes expected.

- [ ] **Step 1: Run the complete web test suite**

Run:

```bash
cd web && pnpm test
```

Expected: exit 0. Existing route, runtime, session-reader, model, hook, and component tests remain green because no production request path changed.

- [ ] **Step 2: Run typecheck and lint**

Run:

```bash
cd web && pnpm exec tsc --noEmit
cd web && pnpm lint
```

Expected: both commands exit 0 without new warnings or errors.

- [ ] **Step 3: Verify no forbidden scope entered the diff**

Run:

```bash
git diff --name-only HEAD~4..HEAD
git status --short
git grep -n "pi-backend-host" -- web/app web/components web/hooks || true
git diff --check
```

Expected:

- Changed implementation files are limited to `web/package.json`, `web/packages/pi-backend/**`, and `web/lib/pi-backend-host*`.
- No current route, component, or hook imports `pi-backend-host`.
- `git diff --check` emits no output.

- [ ] **Step 4: Confirm the phase boundary before proceeding**

Verify all of the following:

- Existing `/api/agent`, `/api/sessions`, and `/api/models` behavior is untouched.
- `PiBackend` has real health/capability methods and no throwing placeholders.
- Backend source has no Next.js, React, route, component, or hook dependency.
- The only Next.js-specific composition code is `web/lib/pi-backend-host.ts`.
- No dependency, package workspace, WebSocket/gRPC layer, or standalone process was added.

Do not begin runtime extraction. That belongs to Roadmap Phase 2 and requires its own `/skill:writing-plans` document.
