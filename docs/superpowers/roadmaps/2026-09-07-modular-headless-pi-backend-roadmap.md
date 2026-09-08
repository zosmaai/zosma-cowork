# Modular Headless Pi Backend Roadmap

> **For agentic workers:** Use /skill:writing-plans to create one detailed implementation plan per phase. Start with Phase 1 and proceed sequentially unless the user explicitly changes the order.

**Goal:** Make the web frontend a pure client of a versioned, transport-independent Pi backend API while preserving current behavior and preparing every existing server capability for future mobile or alternative-transport clients.

**Design Spec:** [`docs/superpowers/specs/2026-09-07-modular-headless-pi-backend-design.md`](../specs/2026-09-07-modular-headless-pi-backend-design.md)

**Planning Strategy:** The migration crosses runtime lifecycle, streaming, session persistence, browser state, filesystem security, credentials, and package management. It is divided into ordered vertical slices that share one backend instance, keep legacy routes functional, migrate the matching browser calls, and finish with green tests before the next slice begins. Phases 1–7 implement the approved agent/session/model foundation; later domain phases follow the same extraction pattern and require focused contract review before their detailed plans.

---

## Phase 1: Contracts, Errors, and Backend Composition Seam

**Outcome:** A server-only `PiBackend` composition seam and stable serializable contract/error types exist without changing current route or browser behavior.

**Why now:** Runtime code cannot be moved safely until transport-independent boundaries, dependency ownership, and one host-managed backend instance are explicit.

**Scope:**
- Establish `web/packages/pi-backend/` public contracts, stable backend error codes, and facade shape.
- Add a Next.js server-only host that constructs and reuses one backend instance across development hot reloads.
- Add contract and composition tests that characterize current response, session identity, and lifecycle assumptions.
- Keep existing `rpc-manager`, session-reader, routes, and browser clients operational.

**Out of scope:**
- Moving Pi runtime or persistence behavior.
- Adding `/api/v1` routes.
- Migrating browser requests.

**Key files/areas likely affected:**
- `web/packages/pi-backend/`: contracts, errors, facade, and dependency boundaries.
- `web/lib/pi-backend-host.ts`: server-only backend construction and hot-reload ownership.
- `web/lib/types.ts`, `web/lib/pi-types.ts`: type moves or temporary type re-exports.
- `web/lib/*.test.mjs`: contract and composition characterization.

**Dependencies:**
- Approved design specification.
- Existing Pi SDK and Next.js process lifecycle.

**Verification:**
- Import-boundary tests prove the backend package does not depend on Next.js request/response APIs or browser modules.
- One host-managed instance survives repeated module access without creating duplicate registries.
- Existing web tests, typecheck, and lint remain green.

**Phase boundary health:** No production request path changes. The application behaves exactly as before while later extraction has a tested destination.

**Risks:**
- Shared types may accidentally pull server runtime code into browser bundles. Keep contract exports serializable and use browser-side type-only imports.
- Premature interfaces could duplicate existing behavior. Define only seams required by the approved contract and current code.

**Context notes:** Follow TDD and preserve existing wire fields. Do not add an adapter registry, generic transport framework, package build, or new dependency.

---

## Phase 2: Runtime Manager and Event Source Extraction

**Outcome:** Agent session wrappers, runtime registries, startup locks, lifecycle cleanup, running-session state, and transport-neutral event subscriptions live behind `PiBackend`, with old imports delegating to the extracted implementation.

**Why now:** Every command and streaming route depends on correct runtime identity and lifecycle. Extracting this foundation before routes prevents two competing runtime implementations.

**Scope:**
- Move the existing `AgentSessionWrapper` and per-session runtime behavior with minimal semantic change.
- Extract registry, shared cold-start promise, prompt admission serialization, ten-minute idle shutdown, and process cleanup.
- Expose session-scoped event and running-session subscriptions without SSE framing.
- Keep `globalThis` lifecycle assumptions in host composition rather than backend business logic.
- Preserve temporary `rpc-manager` exports as delegating compatibility seams.

**Out of scope:**
- New API routes or browser URL changes.
- Changes to prompt, abort, steer, follow-up, queue, retry, or compaction semantics.
- WebSocket, gRPC, durable replay, or run resources.

