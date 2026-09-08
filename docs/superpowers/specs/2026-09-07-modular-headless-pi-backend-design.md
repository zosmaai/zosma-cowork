# Modular Headless Pi Backend and API Foundation

**Date:** 2026-09-07  
**Status:** Approved design  
**Branch:** `refactor/modular-pi-headless-api`

## Summary

Zosma Cowork will separate its browser frontend from Pi runtime logic behind a versioned HTTP API. The first implementation keeps everything in the existing Next.js process, extracts current Pi behavior into a transport-independent internal module, adds thin `/api/v1` route adapters, and migrates the web UI to consume those routes exclusively.

This is an extraction, not a runtime rewrite. Current session persistence, concurrent runtime behavior, prompt admission, cancellation, steering, follow-up queues, model selection, extension behavior, and SSE streaming remain intact.

The resulting boundary must make a future mobile client or alternative transport possible without moving Pi logic again. Mobile connectivity, new authentication, WebSockets, gRPC, and a standalone backend process are deferred.

## Scope and Decomposition

The eventual migration covers every server capability currently exposed under `web/app/api`, but those capabilities span independent domains and must not be implemented in one change.

This specification covers the first sub-project:

1. API contracts and backend composition foundation.
2. Health and capability discovery.
3. Model listing used by chat startup.
4. Session create, list, read, update, and delete.
5. Session runtime state, running-session status, and event subscriptions.
6. Every agent/session control currently used by the browser, including prompt, abort, steering, follow-up, queues, model/thinking/tools, compaction, Bash, branching, reload, session details, deferred content, export, and extension UI responses.
7. Migration of all browser calls to `/api/agent`, `/api/sessions`, and `/api/models` onto `/api/v1`.
8. Compatibility adapters for the existing agent/session/model routes.

Later sub-projects will migrate:

1. Workspace selection, file access, file indexing, Git, and worktrees.
2. Model configuration, provider credentials, authentication flows, and project trust.
3. Skills and plugins.
4. App updates and remaining utility routes.
5. Removal of legacy routes after the web client no longer uses them.

## Goals

- Make the browser frontend a client of a stable `/api/v1` contract.
- Remove Next.js transport concerns from Pi runtime and session logic.
- Extract and reuse working behavior instead of replacing it.
- Keep Next.js routes thin and free of business rules.
- Keep the backend in-process for current web and desktop deployment.
- Preserve current UI behavior throughout migration.
- Provide typed success, error, command, state, and event contracts.
- Keep transport-neutral service methods usable by future SSE, WebSocket, gRPC, CLI, or standalone-process adapters.
- Follow TDD for each extraction and route migration.

## Non-goals

- Running the backend as a separate process.
- Publishing an npm package.
- Connecting a mobile client in this phase.
- Adding CORS or a mobile authentication scheme.
- Adding WebSocket or gRPC transports.
- Replacing Pi's JSONL session persistence.
- Persisting a separate run-history model or introducing run IDs.
- Changing prompt, abort, steer, follow-up, queue, or concurrency semantics.
- Migrating file, Git, worktree, configuration, authentication, skill, plugin, or update routes in this sub-project.

## Current State

The current Next.js server already behaves like a headless backend, but responsibilities are coupled:

- `web/lib/rpc-manager.ts` owns Pi session construction, runtime lifecycle, command dispatch, extension UI adaptation, event subscriptions, hot-reload registries, and running-session notifications.
- `web/lib/session-reader.ts` reads and resolves Pi JSONL sessions.
- Next.js routes perform validation, session lookup, business decisions, transport formatting, and error conversion together.
- Browser code calls HTTP/SSE, but the public contract is split between `/api/agent`, `/api/sessions`, `/api/models`, and route-specific response shapes.
- Runtime registries and startup locks live on `globalThis` so they survive Next.js development hot reload.

Useful existing behavior includes:

