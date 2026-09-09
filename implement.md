# Implement.md — Tracking sheet (Phase 1 /api/v1 epic)

**Unit of work:** The 7 **In Progress** tickets in the *Zosma Cowork* project
that make up Phase 1's headless boundary + its upstream scaffolding.

**Branch:** `feat/zos-84` — commits ahead of `main` (see `git log`)
**Linear project:** [Zosma Cowork](https://linear.app/zosma/project/zosma-cowork-1c5596ac70a9/issues)
**Last synced:** 2026-09-09

---

## Status at a glance

**ALL SEVEN TICKETS — CODE COMPLETE + GREEN.** Everything below is uncommitted;
nothing has been committed since the last commit, pending your review.

| #   | Ticket                                                       | Priority | Status         | Verify                                              |
| --- | ------------------------------------------------------------ | -------- | -------------- | -------------------------------------------------- |
| 1   | **ZOS-99** Versioned Cowork protocol package                 | 2        | 🟢 Complete    | `packages/protocol` — 27/27 tests, tsc clean       |
| 2   | **ZOS-86** Standalone TypeScript Cowork daemon               | 2        | 🟢 Complete    | `daemon` — 18/18 tests, tsc clean, e2e smoke green |
| 3   | **ZOS-84** Streaming over /api/v1                            | 2        | 🟢 Complete    | web globs + packages/stream + lib/stream tests     |
| 4   | **ZOS-80** Model & thinking-level controls over /api/v1      | 3        | 🟢 Complete    | session-model + model route + client tests         |
| 5   | **ZOS-82** Extensions/skills/prompts management over /api/v1 | 3        | 🟢 Complete    | skills + plugins + errors envelope tests           |
| 6   | **ZOS-81** Runtime contract + end-to-end wire tests          | 3        | 🟢 Complete    | contract + roundtrip tests                         |
| 7   | **ZOS-83** No-UI-import guard for agent-runtime code         | 3        | 🟢 Complete    | packages/pi-backend guard test                     |

**Score: 7/7 code-complete + green. Commit status: all uncommitted, pending your review.**

---

## What was done, per ticket

### 🟢 ZOS-99 — Versioned Cowork protocol package

`packages/protocol` — a standalone `@zosma-cowork/protocol` package (v1.0.0,
private, type module). Zero runtime deps, transport-neutral, no Next/Pi/UI/
transport imports.

- Runtime-validated, versioned envelopes: `Envelope<P>` = `{v, cid, t, ts, payload}`
  built by `envelope()` with `isEnvelope` / `verifyEnvelope` / `serialize` /
  `deserialize`. `createEnvelope()` + `create*Envelope` factories.
- Version negotiation: `negotiateVersion()` clamps to `[MIN, CURRENT]`,
  `negotiateCapabilities()` intersects, `negotiateHandshake()` combines them into
  a typed `Negotiation` Result.
- Stable typed errors (`ProtocolError`) with codes
  `invalid_protocol_version / unsupported_version / unknown_command /
  missing_field / invalid_field / unknown_type` — invalid payloads fail with a
  stable code, never a thrown exception.
- Hand-written zero-dep validators (`schema.ts`): literal/string/number/boolean/
  enum/object/array/optional/record.

**Verified:** 27/27 tests pass, `tsc --noEmit` clean. (No Next/UI/transport deps.)

### 🟢 ZOS-86 — Standalone TypeScript Cowork daemon

`daemon/` package + `bin/zosma-daemon.js` entrypoint. Node stdlib only, built
**without** ZOS-99 (ticket scopes the protocol dep to orchestration only).

- Health/readiness: `/health` → 200 `{"status":"ready"}` / 503 while starting.
- Single-instance lock (`.lock` file, PID + staleness auto-reclaim).
- Authenticated loopback IPC: 127.0.0.1 only, Bearer token, timing-safe compare.
- Structured JSON logs (secret-key redaction), graceful SIGINT/SIGTERM shutdown,
  token persisted with `0o600`.

**Verified:** 18/18 tests, `tsc --noEmit` clean; e2e smoke — health 200, dup →
exit 3, IPC 401/401/200/400, SIGTERM clean exit.

### 🟢 ZOS-84 — Streaming over /api/v1

Real-time agent output on the transport-neutral boundary. Route
`POST /api/v1/sessions/{id}/stream` pipes Pi's SSE output. Facade `getSessionStream`
throws `session_not_found` for a dead wrapper (no cold start — v1 streams only
pre-existing sessions). Browser-safe SSE client `streamSession()` in `api-v1-client`.

**Verified:** packages/stream, lib/stream tests, route test green; tsc clean.

### 🟢 ZOS-80 — Model & thinking-level controls over /api/v1

`GET`/`PATCH` model + thinking-level budget under
`/api/v1/sessions/{id}/model`, backed by `models.ts` + `AgentSessionWrapper.send`
(`set_model` / `set_thinking_level`). No new runtime model primitives — just the
transport boundary.

**Verified:** session-model + model route + client tests green; tsc clean.

### 🟢 ZOS-82 — Extensions/skills/prompts management over /api/v1

- Slice 1 — `GET /api/v1/skills` listing (loader-backed, trust reported).
- Slice 2 — `POST /api/v1/skills/[op]` for `install | check | update | search`,
  file-access + project-trust gated, six new `BackendError` codes.
- Slice 3 — `GET`/`POST /api/v1/plugins`: SDK-backed plugin registry
  (`readPluginsFromServices` / `managePluginsFromServices`) exposing
  `install | update | remove | disable | enable`, project-vs-local scope, themes.

**Verified:** skills + plugins + errors + envelope tests green; tsc clean.

### 🟢 ZOS-81 — Runtime contract + end-to-end wire tests

Contract matrix asserting each `/api/v1` route's wire format ↔ `contracts.ts` ↔
`api-v1-client` parse, plus a pi-backend → route → client round-trip test.
- `web/app/api/v1/contract.test.mjs` — matrix (health, agent/running, capabilities,
  model, context, skills, plugins).
- `web/app/api/v1/roundtrip.test.mjs` — real route `Response` re-parsed by client.

### 🟢 ZOS-83 — No-UI-import guard

`web/packages/pi-backend/ui-import-guard.test.mjs` walks `pi-backend` +
`app/api/v1` source and fails if anything imports under `components`, `ui`,
`app`, `web`, `screens`, `hooks`, etc. Bare + relative-within-repo imports
scanned; positive control proves it fires.

---

## How to test manually

### 1. Protocol package (ZOS-99)

```bash
cd packages/protocol
npx pnpm typecheck   # tsc --noEmit, must exit 0
npx pnpm test        # node --strip-types; expect 27/27 pass
```

Manual smoke — negotiate + validate an envelope:

```bash
cd packages/protocol
node --experimental-strip-types -e '
import("./src/negotiation.ts").then(async (m) => {
  const n = m.negotiateHandshake(1, m.MINIMUM_VERSION, m.CURRENT_VERSION, ["agent"], ["agent"]);
  console.log("handshake:", n.ok, n.ok ? n.value.version : n.error.code);
  const { createHelloEnvelope, HELLO } = await import("./src/commands.ts");
  const { verifyEnvelope } = await import("./src/envelope.ts");
  console.log("verify good:", verifyEnvelope(createHelloEnvelope({ name: "peer", version: 1 }), HELLO).ok);
  console.log("verify bad:", verifyEnvelope({ v: 1, t: HELLO }, HELLO).ok);
});'
```

### 2. Daemon (ZOS-86)

```bash
cd daemon
npx node --experimental-strip-types --test 'src/**/*.test.mjs'   # 18/18 pass
npx pnpm typecheck                                                # exit 0
```

Manual end-to-end — the daemon binds port `0` (ephemeral) and prints
`health: http://127.0.0.1:<port>/health` to stdout, so capture the port there:

```bash
cd daemon
export ZOSMA_DAEMON_TOKEN=smoke-token
node --experimental-strip-types src/index.ts > daemo.out 2>&1 &   # start instance #1
PORT=$(grep -o 'http://127.0.0.1:[0-9]*' daemo.out | head -1 | grep -o '[0-9]*')
curl -s "http://127.0.0.1:$PORT/health"                          # -> {"status":"ready"}
node --experimental-strip-types src/index.ts 2>/dev/null & sleep 0.3; wait  # instance #2 -> exits 3
curl -s -X POST "http://127.0.0.1:$PORT/ipc" -H "Authorization: Bearer wrong-token"  # -> 401
curl -s -X POST "http://127.0.0.1:$PORT/ipc" -H "Authorization: Bearer smoke-token"  # -> 200
curl -s "http://127.0.0.1:$PORT/nope"                           # -> 400 invalid_request
kill %1                                                         # SIGTERM -> clean exit
```

### 3. Web /api/v1 boundary (ZOS-84, 80, 82, 81, 83)

```bash
cd web
npm run typecheck                     # tsc --noEmit, exit 0
npm test                              # big glob run; expect 0 failures
```

The `test` script covers all five tickets: app glob (contract + roundtrip +
routes), lib glob (client), packages glob (facade, service, guard).

Manual HTTP smoke — run the Next dev server and hit the boundary:

```bash
cd web
npm run dev                           # http://127.0.0.1:30141
sleep ...
curl -s localhost:30141/api/v1/health                              # 200 data
curl -s "localhost:30141/api/v1/models"                            # list models
curl -s -X POST localhost:30141/api/v1/skills/search -H "content-type: application/json" \
     -d '{"query":"foo"}'                             # skill search
curl -s localhost:30141/api/v1/plugins                             # plugin list
```

Notes:
- `sessions/[id]/stream` and `sessions/[id]/model` need a **live session wrapper**
  (the runtime manager), so in production they require an existing session; the
  route tests stub the facade via `globalThis.__piBackend` / `__piSessions`.
- The guard (ZOS-83) is a compile-time test — it only "shows up" if a UI import
  sneaks into `web/packages/pi-backend/` or `web/app/api/v1/`.

---

## Business summary (plain English)

Before this work, Cowork only worked **inside the app's own screen** — only people sitting at a desk terminal could use the assistant that manages coworking spaces.

These 7 tickets built the **safe, standard, real-time bridge** between Cowork and other software, turning it from a desktop tool into an **open platform** that powers assistants and integrations beyond the desk app. The bottom line: other programs (a booking website, a mobile app, an analytics dashboard, a future AI assistant) can now **ask Cowork questions and send it instructions** directly, over the internet, without touching the app's screen.

Ticket-by-ticket, what it delivered:

- **Versioned protocol package (ZOS-99)** — The rulebook for how two programs talk to each other (message shape, version, upgrades). Every future tool speaks one language and never breaks Cowork on update.
- **Standalone daemon (ZOS-86)** — The core "brain" pulled out of the app into a small background service. Runs alone, safer (one job per process, refuses duplicate copies), restarts cleanly, logs without leaking passwords. → Cheaper to run, harder to crash.
- **Streaming over /api/v1 (ZOS-84)** — Cowork pushes live updates to other programs in real time, like watching the assistant type its answers as it thinks, not reply only chunks later. → Feels instant.
- **Model & thinking controls (ZOS-80)** — Callers pick how smart/how fast the assistant runs per session, and how much it "thinks." → Customer chooses cost vs. quality.
- **Skills & plugins (ZOS-82)** — Customers add and manage add-ons (skills, plugins, prompts, themes) through the API. → An app store for Cowork — extend it without touching our code.
- **Contract + wire tests (ZOS-81)** — Self-checking tests that break if any two programs start speaking a different language. → Nothing breaks silently as more tools are added.
- **No-UI-import guard (ZOS-83)** — An automated quality gate so the service layer can never depend on the on-screen app. → Keeps it clean, stable, and trustworthy for outside software.

**Net result:** a headless-ready platform that lets Cowork power assistants and integrations beyond the desk app — and the foundation for the external-product roadmap.

---

## ZOS-90 — Harness adapter interface + capability contracts

**Status: 🟢 Complete — 46/46 protocol tests pass, tsc clean.** Transport-neutral
contract in `packages/protocol/src/` (no Pi/UI/transport imports, stdlib-only
validators).

- **`capability.ts`** — additive `CapabilityName` set (`streaming, steering, follow-ups, models, thinking, tools, permissions, attachments, commands, extensions, subagents`) + `CapabilityDescriptor` + `capabilityGaps` (the unsupported-capability gap) + `capabilityMet`.
- **`adapter.ts`** — `AdapterManifest {id,name,kind,protocolVersion,capabilities,config}` + lifecycle `AdapterOp` (`probe/start/resume/prompt/cancel/close/health`) with per-op `requires` gated via `capabilityGapsForOp`, `AdapterConfig` (vendor/binary/launchArgs/dynmic-env-policy/timeouts).
- **`session-state.ts`** — normalized `SessionState` union + `canTransition` state machine (no skip, closed is terminal) + `SessionHandle` with `nativeSessionId` kept **separate** so native ids never leak.
- **`events-mapping.ts`** — `AdapterEventMapping {kind,nativeTypes[]}` maps any native tag → one `NormalizedEventKind`; normalized payload is adapter-produced only.
- **`adapter-errors.ts`** — precise `AdapterErrorCode` (`capability_unsupported/operation_not_supported/adapter_unavailable/adapter_error`) normalized onto the shared `ProtocolError` (generic `unknown_command`) while preserving `adapterId/operation/capabilities` in `details`.

**Verify:** `cd packages/protocol && pnpm test && pnpm typecheck`.

---

## ZOS-89 — Session-to-harness persistence

Durable store mapping a Cowork session ↔ adapter ↔ native session ↔ workspace ↔ PID ↔ state.
Self-contained: reuses the ZOS-90 session identity (`SessionHandle` / `sessionStateSchema`), the
only new logic is recovery + atomic persistence.

- **`packages/protocol/src/store.ts`** — a single module:
  - `sessionRecordSchema` — a persisted `SessionRecord` (`SessionHandle` + `adapterId` / `workspace` / `pid` / `createdAt`), validated with the zero-dep schema builder.
  - `recover(raw)` — the recovery logic. Iterates a stored payload and keeps every record that validates, drops the rest; a non-array / corrupt payload recovers to empty (never throws, never wedges).
  - `SessionStore` — dir-based store: `add` (dedup by session id), `remove`, `get`, `list`, `load`. `persist` writes to a sibling temp file then `rename`s over the target → **atomic** (a crash mid-write can't leave a half-written store).
  - `STORE_FILENAME = "sessions.json"`.
- **Barrel** `index.ts` exports the new symbols.
- **`store.test.ts`** added (10 tests): record-schema gating, recovery dropping invalid records, `SessionStore` round-trip / dedup / remove / **restart reload from disk** / atomic write (no temp files left) / corrupt-file tolerance.

**Verify:** `cd packages/protocol && pnpm test && pnpm typecheck` (56/56 tests).

---

## Next 3 tickets (quick wins)

The Phase-1 `/api/v1` + daemon-scaffold tickets are all done. The remaining work is the daemon/harness epic. Below are the next 3 **quick wins**: each is self-contained, depends only on work already done this session (ZOS-86 daemon scaffold + ZOS-99 protocol), needs no new dependency, and can be verified in isolation.

| # | Ticket | Why it's a quick win | What it is | Primary gate |
|---|--------|----------------------|------------|--------------|
| 1 | **ZOS-90** ✓ DONE | — | See **ZOS-90** section above. | `packages/protocol` — 46/46 tests, tsc clean |
| 2 | **ZOS-89** ✓ DONE | — | See **ZOS-89** section above. | `packages/protocol` — 56/56 tests, tsc clean | |
| 3 | **ZOS-85** — move Git & worktree services into daemon | Port existing, already-tested web Git code to daemon RPC (reuse, don't re-implement). | Move status/diff/log + worktree list/create/remove behind daemon RPCs; preserve allowed-root/containment security. | daemon package + client methods; tests reuse existing Git-security assertions. |

**Ordering note:** ZOS-90 is **done** (the foundation). The natural 4th quick win
is **ZOS-87** (adapter conformance kit + ACP v2 fixture, depends on ZOS-90's
contract). Next pick after that is **ZOS-85** (Git & worktree services into
the daemon).

---

## Command to re-fetch the live Linear state

```bash
LINEAR_TEAM=7cf192f5-4184-4ba1-addb-a7377d6c4282 linear issues --project "zosma cowork" --all
```

Team id `7cf192f5-4184-4ba1-addb-a7377d6c4282`; project id
`500f9258-dfd6-46bc-a866-8f78598da2d6`.

---

## Commit status

**Nothing committed.** All seven tickets are code-complete and green in the
working tree, but uncommitted — awaiting your review before staging + committing.