**Key files/areas likely affected:**
- `web/lib/rpc-manager.ts`: source behavior and compatibility exports.
- `web/packages/pi-backend/runtime.ts`: extracted wrapper and command execution.
- `web/packages/pi-backend/runtime-manager.ts`: registry, locks, lifecycle, and subscriptions.
- `web/lib/process-lifecycle.ts`, `web/lib/agent-event-stream.ts`: host cleanup and existing stream source integration.
- `web/lib/rpc-manager*.test.mjs`, event tests: concurrency and cleanup characterization.

**Dependencies:**
- Phase 1 facade, contracts, and host composition.

**Verification:**
- Concurrent starts for one session resolve to one runtime; different sessions remain independent.
- Abort, queued messages, events, model state, and shutdown for one session do not affect another.
- Subscription cleanup and running-session notifications match current behavior.
- Existing legacy agent routes and tests remain green through delegation.

**Phase boundary health:** All public endpoints remain unchanged and use the same extracted runtime through compatibility exports; there is no duplicated live-session registry.

**Risks:**
- Hidden singleton state may remain in callbacks, extension bindings, or shutdown hooks. The detailed plan must inventory every module/global runtime reference.
- Fork mutates Pi's inner session identity. Preserve immediate wrapper destruction after fork to avoid registry corruption.

**Context notes:** This is a move-and-delegate phase, not a redesign. Capture session identity when subscribing; never infer it later from UI selection or mutable inner state.

---

## Phase 3: Session Persistence and Chat Model Service Extraction

**Outcome:** Session read/mutation operations and chat model discovery/startup selection are transport-independent backend services used by existing routes.

**Why now:** `/api/v1` read and creation endpoints need stable services that do not perform filesystem or Pi SDK coordination inside route handlers.

**Scope:**
- Move or wrap session listing, UUID resolution, context/tree reads, deferred content, rename, delete, export preparation, stats, and auto-name behavior behind backend methods.
- Move or wrap chat model listing, model scope diagnostics, default selection, startup preferences, and cache behavior behind backend methods.
- Preserve project grouping, parent-session handling, cache invalidation, and deep-session export safeguards.
- Convert service failures to stable backend errors while compatibility routes retain current wire shapes.

**Out of scope:**
- Provider credential management and editable model configuration.
- New `/api/v1` transport adapters.
- Workspace/file, Git, or worktree migration.

**Key files/areas likely affected:**
- `web/lib/session-reader.ts`: source behavior and compatibility delegation.
- `web/lib/models-cache.ts`, `web/lib/model-scope.ts`, `web/lib/startup-preferences.ts`: model behavior reused by the backend.
- `web/packages/pi-backend/sessions.ts`, `models.ts`: transport-independent services.
- Existing session, model-scope, cache, title, timing, and export tests.

**Dependencies:**
- Phase 2 runtime manager for live/cold session coordination.

**Verification:**
- Backend methods and existing routes produce equivalent session/model data for representative cold, running, branched, and deferred sessions.
- Session deletion coordinates with live runtime cleanup and preserves current child re-parenting behavior.
- Model scope patterns, thinking pins, warnings, and fallback behavior remain unchanged.
- Existing tests, typecheck, and lint remain green.

**Phase boundary health:** Legacy routes still expose their established contracts but now delegate persistence and model decisions to the backend rather than reimplementing them.

**Risks:**
- Live runtime state and JSONL snapshots can disagree. Preserve the current authority and reconciliation rules rather than introducing a second cache.
- Absolute file paths remain necessary compatibility data but must not become public URL identifiers or authorization tokens.

**Context notes:** Reuse Pi `SessionManager`, existing normalizers, and current caches. Do not create new persistence or model-selection algorithms.

---

## Phase 4: `/api/v1` Discovery and Read-Only Session Slice

**Outcome:** Versioned health, capabilities, chat models, session reads, runtime state, and running-session endpoints exist as thin adapters, and matching browser reads use them.

**Why now:** Read-only endpoints validate envelopes, error mapping, URL identity, and browser decoding before command and streaming paths are moved.

**Scope:**
- Add `/api/v1` health and capability discovery.
- Add versioned chat model listing, session list/detail/context/deferred-thinking reads, runtime state, and running-session snapshot endpoints.
- Introduce shared Next.js JSON-envelope and backend-error mapping helpers.
- Extend the focused browser API client and migrate corresponding reads from `/api/models`, `/api/sessions`, and agent state/running paths.
- Keep all legacy endpoints as adapters over the same backend.