- One `AgentSessionWrapper` per live session.
- Parallel execution across sessions.
- Per-session prompt admission serialization.
- Ten-minute idle runtime shutdown.
- Shared cold-start promises that prevent duplicate runtime creation.
- Pi-native `SessionManager` persistence.
- SSE subscription-before-snapshot ordering that avoids losing startup events.
- Reconnection snapshots for an already-streaming session.
- Session-specific abort, steering, follow-up, queue, model, tool, compaction, Bash, and extension state.
- Existing host/origin checks and optional Basic authentication.

All of these are extraction candidates.

## Chosen Approach

### Extract existing behavior, then migrate the client

Create an internal module at:

```text
web/packages/pi-backend/
```

It is a source module within the current `web` application, not an independently built or published package. It may depend on Node.js, the Pi SDK, and injected host services, but it must not depend on Next.js request or response types.

The Next.js application remains the process host:

```text
Browser UI
    │ HTTP + SSE
    ▼
Next.js /api/v1 routes
    │ typed method calls
    ▼
web/packages/pi-backend
    │
    ├── Pi SDK
    └── Pi JSONL sessions / host filesystem
```

Existing routes remain temporarily and delegate to the same backend instance. The web UI migrates to `/api/v1`; it must not call the legacy agent/session/model routes after this sub-project.

### Rejected alternatives

**API facade over the existing files only:** fastest initially, but leaves route logic coupled to `rpc-manager.ts` and does not create a reusable backend boundary.

**Separate Node backend process now:** provides stronger deployment isolation, but adds process lifecycle, IPC, packaging, failure recovery, and authentication work before a second process consumer exists.

## Architecture

### Backend facade

The backend exports one composed facade with ordinary typed methods. The core methods are illustrated below; the facade also exposes one typed method corresponding to every runtime/session operation listed in the API contract.

```ts
interface PiBackend {
  getHealth(): Promise<HealthResponse>;
  getCapabilities(): Promise<CapabilitiesResponse>;
  listModels(input: ListModelsInput): Promise<ModelsResponse>;

  listSessions(input?: ListSessionsInput): Promise<SessionsResponse>;
  createSession(input: CreateSessionInput): Promise<SessionCreatedResponse>;
  getSession(input: SessionIdInput): Promise<SessionDetailsResponse>;
  updateSession(input: UpdateSessionInput): Promise<SessionMutationResponse>;
  deleteSession(input: SessionIdInput): Promise<SessionMutationResponse>;
  getSessionState(input: SessionIdInput): Promise<AgentStateResponse>;

  prompt(input: SessionIdInput & PromptInput): Promise<CommandAcceptedResponse>;
  abort(input: SessionIdInput): Promise<CommandAcceptedResponse>;
  steer(input: SessionIdInput & MessageCommandInput): Promise<CommandAcceptedResponse>;
  followUp(input: SessionIdInput & MessageCommandInput): Promise<CommandAcceptedResponse>;

  subscribeToSession(
    input: SessionIdInput,
    listener: (event: SessionEvent) => void,
  ): Promise<SessionSubscription>;
}
```

Method names may be adjusted during detailed planning to match existing project naming, but the responsibilities and transport independence are fixed.

No generic transport interface or adapter registry is needed. Plain typed methods and subscriptions are already reusable by another transport. A future WebSocket or gRPC adapter will translate its protocol to these methods exactly as Next.js routes do.

### Internal units

```text
web/packages/pi-backend/
├── index.ts             composed facade and public exports
├── contracts.ts         serializable inputs, responses, and events
├── errors.ts            stable backend error codes
├── runtime.ts           AgentSession wrapper and command behavior
├── runtime-manager.ts   live registry, startup locks, lifecycle
├── sessions.ts          Pi session persistence/read operations
├── models.ts            model listing and startup model resolution
└── capabilities.ts      health and supported-feature reporting
```

This is a responsibility map, not a mandate to create empty or tiny files. Existing cohesive code should move with minimal changes, and files should only be split where tests or dependencies establish a useful boundary.