**Out of scope:**
- Session creation/mutation, prompts, runtime controls, and SSE.
- Export and Bash plain-text responses.
- Non-agent API domains.

**Key files/areas likely affected:**
- `web/app/api/v1/health`, `capabilities`, `models`, and `sessions/**`: thin route handlers.
- `web/lib/agent-client.ts` or a focused versioned client module: envelopes and read methods.
- `web/components/AppShell.tsx`, `SessionSidebar.tsx`, `ChatWindow.tsx`: migrated read calls.
- Route, contract, client, and source-scan tests.

**Dependencies:**
- Phase 3 session and model services.

**Verification:**
- Every successful JSON response uses `{ data }`; failures use the stable `{ error }` envelope and documented status mapping.
- Health/capabilities do not start a Pi runtime.
- Browser startup, sidebar refresh, cold session loading, active-run reconciliation, and model selection data work through `/api/v1`.
- A focused source scan prevents migrated read paths from returning to legacy URLs.

**Phase boundary health:** Browser reads use `/api/v1`, while all commands and streams continue through working legacy adapters. Mixed transport paths are intentional, tested, and coherent.

**Risks:**
- Route precedence around static paths such as `running` can collide with `:id`. Use explicit Next.js route directories and contract tests.
- Envelope migration may alter hook assumptions. Centralize decoding in the client instead of branching in components.

**Context notes:** Read the repository's installed Next.js route-handler documentation before planning implementation. Routes validate transport input and map output only.

---

## Phase 5: Session Creation, Core Commands, and SSE Cutover

**Outcome:** The browser creates sessions, streams events, submits prompts, aborts, steers, follows up, and manages queues exclusively through `/api/v1`.

**Why now:** Phase 4 proves the versioned client and error envelope. Core interactive behavior can now move as one coherent create-command-event loop.

**Scope:**
- Add versioned session creation and core prompt, abort, steer, follow-up, and queue endpoints.
- Add session and running-session SSE adapters over transport-neutral backend subscriptions.
- Preserve subscribe-before-snapshot ordering, connected state, heartbeat comments, active-message snapshots, startup errors, and request-cancellation cleanup.
- Migrate browser creation, core commands, per-session SSE, and running-session SSE/polling to the versioned client.
- Preserve the legacy combined create-and-prompt route by composing backend operations.

**Out of scope:**
- Tools, model mutation, thinking changes, compaction, Bash, branching, reload, export, and extension UI commands.
- WebSocket or replay support.

**Key files/areas likely affected:**
- `web/app/api/v1/sessions/**`: create, core command, queue, and event routes.
- `web/lib/agent-event-stream.ts`, `web/lib/agent-event-connection.ts`: SSE framing over backend subscriptions.
- `web/lib/agent-client.ts`, `web/hooks/useAgentSession.ts`, `web/components/ChatWindow.tsx`: client cutover.
- Existing prompt recovery, streaming message, event wire, reconciliation, and concurrent-session tests.

**Dependencies:**
- Phase 4 versioned client, route helpers, and state reads.

**Verification:**
- Prompt acknowledgment still occurs after validation and Pi preflight, not after the full turn.
- Refresh during streaming reconstructs the active message and correct runtime state.
- Abort, steer, follow-up, and queue clearing affect only the requested session.
- SSE disconnects remove listeners and timers; running-session updates remain accurate.
- Source scans show no browser use of legacy create, prompt, core command, or event URLs.

**Phase boundary health:** The complete primary chat loop uses `/api/v1`; advanced controls remain available through unchanged legacy adapters. Both route generations share one runtime and event source.

**Risks:**
- Opening the stream after prompt submission can lose early events. Preserve the current open-before-prompt and subscribe-before-snapshot ordering.
- Late events or reconciliation from an older browser run can resurrect stale UI. Preserve the existing client monotonic run correlation even though it is not a public backend resource.

**Context notes:** SSE is only an adapter. Backend subscriptions must not know about HTTP streams, comments, heartbeats, or request abort signals.

---

## Phase 6: Runtime Controls, Tools, Compaction, and Bash Cutover

**Outcome:** Runtime configuration and execution controls used by chat operate through typed `/api/v1` methods, including tools, commands, model/thinking settings, preferences, compaction, Bash, reload, and stats.

**Why now:** These controls depend on the stable session runtime and event loop from Phase 5 but can migrate without branching/export or extension UI concerns.

**Scope:**
- Add versioned endpoints for tool listing/selection, slash commands, model changes, thinking level, auto-compaction/retry preferences, compact/cancel, Bash/cancel/output, reload, stats, and last-assistant text.
- Preserve blocking versus accepted command behavior and existing typed Pi results.
- Keep Bash output as constrained plain text rather than a JSON envelope.
- Migrate corresponding browser controls and reconciliation calls to the versioned client.
- Retain legacy handlers as shape-preserving adapters.

**Out of scope:**
- Fork/navigation, export, auto-name, deferred session data, and extension UI responses.
- Provider/model configuration APIs.

**Key files/areas likely affected:**
- `web/app/api/v1/sessions/[id]/**`: advanced runtime-control adapters.
- `web/packages/pi-backend/runtime.ts`: facade methods over existing wrapper commands.
- `web/lib/agent-client.ts`, `web/components/ChatInput.tsx`, `ChatWindow.tsx`: typed client methods.
- Tool preset, model switching, compaction, terminal, Bash output, and stats tests.

**Dependencies:**
- Phase 5 versioned interactive session loop.

**Verification:**
- Tool disablement, model/thinking changes, preferences, compaction, and Bash behavior match legacy flows.
- Bash cancellation and output access remain session-scoped and path-constrained.
- Legacy and versioned route contract tests execute the same backend behavior.
- Browser source scans show no fallback to the legacy agent command multiplexer for migrated controls.

**Phase boundary health:** Chat remains fully usable; only the separately grouped session-history and extension interactions still use compatibility endpoints.

**Risks:**
- The current generic agent command route hides command-specific response differences. Characterize each command before assigning a typed endpoint response.
- Tool and model updates may race with active prompts. Preserve Pi's current admission and mutation rules rather than adding new locking.

**Context notes:** One behavior per test. Do not normalize all commands into `accepted: true` when the current caller depends on a concrete result.

---

## Phase 7: Session History, Branching, Export, and Extension UI Completion

**Outcome:** Every browser call to the current agent/session/chat-model surface uses `/api/v1`, completing the approved first sub-project while legacy routes remain compatibility adapters.

**Why now:** Branching and extension UI carry special lifecycle and response-shape risks, so they move after the core runtime and controls are stable.

**Scope:**
- Add versioned rename/delete, auto-name, fork, in-session navigation, export, and extension UI response/input endpoints not completed earlier.
- Preserve fork wrapper destruction, session-tree identity, child re-parenting, deep export safety, and extension discriminated unions.
- Migrate all remaining browser calls to `/api/agent`, `/api/sessions`, and `/api/models` onto the typed versioned client.
- Add an enforcement test or source scan that bans those legacy URLs from browser components and hooks.
- Keep legacy routes operational over the same backend for unknown downstream consumers.

**Out of scope:**
- Deleting legacy routes.
- Workspace, files, Git, worktrees, credentials, skills, plugins, or updates.

**Key files/areas likely affected:**
- `web/app/api/v1/sessions/[id]/**`: history, navigation, export, and extension adapters.
- `web/components/AppShell.tsx`, `SessionSidebar.tsx`, `BranchNavigator.tsx`, extension components: final client migration.
- `web/lib/agent-client.ts`: complete first-surface API.
- Session tree, auto-name, export, extension widget/status, and custom UI tests.

**Dependencies:**
- Phase 6 advanced runtime controls.

**Verification:**
- No browser component or hook references `/api/agent`, `/api/sessions`, or `/api/models`.
- Fork, navigation, rename, deletion, auto-name, export, and extension UI behavior match current behavior.
- Legacy route compatibility tests preserve established request and response shapes.
- Full web tests, typecheck, lint, and permitted production build pass cleanly.

**Phase boundary health:** The agent/session/model migration is complete and independently releasable. The frontend is a `/api/v1` client for its full chat surface, while unrelated domains continue working through legacy routes.

**Risks:**
- Forking mutates the loaded Pi session. Destroy the old keyed runtime immediately and verify subsequent operations reload the original session correctly.
- Extension UI payloads are heterogeneous. Preserve the existing discriminated union rather than weakening contracts to `unknown` command bodies.

**Context notes:** This is the acceptance boundary for the approved design spec. Run the complete Phase 1–7 acceptance suite before planning later domain migrations.