### Next.js host composition

A server-only host module owns the single backend instance:

```text
web/lib/pi-backend-host.ts
```

It constructs `PiBackend` and stores that composed instance or its runtime registry on `globalThis` in development. This preserves current hot-reload behavior without putting Next.js lifecycle assumptions inside the backend module.

The host is also the future seam for constructing the backend in a CLI or standalone process.

### Browser client

Browser code uses a focused API client under `web/lib/` for:

- URL construction and encoding.
- JSON requests.
- Success/error envelope decoding.
- Typed agent command methods.
- SSE connection construction.

React hooks and components consume the client rather than calling `fetch` or constructing agent API URLs directly. Shared backend contract types may be imported with `import type`; browser code must not import backend runtime values.

This sub-project only consolidates calls for the migrated agent/session/model surface. Later route migrations extend the same client boundary.

## API Contract

All new endpoints are rooted at `/api/v1`. The first sub-project covers every current browser use of `/api/agent`, `/api/sessions`, and `/api/models`; no migrated browser flow may fall back to those legacy paths.

### Common envelopes

```ts
interface ApiSuccess<T> {
  data: T;
}

interface ApiErrorResponse {
  error: {
    code: BackendErrorCode;
    message: string;
    details?: unknown;
  };
}

type BackendErrorCode =
  | "invalid_request"
  | "access_denied"
  | "session_not_found"
  | "session_not_running"
  | "session_busy"
  | "prompt_rejected"
  | "model_not_found"
  | "startup_failed"
  | "internal_error";
```

`message` is safe to show to users. `details` is optional structured diagnostic data and must not expose secrets or raw credentials. The backend produces typed errors; HTTP adapters alone map them to status codes.

### Shared request types

```ts
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type StreamingBehavior = "steer" | "followUp";

interface AgentImageInput {
  type: "image";
  data: string;      // base64 payload, subject to the existing size/type validation
  mimeType: string;
}

interface CreateSessionInput {
  cwd: string;
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  toolNames?: string[];
}

interface PromptInput {
  message: string;
  images?: AgentImageInput[];
  streamingBehavior?: StreamingBehavior;
}

interface MessageCommandInput {
  message: string;
  images?: AgentImageInput[];
}
```

The public identifier is Pi's existing opaque session UUID. Absolute session paths remain compatibility fields for current file-oriented UI features, never URL identifiers or authorization tokens.

### Core response types

Existing `AgentMessage`, `SessionInfo`, `SessionContext`, `SessionTreeNode`, extension status/widget, and session-stat structures move into or are re-exported from `contracts.ts`; their serialized fields remain unchanged during extraction.

```ts
interface HealthResponse {
  status: "ok";
  apiVersion: "v1";
  piVersion: string;
}

interface CapabilitiesResponse {
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

interface ModelSummary {
  id: string;
  name: string;
  provider: string;
}

interface ModelsResponse {
  models: Record<string, string>;
  modelList: ModelSummary[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  thinkingLevelPins: Record<string, string>;
  modelScopeWarnings?: string[];
  modelError?: string;
}

interface SessionsResponse {
  sessions: SessionInfo[];
  runningSessionIds: string[];
}

interface SessionCreatedResponse {
  sessionId: string;
  model: { provider: string; modelId: string } | null;
  thinkingLevel: string;
}

interface SessionDetailsResponse {
  sessionId: string;
  filePath: string;
  info: SessionInfo | null;
  leafId: string | null;
  tree: SessionTreeNode[];
  context: SessionContext;
  totalActiveMs: number;
}

interface AgentStateResponse {
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
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
}

interface CommandAcceptedResponse { accepted: true }
interface SessionMutationResponse { success: true; sessionId: string }
interface AutoNameResponse {
  title: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  } | null;
}
```

A cold session state returns `{ running: false }`. Arrays in successful responses are present even when empty. Optional fields mean the underlying Pi state does not provide a value, not that the adapter arbitrarily omitted it.