---

## Phase 8: Workspace, Home, Files, and File Index APIs

**Outcome:** Workspace selection, directory browsing, home/default workspace discovery, file access, and file indexing use a reviewed `/api/v1` contract and transport-independent backend services.

**Why now:** These APIs provide the project context used by later Git, worktree, resource, and configuration migrations.

**Scope:**
- Review and document the current workspace/file/index wire behavior and security rules before detailed planning.
- Extract allowed-root registration, workspace validation, browsing, home/default-cwd, file reads, and indexing orchestration from routes.
- Add thin versioned adapters and typed browser methods.
- Migrate matching UI calls while preserving legacy route shapes.

**Out of scope:**
- Git status/diff and worktree mutation.
- Remote filesystem access, uploads beyond current behavior, or mobile network policy.

**Key files/areas likely affected:**
- `web/app/api/cwd/**`, `default-cwd`, `home`, `files/**`, `file-index`: compatibility routes.
- Corresponding `web/app/api/v1/**` adapters.
- `web/lib/file-access.ts`, path security, directory browser, and index modules: backend service extraction.
- `web/components/FileExplorer.tsx`, `FileViewer.tsx`, workspace selection flows: client migration.

**Dependencies:**
- Phase 7 completed core API pattern.
- Focused workspace/files contract review approved before its detailed implementation plan.

**Verification:**
- Allowed roots, symlink/case handling, path encoding, and denied-path behavior match current security tests.
- Browser workspace and file flows use only `/api/v1` endpoints for this domain.
- Legacy endpoints remain compatible over the same service implementation.

**Phase boundary health:** File and workspace features remain fully functional and independently releasable; Git/worktree features still use their unchanged legacy APIs.

**Risks:**
- Filesystem access is a security boundary. Retain one canonical containment implementation and avoid route-local checks.
- Native path semantics differ across platforms. Preserve existing normalization and case-folding behavior.

**Context notes:** Future mobile usability does not authorize remote file exposure. Current host/origin/auth and allowed-root restrictions remain mandatory.

---

## Phase 9: Git Status, Diff, and Worktree APIs

**Outcome:** Git inspection and worktree lifecycle operations use transport-independent services and typed `/api/v1` endpoints, with the browser migrated and compatibility preserved.

**Why now:** Phase 8 provides stable workspace identity and file authorization required to secure repository operations.

**Scope:**
- Review current Git/worktree contracts, dirty-worktree confirmation, and project identity behavior.
- Extract Git status/diff and worktree list/create/remove operations from route handlers.
- Add versioned adapters and migrate browser calls.
- Preserve project grouping, linked-worktree top-level resolution, native path conversion, and allowed-root registration.

**Out of scope:**
- General-purpose Git command execution.
- Remote repository credentials or hosting-provider integration.

**Key files/areas likely affected:**
- `web/app/api/git/**`, `web/app/api/worktrees/route.ts`: compatibility routes.
- Corresponding `web/app/api/v1/**` adapters.
- `web/lib/worktree.ts`, `git-changes.ts`, `paths.ts`: backend service boundaries.
- `web/components/SessionSidebar.tsx` and worktree UI: client migration.

**Dependencies:**
- Phase 8 workspace/file services and allowed-root behavior.
- Focused Git/worktree contract review.

**Verification:**
- Status/diff and worktree operations match current behavior on main and linked worktrees.
- Dirty removal still returns a distinguishable conflict and requires explicit force retry.
- Windows/native path identity tests, project grouping tests, and browser source scans remain green.

**Phase boundary health:** Git and worktree features are fully versioned without affecting auth, skills, plugins, or update APIs.

**Risks:**
- Git emits POSIX-style paths on Windows. Continue converting filesystem paths while leaving branch names untouched.
- Removing a worktree can invalidate active sessions. Preserve existing fallback and project-group reconciliation.

**Context notes:** Reuse current command helpers and validation; do not expose a generic shell or Git RPC endpoint.

---

## Phase 10: Model Configuration and Project Trust APIs

**Outcome:** Editable model configuration, catalog/discovery/testing, and project trust decisions use versioned APIs and backend services separate from route transport.

**Why now:** Chat model selection already uses the backend, and workspace identity is stable. Configuration and trust can now move without mixing credential login flows into the same plan.

**Scope:**
- Review versioned contracts for model config read/write, catalog, discovery, test, and project trust.
- Extract storage, validation, locking, discovery, testing, and trust decisions behind backend methods.
- Add versioned adapters and migrate ModelsConfig/project-trust browser flows.
- Preserve atomic writes, cache invalidation, safe diagnostics, and legacy route compatibility.

**Out of scope:**
- Provider login/logout or credential storage migration.
- Changing model config format, provider semantics, or trust policy.

**Key files/areas likely affected:**
- `web/app/api/models-config/**`, `web/app/api/project-trust/route.ts` and versioned counterparts.
- Model catalog/discovery/config store and project-trust modules under `web/lib/`.
- `web/components/ModelsConfig.tsx` and trust UI callers.

**Dependencies:**
- Phase 9 workspace identity.
- Phase 3 model service boundary.
- Focused configuration/trust contract review.

**Verification:**
- Config read/write, catalog, discovery, test, and trust flows match current success and error behavior.
- Secrets and raw credentials never appear in errors or test diagnostics.
- Browser calls use `/api/v1`; legacy contracts remain green over the same services.

**Phase boundary health:** Model configuration and trust are independently versioned, while existing provider authentication endpoints continue unchanged.

**Risks:**
- Model testing may accidentally expose keys or upstream responses. Preserve redaction and stable safe errors.
- Config writes can race with auth or model-cache reads. Reuse current locking and invalidation rather than adding parallel state.

**Context notes:** Keep editable provider configuration distinct from chat model listing and from credential ownership.

---

## Phase 11: Provider Credential and OAuth APIs

**Outcome:** Provider discovery, API-key status/storage, OAuth/device-code login, manual-code completion, and logout use versioned, transport-independent services.

**Why now:** Model configuration has a stable boundary, allowing credential lifecycle to migrate without conflating it with model file editing.

**Scope:**
- Review public credential status and streaming login contracts.
- Extract provider listing, credential-type-safe storage/removal, OAuth callbacks, login streaming, and logout behavior.
- Add versioned HTTP/SSE adapters and migrate provider-auth UI calls.
- Preserve dual-auth provider deduplication, global login callback lifecycle, file locks, and secret redaction.

**Out of scope:**
- Zosma account-specific authentication.
- Mobile pairing, bearer-token design, permissive CORS, or remote exposure.

**Key files/areas likely affected:**
- `web/app/api/auth/all-providers`, `providers`, `api-key/**`, `login/**`, `logout/**` and versioned counterparts.
- Provider listing/runtime, credential store, and auth storage modules under `web/lib/`.
- `web/components/ModelsConfig.tsx` provider authentication flows.

**Dependencies:**
- Phase 10 model configuration boundary.
- Focused provider-auth contract and security review.

**Verification:**
- API-key status never returns key material; type-safe deletion cannot remove a different credential kind.
- OAuth/device-code/manual-code flows reconnect, complete, cancel, and clean up as before.
- Dual-auth providers appear once and refresh correctly after every auth change.
- Browser provider auth uses `/api/v1`; legacy routes remain compatible.

**Phase boundary health:** Provider authentication is fully migrated and releasable; Zosma account auth remains isolated on its existing endpoints.

**Risks:**
- Login streams and callbacks are process-lifetime state. Keep ownership explicit and guarantee cleanup on disconnect, completion, and process shutdown.
- Provider capabilities change across SDK releases. Continue deriving lists from capability metadata instead of hard-coded IDs.

**Context notes:** Alternative future transports call the same auth methods, but this phase does not design mobile or remote authentication for the backend itself.

---

## Phase 12: Zosma Authentication APIs

**Outcome:** Zosma-specific configuration, status, start/callback/complete/cancel, refresh, API-key, and disconnect flows use a reviewed `/api/v1` contract and one backend service.

**Why now:** Zosma auth has a separate lifecycle and larger endpoint family than generic provider credentials; isolating it protects both sets of security-sensitive flows.

**Scope:**
- Review the Zosma auth state machine and public response/error contract.
- Extract Zosma auth coordination and storage from route handlers.
- Add versioned adapters and migrate `useZosmaAuth` and related UI.
- Preserve cancellation, callback correlation, refresh, disconnect, redaction, and legacy compatibility.

**Out of scope:**
- Replacing Zosma's upstream protocol.
- Mobile device pairing or remote backend authorization.