### Discovery, models, and session data endpoints

| Method | Path | Request | Response data |
|---|---|---|---|
| `GET` | `/api/v1/health` | none | `HealthResponse` |
| `GET` | `/api/v1/capabilities` | none | `CapabilitiesResponse` |
| `GET` | `/api/v1/models?cwd=...` | allowed workspace path | `ModelsResponse` |
| `GET` | `/api/v1/sessions?force=0|1` | optional cache bypass | `SessionsResponse` |
| `GET` | `/api/v1/sessions/running` | none | `{ sessionIds: string[] }` |
| `GET` | `/api/v1/sessions/running/events` | none | SSE running-session snapshots |
| `POST` | `/api/v1/sessions` | `CreateSessionInput` | `SessionCreatedResponse` |
| `GET` | `/api/v1/sessions/:id` | `deferThinking`, `deferMedia` flags | `SessionDetailsResponse` |
| `PATCH` | `/api/v1/sessions/:id` | `{ name: string }` | `SessionMutationResponse` |
| `DELETE` | `/api/v1/sessions/:id` | none | `SessionMutationResponse` |
| `GET` | `/api/v1/sessions/:id/context` | optional `leafId`, deferral flags | `SessionContext` |
| `GET` | `/api/v1/sessions/:id/entries/:entryId/thinking` | `blockIndex` | `{ thinking: string }` |
| `POST` | `/api/v1/sessions/:id/auto-name` | no body | `AutoNameResponse` |
| `GET` | `/api/v1/sessions/:id/export` | existing `inline` option | HTML document, not JSON envelope |

Export is the only non-SSE endpoint in this surface that intentionally returns non-JSON content.

### Runtime and command endpoints

| Method | Path | Request | Response data |
|---|---|---|---|
| `GET` | `/api/v1/sessions/:id/state` | none | `AgentStateResponse` |
| `GET` | `/api/v1/sessions/:id/events` | none | session SSE stream |
| `POST` | `/api/v1/sessions/:id/prompt` | `PromptInput` | `CommandAcceptedResponse` |
| `POST` | `/api/v1/sessions/:id/abort` | none | `CommandAcceptedResponse` |
| `POST` | `/api/v1/sessions/:id/steer` | `MessageCommandInput` | `CommandAcceptedResponse` |
| `POST` | `/api/v1/sessions/:id/follow-up` | `MessageCommandInput` | `CommandAcceptedResponse` |
| `DELETE` | `/api/v1/sessions/:id/queue` | none | `{ steering: string[]; followUp: string[] }` containing removed messages |
| `GET` | `/api/v1/sessions/:id/tools` | none | `Array<{ name: string; description: string; active: boolean }>` |
| `PUT` | `/api/v1/sessions/:id/tools` | `{ toolNames: string[] }` | `CommandAcceptedResponse` |
| `GET` | `/api/v1/sessions/:id/commands` | none | `{ commands: SlashCommandInfo[] }` |
| `PUT` | `/api/v1/sessions/:id/model` | `{ provider: string; modelId: string }` | `{ id: string; provider: string }` |
| `PUT` | `/api/v1/sessions/:id/thinking-level` | `{ level: ThinkingLevel }` | `CommandAcceptedResponse` |
| `PATCH` | `/api/v1/sessions/:id/preferences` | `{ autoCompactionEnabled?: boolean; autoRetryEnabled?: boolean }` | `CommandAcceptedResponse` |
| `POST` | `/api/v1/sessions/:id/compact` | `{ customInstructions?: string }` | existing Pi compaction result |
| `DELETE` | `/api/v1/sessions/:id/compact` | none | `CommandAcceptedResponse` |
| `POST` | `/api/v1/sessions/:id/bash` | `{ command: string; excludeFromContext?: boolean }` | existing typed Bash execution result |
| `DELETE` | `/api/v1/sessions/:id/bash` | none | `CommandAcceptedResponse` |
| `GET` | `/api/v1/sessions/:id/bash-output?path=...` | referenced output path | plain-text output, not JSON envelope |
| `POST` | `/api/v1/sessions/:id/fork` | `{ entryId: string }` | `{ cancelled: boolean; newSessionId?: string }` |
| `PUT` | `/api/v1/sessions/:id/navigation` | `{ targetId: string }` | `{ cancelled: boolean }` |
| `POST` | `/api/v1/sessions/:id/reload` | none | `CommandAcceptedResponse` |
| `GET` | `/api/v1/sessions/:id/stats` | none | existing typed session stats |
| `GET` | `/api/v1/sessions/:id/last-assistant-text` | none | `{ text: string }` |
| `POST` | `/api/v1/sessions/:id/extension-ui/responses` | existing `ExtensionUiResponse` discriminated union | `CommandAcceptedResponse` |
| `POST` | `/api/v1/sessions/:id/extension-ui/input` | `{ id: string; data: string }` | `CommandAcceptedResponse` |

Bash output is plain text because it is displayed and streamed as text today. Its path remains constrained to output files referenced by the target session.

### Creation and first prompt

`POST /api/v1/sessions` creates or ensures an empty runtime and returns its Pi session UUID plus effective model and thinking state. The web client then submits the first prompt through the prompt endpoint.

The legacy `POST /api/agent/new` adapter preserves its combined create-and-command body by composing those two backend operations. The compatibility shape does not leak into `/api/v1`.

### Prompt acknowledgment

Prompt behavior remains unchanged:

- The request resolves after synchronous validation and Pi extension preflight accept the prompt.
- It does not wait for the model/tool turn to finish.
- Completion and post-acceptance errors arrive through session events.
- Preflight rejection returns `prompt_rejected` and must not leave unreconcilable optimistic UI state.
- No run resource, run ID, or second persistence model is introduced.

## Event Contract

The backend emits transport-neutral session events:

```ts
interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface SessionEvent {
  sessionId: string;
  event: AgentEvent;
}
```

Every SSE `data:` record on a session stream serializes one `SessionEvent`. Connection state, startup errors, normal Pi events, and the active `message_start` snapshot all use the same envelope; their inner `event.type` values remain the existing client event names. The running-sessions stream is separate and emits `{ sessionIds: string[] }` snapshots.

The backend subscription API does not know about SSE framing, heartbeats, HTTP cancellation, or response streams.

The initial Next.js adapter uses the existing SSE behavior:

- `Content-Type: text/event-stream`.
- Immediate comment to flush headers.
- Periodic heartbeat comments.
- Listener attached before the current streaming snapshot is published.
- `connected` state followed by buffered events and the active streaming-message snapshot.
- Request cancellation unsubscribes and cleans up timers.
- Startup failure emits a typed error event and closes the stream.

Every `/api/v1` event payload includes `sessionId`, even though the URL is already session-scoped. This makes the same backend event safe for future multiplexed transports.

There is no durable event log or `Last-Event-ID` replay in this phase. Reconnecting clients use the current state/session snapshot behavior already relied upon by the web UI.

## Runtime and Concurrency Semantics

- One live runtime exists per Pi session UUID.
- Concurrent startup requests for one session share one in-flight creation promise.
- Different sessions may run concurrently.
- Prompt admission is serialized within one session only.
- Prompt execution continues asynchronously after accepted HTTP acknowledgment.
- `abort`, `steer`, and `followUp` resolve the target runtime by explicit session UUID; they never act on a globally selected session.
- Aborting one session cannot affect another.
- Steering follows Pi's existing immediate steering behavior.
- Follow-up uses Pi's existing follow-up queue.
- Existing queue state remains visible in session state responses.
- Idle runtimes shut down after the existing ten-minute timeout.
- Process shutdown destroys all live runtimes.
- Pi's `SessionManager` and JSONL files remain the durable record.