**Key files/areas likely affected:**
- `web/app/api/auth/zosma/**` and versioned counterparts.
- Zosma auth service modules under `web/lib/` or `web/packages/pi-backend/` host services.
- `web/hooks/useZosmaAuth.ts`, `web/components/ZosmaAuthCard.tsx`, shell/auth UI.

**Dependencies:**
- Phase 11 shared auth error, streaming, and secret-handling patterns.
- Focused Zosma auth contract/security review.

**Verification:**
- Each auth state transition and cancellation path has behavior coverage.
- Tokens, API keys, callback secrets, and authorization headers never enter client-safe errors or logs.
- Browser Zosma flows use `/api/v1`; existing route compatibility tests remain green.

**Phase boundary health:** All current authentication domains are versioned and functional, with no change to network exposure or login semantics.

**Risks:**
- Partial callbacks can leave stale pending state. Preserve existing expiration/cancellation behavior and test retry paths.
- Shared auth helpers could erase Zosma-specific semantics. Reuse only genuinely common transport/error pieces.

**Context notes:** Treat this as a focused security-sensitive vertical slice; do not combine it with legacy-route deletion.

---

## Phase 13: Skills and Plugin Management APIs

**Outcome:** Skill discovery/check/install/update/toggle and plugin package management use transport-independent services and versioned browser APIs.

**Why now:** Runtime, workspace, trust, and credential foundations are stable, providing the context and safeguards resource/package operations need.

**Scope:**
- Review skills and plugin operation contracts, progress/error behavior, and global versus project scope.
- Extract resource loading, frontmatter mutation, skill search/install/update/check, and package plugin management from routes.
- Add versioned adapters and migrate SkillsConfig/PluginsConfig calls.
- Preserve locks, surgical frontmatter edits, `npx` invocation boundaries, package enable/disable semantics, and legacy compatibility.

**Out of scope:**
- Redesigning Pi's package/resource model.
- Adding a marketplace, background job system, or new installer dependency.

**Key files/areas likely affected:**
- `web/app/api/skills/**`, `web/app/api/plugins/route.ts` and versioned counterparts.
- `web/lib/npx.ts`, frontmatter, skill lock/update, and resource-loader/package-manager boundaries.
- `web/components/SkillsConfig.tsx`, `PluginsConfig.tsx`.

**Dependencies:**
- Phase 12 complete auth migration.
- Phase 8 workspace/project context.
- Focused skills/plugins contract review.

**Verification:**
- Loaded, disabled, searchable, installable, and updatable skill states match current behavior.
- Toggling only changes `disable-model-invocation` and preserves unrelated user formatting.
- Plugin install/remove/update/enable/disable behavior matches current global/project semantics.
- Browser calls use `/api/v1`; legacy routes delegate to the same services.

**Phase boundary health:** Skills and plugins remain complete user-facing features, now independently accessible through the versioned API; app update remains the only unmigrated utility domain.

**Risks:**
- Shelling through package tools can produce unbounded or unsafe output. Preserve current bounded execution and safe error mapping.
- Resource caches may remain stale after mutations. Reuse current invalidation/reload paths and verify running-session behavior.

**Context notes:** Skills and plugins share resource/package context but should remain separate internal units; do not create one generic mutation endpoint.

---

## Phase 14: App Update and Remaining Utility API Completion

**Outcome:** Every supported server capability has a versioned API and the browser has no direct dependency on unversioned application routes.

**Why now:** Core, filesystem, configuration, auth, and package domains are complete, leaving a small utility surface that can be closed without hiding larger migrations.

**Scope:**
- Inventory `web/app/api` against the roadmap and identify any route not covered by Phases 1–13.
- Review and migrate app-update behavior plus any genuinely remaining utility route.
- Add backend service methods, versioned adapters, typed client methods, browser migration, and compatibility tests.
- Add a repository-level browser source scan preventing new unversioned API calls.

**Out of scope:**
- Removing compatibility routes.
- Adding new product capability or remote/mobile deployment.

**Key files/areas likely affected:**
- `web/app/api/app-update/route.ts` and corresponding `/api/v1` adapter.
- `web/lib/app-update.ts` and update UI callers.
- API inventory and browser URL enforcement tests.

**Dependencies:**
- Phases 1–13.
- Focused review for any route discovered by the final inventory.

**Verification:**
- The route inventory maps every legacy endpoint to a versioned endpoint or an explicit non-public exception.
- Browser components/hooks/clients use `/api/v1` for all server communication.
- Update checks preserve current packaging/platform behavior.
- Full web tests, typecheck, lint, security-sensitive suites, and permitted production build pass.

**Phase boundary health:** The full application is a client of `/api/v1`, and all legacy endpoints remain stable compatibility adapters. The system is complete even if retirement is deferred indefinitely.

**Risks:**
- Hidden URL construction may evade simple string scans. Combine inventory, focused tests, and searches for `fetch`, `EventSource`, and request helpers.
- Utility routes can contain environment-specific behavior. Preserve current platform gates and avoid broad refactors.

**Context notes:** This phase proves migration completeness, not deletion readiness. Unknown external users may still depend on legacy routes.

---

## Phase 15: Legacy Endpoint Retirement

**Outcome:** Unversioned routes and temporary compatibility exports are removed only after explicit compatibility approval, leaving `/api/v1` as the single public HTTP/SSE surface.

**Why now:** Retirement is safe only after every browser domain has migrated, route parity is demonstrated, and downstream compatibility requirements are known.

**Scope:**
- Confirm whether any desktop packaging, automation, documentation, or external consumer still uses legacy endpoints.
- Establish and execute an explicit deprecation/removal decision.
- Remove legacy route adapters, obsolete multiplexer/request shapes, and temporary re-exports that no longer protect an active caller.
- Update documentation and final API inventory.

**Out of scope:**
- WebSocket, gRPC, standalone process, published package, mobile authentication, or remote-network exposure.
- Contract changes to `/api/v1` unrelated to legacy removal.

**Key files/areas likely affected:**
- `web/app/api/**` legacy route directories.
- Temporary compatibility modules in `web/lib/`.
- Browser/server documentation, tests, packaging scripts, and API inventory.

**Dependencies:**
- Phase 14 complete versioned migration.
- Explicit user/product approval to retire legacy endpoints.
- Confirmed absence or planned migration of downstream legacy consumers.

**Verification:**
- Repository and packaged-output scans find no legacy endpoint references.
- `/api/v1` contract, browser behavior, SSE reconnection, auth, files, Git/worktrees, resources, and update flows pass their full suites.
- Typecheck, lint, tests, security checks, and permitted production build pass cleanly.

**Phase boundary health:** This phase ends with one coherent API surface and no compatibility scaffolding. If compatibility approval is not granted, Phase 14 remains a healthy final state and this phase is deferred.

**Risks:**
- Unknown clients may rely on unversioned routes. Do not infer permission to remove them from browser migration alone.
- Compatibility modules may still serve internal imports. Use import/reference scans and incremental deletion with tests.

**Context notes:** Treat route removal as a breaking change with its own detailed plan and release communication. Do not combine it with new transport or mobile work.

---

## Coverage Summary

| Capability | Roadmap phase |
|---|---|
| Backend contracts, typed errors, and host composition | Phase 1 |
| Runtime wrapper, concurrency, lifecycle, and event source | Phase 2 |
| Session persistence and chat model services | Phase 3 |
| Health, capabilities, models, session reads/state/running | Phase 4 |
| Session creation, core commands, queues, and SSE | Phase 5 |
| Tools, model/thinking controls, preferences, compaction, Bash, reload, stats | Phase 6 |
| Session mutation, branching, export, extension UI, first-surface completion | Phase 7 |
| Workspace selection, home/default cwd, file access, and indexing | Phase 8 |
| Git status/diff and worktrees | Phase 9 |
| Model configuration, catalog/discovery/test, and project trust | Phase 10 |
| Provider listing, API keys, OAuth/device-code login, and logout | Phase 11 |
| Zosma-specific authentication | Phase 12 |
| Skills and plugins | Phase 13 |
| App update, final utility inventory, and complete browser cutover | Phase 14 |
| Legacy endpoint retirement | Phase 15 |

## Deferred Across All Phases

- Standalone backend process or CLI lifecycle.
- Publishing `pi-backend` as an npm package.
- Mobile client implementation, device pairing, and mobile authentication.
- LAN/WAN exposure, permissive CORS, or a new remote authorization model.
- WebSocket and gRPC adapters.
- Durable event replay, persisted run resources, or a second session persistence model.
- Changes to current Pi command, queue, concurrency, or JSONL semantics.
- New product capabilities unrelated to extracting and versioning the existing server surface.