## Extraction and Reuse

The implementation should move working code rather than reproduce it:

- Move `AgentSessionWrapper` behavior from `web/lib/rpc-manager.ts` into the backend runtime unit.
- Move registry, startup-lock, runtime-info, running-state, and lifecycle behavior into the runtime manager.
- Move or wrap session resolution and reading behavior from `web/lib/session-reader.ts` behind session service methods.
- Reuse model cache and model-scope behavior; do not implement a second model-selection algorithm.
- Reuse `createAgentEventStream` framing in the SSE adapter while changing its source from `rpc-manager` to the backend subscription API.
- Preserve project trust checks, image validation, extension binding, startup preferences, project command environment, tool filtering, and cache invalidation.

Extraction may temporarily leave thin re-export files at old import paths to keep changes reviewable. No production behavior should have two independent implementations.

## Error Handling

Initial stable backend error codes include:

- `invalid_request`
- `session_not_found`
- `session_not_running`
- `session_busy`
- `prompt_rejected`
- `model_not_found`
- `access_denied`
- `startup_failed`
- `internal_error`

Routes map errors consistently:

| Condition | HTTP status |
|---|---:|
| Invalid body, parameter, or workspace | 400 |
| Access denied | 403 |
| Session or model not found | 404 |
| Busy or invalid runtime state | 409 |
| Unexpected failure | 500 |

Accepted prompts that fail later emit a session-scoped `prompt_error` followed by existing terminal/reconciliation events. Errors never include stored API keys, authorization headers, or secret file contents.

## Security

This phase preserves the current security boundary:

- Loopback remains the default bind address.
- Existing host validation and browser same-origin checks continue to guard `/api/v1`.
- Existing optional Basic authentication continues to apply when configured.
- Workspace and model requests continue to enforce existing allowed-root and project-trust rules.
- New routes do not enable permissive CORS.

A future mobile/LAN phase must design authenticated device access and explicit CORS/network policy before exposing the backend remotely. The transport-independent backend methods must not assume that the caller is trusted merely because the first adapter runs locally.

## Compatibility and Migration

### Compatibility rule

During migration there is one backend instance and one implementation of each behavior:

```text
legacy route ─┐
              ├── PiBackend
/api/v1 route ┘
```

Legacy routes preserve their current request and response shapes. `/api/v1` uses the new typed contract. Compatibility adapters may reshape data but must not contain runtime logic.

### Web UI cutover

The agent/session/model web UI migration is complete when:

- No browser component or hook calls `/api/agent`, `/api/sessions`, or `/api/models` directly.
- The typed browser client owns the corresponding `/api/v1` URLs and response decoders.
- Agent SSE connections use `/api/v1/sessions/:id/events`.
- Existing refresh-mid-stream, optimistic prompt, reconciliation, queue, abort, fork/navigation, model, tool, Bash, and extension UI behavior still passes.

Every operation used by the current agent/session/model UI has a typed `/api/v1` endpoint in this specification. Legacy routes remain only for unknown downstream compatibility needs and preserve their existing shapes by delegating to the same backend. Their removal is a later explicit change, not automatic cleanup in this sub-project.

## Testing Strategy

Implementation follows repository TDD rules: add a failing behavior test, verify the expected failure, implement the smallest extraction, and keep existing tests green.

### Backend unit tests

Use real extracted code with fake Pi/session boundaries only where SDK I/O is unavoidable:

- Session lookup and startup deduplicate concurrent requests.
- Two sessions can run concurrently without event or command crossover.
- Prompt admission serializes within one session.
- Abort, steering, and follow-up target only the requested session.
- Prompt preflight rejection is distinguishable from failure after acceptance.
- Session event subscriptions include the correct session UUID and clean up.
- Runtime idle shutdown and process cleanup preserve current behavior.
- Backend errors use stable codes and safe messages.

### Contract and route tests

- Every `/api/v1` JSON route returns either `{ data }` or `{ error }`.
- Validation and backend error codes map to the documented HTTP statuses.
- Routes delegate to `PiBackend` and contain no Pi SDK construction.
- SSE preserves subscription-before-snapshot ordering, heartbeats, cancellation cleanup, and startup errors.
- Health and capabilities do not start an agent runtime.

### Compatibility tests

- Existing routes preserve their current wire shapes while delegating to the backend.
- Existing `rpc-manager`, session reader, event stream, and browser behavior tests remain green during extraction.

### Browser client and hook tests

- The client decodes success and error envelopes.
- Prompt rejection remains distinguishable from network failure.
- SSE reconnect during active streaming restores current UI state.
- Abort, steering, follow-up, queues, models, session creation, loading, renaming, deletion, and concurrent sidebar state remain unchanged.
- Source scans or focused tests prevent migrated UI code from regressing to legacy endpoint URLs.

### Validation gates

For each implementation phase:

- `cd web && pnpm test`
- `cd web && pnpm exec tsc --noEmit`
- `cd web && pnpm lint`
- Relevant Rust tests if shell behavior changes; no shell change is expected here.
- Production build only when no Next.js development server is running, per `web/AGENTS.md`.

## Implementation Phases

This design is large enough to require a roadmap before detailed implementation plans.

### Phase 1: Contract and composition seam

- Add serializable contracts and backend error type.
- Add the server-only backend host composition.
- Characterize current behavior with tests before moving code.

### Phase 2: Runtime extraction

- Extract the wrapper, runtime registry, startup locks, lifecycle, and event subscription behavior.
- Preserve old exports through delegation or temporary re-exports.

### Phase 3: Session and model services

- Put current session read/mutation and model-list behavior behind backend methods.
- Ensure routes no longer coordinate Pi lifecycle directly.

### Phase 4: `/api/v1` discovery and read-only session slice

- Add health, capabilities, models, session list/detail/context/thinking, runtime state, and running-session adapters.
- Add consistent envelope and error mapping tests.
- Migrate the browser's read calls (startup, sidebar refresh, cold load, running reconciliation, model selection) to the shared typed client.

### Phase 5: Session creation, core commands, and SSE cutover

- Add session creation, prompt/abort/steer/follow-up/queue adapters, and per-session and running-session SSE.
- Migrate the browser's creation prompts, commands, and streams to `/api/v1`.
- Retain the legacy combined create-and-prompt route as a composing adapter.

### Phase 6: Remaining API roadmap

Write separate design/planning artifacts for workspace/files/Git/worktrees, configuration/auth/trust, skills/plugins, and utilities. Remove legacy routes only after all browser calls and compatibility requirements have migrated.

## Acceptance Criteria

- `web/packages/pi-backend/` contains Pi backend behavior without Next.js transport dependencies.
- Next.js owns process hosting and hot-reload persistence, not Pi business behavior.
- New `/api/v1` routes are thin adapters over one backend instance.
- The browser uses `/api/v1` for the migrated agent/session/model surface.
- Existing routes delegate to the same backend and preserve compatibility.
- Current session persistence and all agent runtime behavior remain unchanged.
- Multiple sessions continue to run without cross-session cancellation or events.
- Prompt submission still acknowledges after Pi preflight and completes through events.
- SSE reconnect and active-message snapshot behavior remain functional.
- Responses and errors follow the documented typed envelopes.
- No new runtime dependency is added.
- Existing auth/security behavior remains in force; mobile auth and remote exposure remain deferred.
- Tests, type checking, and lint pass with clean output.

## Deferred Decisions

These decisions require a real second consumer and must not be pre-built now:

- WebSocket framing and connection ownership.
- gRPC service definitions.
- Standalone server/CLI lifecycle.
- Public package exports and versioning.
- Mobile device authentication and pairing.
- CORS and remote-network policy.
- Durable event replay or persisted run history.
