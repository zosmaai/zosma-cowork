# Plan — ZOS-91: Machine identity registration + capability manifest

**Ticket:** `ZOS-91` — *Implement machine identity registration and capability manifest* (p2, Sprint 1, project **Zosma Cowork**)
**Goal:** each daemon has a durable, safe machine identity and advertises what it can do; the control plane keeps a durable registry of that identity + manifest, and can revoke it. Wired end to end through the real paths — daemon → `hello` → plane registry → REST → revoke → refusal → reset.

**Decision (locked by user):** account switching = **(a) the machine is the box, not the login.**

---

## Status: ✅ EXECUTED (all phases)

| Gate | Result |
|---|---|
| `pnpm -r test` | ✅ protocol 96 · control-plane 25 · daemon 248 (246 pass, 2 skipped — macOS `/proc`) · web 809 |
| `pnpm typecheck` | ✅ all packages |
| `pnpm lint` | ✅ 0 errors (16 pre-existing web warnings) |
| `pnpm daemon:build` | ✅ |
| `docker compose --profile fleet build` + `up` | ✅ |

Acceptance script run against the real fleet (Docker, `dev-mac-1`), all verified live:

| Check | Result |
|---|---|
| `GET /machines` carries the manifest | ✅ `manifestVersion 1`, `platform linux`, `arch arm64`, adapters `[pi]`, 61 services incl. `pi:prompt` |
| Restart re-registers once, identity stable | ✅ 1 record, `firstSeenAt` unchanged |
| `DELETE /machines/:id` | ✅ registry empties, live socket closes `4003` |
| Revocation is terminal | ✅ actionable log, **0** reconnect attempts, still absent after 6 s |
| Tombstone is durable | ✅ daemon restart still refused |
| `POST /machines/:id/register` | ✅ reconnects with its manifest |
| Command round-trip after re-admit | ✅ `pi:health` → `{ready:true}` |
| Conflicting `ZOSMA_MACHINE_ID` | ✅ boot fails loud with the reset hint; registry unchanged (no takeover) |
| Manifest-less (older) daemon hello | ✅ registers, no manifest required |

New files: `apps/daemon/src/identity.ts`, `manifest.ts` (+tests). Touched: daemon `index.ts`, `outbound/connector.ts`, control-plane `store.ts`, `server.ts`, protocol `control-plane.ts`, `index.ts`, `README.md`, `fleet.md`.

### Follow-up hardening (after live acceptance)

Three defects found by *running* the documented flows rather than trusting them:

| Defect | Fix | Test |
|---|---|---|
| A lost `ack` (socket dying between `rpc.response` and `ack`) made replay re-run an already-answered command | `replay` skips commands that already have a durable reply | `server.test.mjs` "a delivered reply is not re-executed when its ack is lost" |
| Close `4003` is terminal, but the daemon's log implied that re-admitting was enough | Log now names the id, the `register` route, and the required restart | `connector.test.mjs` "the revocation log tells the operator what actually recovers the machine" |
| Half-configured fleet (token/id but empty `ZOSMA_CONTROL_PLANE_URL`) silently ran single-host, invisible in a container | Boot warns `fleet disabled: ZOSMA_CONTROL_PLANE_URL is empty …` | `index.test.mjs` "run() warns instead of silently running single-host …" |

---
A Pi/provider credential change on the same box **never** rotates machine identity. Only an explicit `ZOSMA_MACHINE_ID_RESET=1` (or `identity reset`) creates a new identity. Consequence: the AC *"account/key changes cannot silently claim another user's machine"* is enforced as **no silent identity takeover** — an env id that conflicts with the persisted one fails loud, and a second live connection claiming a registered machine id is refused (not silently allowed to replace the first).

---

## Prior plan (shipped) — keep out of scope

`plan.md` previously described the Docker single-host + fleet deployment work. That work is **done**: Linear Sprint 1 shows 16/21 tickets `Done`, including `ZOS-96` (outbound daemon WebSocket + RPC recovery) and `ZOS-99` (versioned protocol package). Fleet **transport** is verified end to end (register → REST push → reply → offline replay → reconnect). This plan covers only the remaining fleet gap, ZOS-91.

**Open Sprint 1 tickets for context:**

| Ticket | pri | why not this plan |
|---|---|---|
| `ZOS-91` machine identity + capability manifest | p2 | **← this plan** |
| `ZOS-88` harness discovery catalog + process supervisor | p2 | not fleet; new subsystem |
| `ZOS-97` bundle + supervise daemon from Tauri | p2 | packaging, orthogonal |
| `ZOS-92` cross-platform terminal PTY service | p3 | largest, new subsystem |

---

## Current state (audited — file:line evidence)

| Piece | State | Evidence |
|---|---|---|
| Machine id | env `ZOSMA_MACHINE_ID` **silently wins**, else a persisted bare `machine.id` | `apps/daemon/src/index.ts:54` |
| Identity record | none — no `createdAt`, no install provenance, no rotate/reset path | same |
| `hello` payload | `machineId, name, version, watermark` only | `apps/daemon/src/outbound/connector.ts:182-188` |
| `HelloFrame` schema | those four fields, all required | `packages/protocol/src/control-plane.ts:35` |
| Plane registry | **in-memory only**, derived from the live `connections` map | `apps/control-plane/src/server.ts:176-180` |
| Duplicate machine id | second connection **silently replaces** the first in `connections` (only an id change on a *live* connection is rejected — `server.ts:125`) | `apps/control-plane/src/server.ts:131` |
| Revocation | none — `grep -rn revoke apps/control-plane/src` → 0 hits | — |
| Capability notion | exists twice, unrelated to fleet: `PiAdapter.manifest.capabilities` (`pi/adapter.ts:86`) and `read:capabilities` (`read/rpc.ts:126`, `apiVersion: "v1"` precedent for a versioned additive manifest) | — |
| Machine-initiated RPC | plane option `handleRpc` **never passed** by `runControlPlane` → every machine-initiated request answers `method_not_found` | `control-plane/src/index.ts:35` |
| Identity tests | one: "env wins, else persists" | `daemon/src/index.test.mjs:122-127` |

### Acceptance criteria → gap

| ZOS-91 AC | Today | Phase |
|---|---|---|
| Same user/machine re-registers with the same identity | ✅ works | P1 (keep, migrate to `machine.json`) |
| Account/key changes cannot silently claim another user's machine | ❌ env id silently overwrites; duplicate connection silently hijacks | P1 + P3 |
| Registration is idempotent **and revocable** | half — idempotent ✅, revocation ❌ | P3 |
| Capability manifest is versioned and additive | ❌ no manifest at all | P2 |
| Tests cover fresh install, restart, migration, identity reset | ❌ only 1 test | P1 |

---

## Architecture

### Identity (daemon-local, durable)

```
<dataDir>/machine.json          # new durable record (0o600)
├── version: 1                  # record schema version (additive later)
├── machineId: "machine-xxxxxxxx" | env value
├── createdAt: <iso>
├── installId: <uuid>           # this install instance; survives restarts
└── name: <hostname or ZOSMA_MACHINE_NAME>

<dataDir>/machine.id            # legacy file — read once, migrated, kept on disk
```

Resolution rules (in order):

1. Load `machine.json`. Legacy `machine.id` present and no `machine.json` → **migrate: same id**, write `machine.json` (never rotate on upgrade — existing fleet records must survive).
2. `ZOSMA_MACHINE_ID_RESET=1` → rotate: new `machineId`, new `installId`, `createdAt` now.
3. `env.ZOSMA_MACHINE_ID` set and differs from the persisted id → **throw** with an actionable message (`set ZOSMA_MACHINE_ID_RESET=1 to rotate intentionally`) — this is the "no silent claim" fence.
4. `env.ZOSMA_MACHINE_ID` set and persisted id absent → adopt + persist.
5. Nothing anywhere → generate `machine-${randomUUID().slice(0,8)}`.

Hardware anchoring: **not done.** Privacy + cross-platform cost outweigh the benefit; `machine.json` in the data volume is the stable anchor, and `installId` distinguishes re-installs. Marked as a deliberate ceiling in code.

### Capability manifest (additive `hello` field)

```jsonc
{
  "type": "cowork.v1.control.hello",
  "machineId": "machine-1a2b3c4d",
  "name": "shanvit-mbp",
  "version": 1,                 // control-channel protocol version (unchanged)
  "watermark": 42,
  "manifest": {                 // NEW — optional so an old daemon still registers
    "manifestVersion": 1,       // bump only for breaking changes; add fields otherwise
    "platform": "darwin",       // process.platform
    "arch": "arm64",            // process.arch
    "hostname": "shanvit-mbp",
    "daemonVersion": "0.1.0",
    "node": "22.19.0",
    "adapters": [               // from PiAdapter.manifest (pi/adapter.ts)
      { "id": "pi", "name": "Pi coding agent", "protocolVersion": 1,
        "capabilities": [{"name":"streaming","version":1}, ...] }
    ],
    "services": ["read:capabilities", "pi:prompt", "files:read", ...]
  }
}
```

Rules: `manifest` optional and every field inside optional at the validator level → **additive, never breaking**. Unknown keys are already ignored by `object()`, which iterates only the spec's own keys (`packages/protocol/src/schema.ts:90-104`). The plane stores the manifest opaquely (no per-field re-validation) so a newer daemon adds fields without a plane change.

`services` is a static exported array in one file — not reflected off the RPC tables (one array beats runtime discovery).

### Registration / revocation lifecycle

```
daemon                               plane
  │ hello(manifest) ────────────────▶ register(machineId, manifest)
  │                                   ├─ revoked?  → close 4003, no registry entry
  │                                   ├─ id live on another conn? → close 4004
  │                                   └─ else upsert registry {firstSeenAt, lastSeenAt, manifest}
  │ ◀──── replay(pending above watermark)
  │
  │  operator: DELETE /machines/:id ▶ revoke(machineId): tombstone + close 4003 + drop
  │  connector sees 4003 → TERMINAL: stop reconnecting, log actionable error, status.revoked=true
  │
  │  operator: POST /machines/:id/register ▶ clearRevocation(machineId) → next hello accepted
  │  OR machine: ZOSMA_MACHINE_ID_RESET=1 → new machineId → registers as a fresh record
```

`4003`/`4004` live in the protocol package so both ends agree; numeric close codes, exported as `CLOSE_MACHINE_REVOKED` / `CLOSE_DUPLICATE_MACHINE`.

Revocation must stop the reconnect loop, not feed it — a revoked daemon that reconnects every 250 ms–30 s forever is a hot loop and a log flood.

---

## Phases (TDD: write the failing test, watch it fail, then implement)

Every phase is one test file's worth of red→green. Test runner: `node --experimental-strip-types --test` via `pnpm -C <app> test`.

### P1 — daemon identity service

New `apps/daemon/src/identity.ts`:

```ts
export interface MachineIdentity { version: 1; machineId: string; createdAt: string; installId: string; name: string }
export function loadMachineIdentity(dataDir: string, env?: NodeJS.ProcessEnv): MachineIdentity;
```

`index.ts` `resolveMachineId` becomes a thin wrapper over `loadMachineIdentity(...).machineId` (keep the export — it is imported by tests).

**Red tests — `apps/daemon/src/identity.test.mjs`:**
1. fresh install → creates `machine.json`, id matches `/^machine-[0-9a-f]{8}$/`, file mode `0o600`
2. restart → same `machineId`, same `installId`, same `createdAt`
3. migration → pre-existing `machine.id` yields the **same** id and creates `machine.json` (upgrade never rotates)
4. env adopt → `ZOSMA_MACHINE_ID=alpha` with no record persists `alpha`
5. env conflict → persisted `machine-…`, env `alpha` → **throws**, message mentions reset
6. env conflict + `ZOSMA_MACHINE_ID_RESET=1` → rotates to `alpha`, new `installId`
7. reset alone → new id ≠ old id, `installId` differs, record version stays `1`

**Green:** add `identity.ts`; keep `resolveMachineId` signature so `index.test.mjs:122` still passes.

**AC closed:** same user/machine re-registers with same identity; tests for fresh install / restart / migration / identity reset.

### P2 — capability manifest

New `apps/daemon/src/manifest.ts`:

```ts
export const DAEMON_SERVICES: readonly string[] = [ /* the rpc method surface */ ];
export interface CapabilityManifest { manifestVersion: 1; platform: string; arch: string; hostname: string; daemonVersion: string; node: string; adapters: AdapterDescriptor[]; services: string[] }
export function buildCapabilityManifest(adapters: AdapterManifest[], env?: NodeJS.ProcessEnv): CapabilityManifest;
```

`packages/protocol/src/control-plane.ts`: add the manifest schema, make every field `optional`, attach `manifest: optional(machineManifest)` to `hello`. Export the types.

**Red tests:**
- `apps/daemon/src/manifest.test.mjs` — builds from a fixture `AdapterManifest`; contains platform/arch/hostname; `services` non-empty and includes `pi:prompt` + `read:capabilities`; `manifestVersion === 1`; adapters mirror the Pi capabilities (`streaming`, `steering`, …)
- `packages/protocol/src/control-plane.test.ts` — **additivity**: a `hello` **without** `manifest` still validates ✅; a `hello` with `manifest` + an unknown extra field (`"futureField": 1`) still validates ✅; a `hello` whose `manifest.adapters[0].capabilities[0].name` is not a string fails ❌
- `apps/daemon/src/outbound/connector.test.mjs` — the connector's first frame is `hello` **and** carries `manifest.manifestVersion === 1` when `manifest` is passed in options

**Green:** `manifest.ts`; protocol delta; `OutboundOptions.manifest` → sent in the `hello` at `connector.ts:183`; `index.ts` passes `buildCapabilityManifest([pi.manifest])`.

**AC closed:** capability manifest is versioned and additive.

### P3 — plane registry, duplicate guard, revocation

`apps/control-plane/src/store.ts` — add a registry beside the command log (same append-only-JSONL discipline: `machines.jsonl` + `revoked.txt`):

```ts
export interface MachineRecord { machineId: string; name: string; firstSeenAt: string; lastSeenAt: string; manifest?: CapabilityManifest }
// on CommandStore:
register(machineId: string, name: string, manifest?: CapabilityManifest): Promise<MachineRecord>;  // idempotent upsert
registry(): Promise<MachineRecord[]>;
revoke(machineId: string): Promise<void>;        // durable tombstone
isRevoked(machineId: string): boolean;
clearRevocation(machineId: string): Promise<void>;
```

`apps/control-plane/src/server.ts`:
- `hello` → `if (store.isRevoked(id)) close(4003)`; `else if (connections.has(id) && connections.get(id) !== c) close(4004)`; else `store.register(...)` + `connections.set(...)`
- `machines()` merges the durable registry with live connection state → `{ machineId, connected, watermark, name, manifest, firstSeenAt, lastSeenAt, revoked }`
- routes: `GET /machines` (now manifest-bearing), `DELETE /machines/:id` (revoke + close live + 404 when unknown), `POST /machines/:id/register` (clear revocation)

**Red tests:**
- `apps/control-plane/src/store.test.mjs` — register is idempotent (one record, `firstSeenAt` preserved, `lastSeenAt` advanced, manifest updated); `registry()` survives a store reopen (durable); revoke → `isRevoked` true and persisted; `clearRevocation` → false
- `apps/control-plane/src/server.test.mjs` — revoked machine's `hello` gets close code **4003** and never appears in `GET /machines`; a second connection with a live machine id gets close code **4004** and the original stays registered/connected; `DELETE /machines/:id` drops the live socket and 404s on unknown; `POST /machines/:id/register` makes the next `hello` succeed; `GET /machines` returns the manifest the daemon sent
- `packages/protocol/src/control-plane.test.ts` — `CLOSE_MACHINE_REVOKED === 4003`, `CLOSE_DUPLICATE_MACHINE === 4004` (both ends read the same constant)

**Green:** store + server + routes.

**AC closed:** registration idempotent and revocable; account/key changes cannot silently claim another user's machine (no silent env takeover in P1 + no silent live-id hijack in P3).

### P4 — connector terminal revocation

`connector.ts`: read the close code; on `4003` set `revoked = true`, log an actionable error (`machine revoked by control plane — run with ZOSMA_MACHINE_ID_RESET=1 to register a new identity`), and **do not schedule a reconnect**. `status()` gains `revoked`.

**Red tests — `apps/daemon/src/outbound/connector.test.mjs`:**
- server closes with `4003` → `status().revoked === true`, `attempts` stays `0`, no reconnect after > backoff window
- server closes with a normal code (`1006`) → still reconnects (existing behaviour not regressed)

**Green:** close-code dispatch in the `ws.on("close")` handler (`connector.ts:201`).

### P5 — end-to-end wire test (the point of the ticket)

`apps/daemon/src/index.test.mjs` — extend the existing fleet test (it already boots a real `createControlPlaneServer` + real daemon over a real WS with `ZOSMA_MACHINE_ID=m-fleet-1`). Add:

1. **manifest reaches the plane** — after registration, `GET /machines` shows `m-fleet-1` with `manifest.manifestVersion === 1` and a non-empty `services`
2. **idempotent re-register** — restart the connector → still exactly one record for `m-fleet-1`, `firstSeenAt` unchanged
3. **revoke is end to end** — `DELETE /machines/m-fleet-1` → machine disappears from `GET /machines`, connector ends `revoked === true`
4. **revoked identity is refused** — a fresh connector with the same id cannot register (close 4003)
5. **reset recovers** — `ZOSMA_MACHINE_ID_RESET=1` + `ZOSMA_MACHINE_ID=m-fleet-2` registers cleanly
6. **duplicate is refused** — two connectors, same id: one connected, the other closed `4004`

**AC closed:** every AC now has a test on the real wire, not a mock.

---

## Files

| File | Change |
|---|---|
| `apps/daemon/src/identity.ts` | **new** — durable identity + migrate/adopt/conflict/rotate |
| `apps/daemon/src/identity.test.mjs` | **new** — 7 tests (P1) |
| `apps/daemon/src/manifest.ts` | **new** — manifest builder + `DAEMON_SERVICES` |
| `apps/daemon/src/manifest.test.mjs` | **new** (P2) |
| `apps/daemon/src/index.ts` | use `loadMachineIdentity`; pass `manifest` to the connector; log `manifestVersion` |
| `apps/daemon/src/outbound/connector.ts` | send `manifest` in `hello`; terminal state on close `4003` |
| `apps/daemon/src/outbound/connector.test.mjs` | manifest-in-hello; revoked close; reconnect regression |
| `apps/daemon/src/index.test.mjs` | 6 E2E assertions (P5) |
| `packages/protocol/src/control-plane.ts` | `machineManifest` schema; optional `hello.manifest`; close-code constants |
| `packages/protocol/src/control-plane.test.ts` | additivity + close codes |
| `apps/control-plane/src/store.ts` | durable registry + revocation |
| `apps/control-plane/src/store.test.mjs` | registry/revocation durability |
| `apps/control-plane/src/server.ts` | manifest on hello, duplicate guard, 4003 refusal, 3 routes |
| `apps/control-plane/src/server.test.mjs` | revocation/duplicate/manifest REST |
| `README.md` | env table: `ZOSMA_MACHINE_ID_RESET`; identity-conflict semantics; revoke/re-register curl |
| `fleet.md` | wire-protocol table (`hello` gains `manifest`) + REST route table (`DELETE`/re-register) + Limits list — drop the now-closed limits, add the revocation and identity-reset contract | **done**, plus a `## Machine identity (ZOS-91)` section |

**Not touched:** `apps/web/**` (no fleet UI in scope — see below), `apps/desktop/**`, Dockerfiles, `docker-compose.yml` (no new services or env required).

---

## End-to-end acceptance (manual, real processes)

```bash
docker compose --profile fleet up -d --build
TOKEN=$(grep '^ZOSMA_CONTROL_PLANE_TOKEN=' .env | cut -d= -f2)
PLANE=http://127.0.0.1:64714

# 1. registry carries the manifest
curl -s -H "Authorization: Bearer $TOKEN" $PLANE/machines | jq '.machines[0] | {machineId, connected, manifestVersion: .manifest.manifestVersion, services: (.manifest.services|length)}'

# 2. idempotent re-register — firstSeenAt must not move
docker compose restart daemon && sleep 3
curl -s -H "Authorization: Bearer $TOKEN" $PLANE/machines | jq '.machines | length'   # 1

# 3. revoke end to end
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" $PLANE/machines/$MACHINE_ID | jq
docker compose logs daemon | grep -i 'machine revoked'                                 # actionable log, no reconnect storm

# 4. refused while revoked
curl -s -H "Authorization: Bearer $TOKEN" $PLANE/machines | jq '.machines'             # []

# 5. operator re-admits, or the machine rotates
curl -s -X POST -H "Authorization: Bearer $TOKEN" $PLANE/machines/$MACHINE_ID/register | jq
curl -s -H "Authorization: Bearer $TOKEN" $PLANE/machines | jq '.machines[0].connected' # true
```

A real command round-trip after step 5 proves the ZOS-96 path still works under the new identity rules (`POST /machines/:id/commands {method:"pi:health"}` → poll the reply route).

## Gates

| Gate | Command |
|---|---|
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Tests | `pnpm -r test` (web · daemon · control-plane) |
| Daemon build | `pnpm daemon:build` |
| Docker | `docker compose build` + the acceptance script above |

## Out of scope (say it, don't half-do it)

- **Fleet UI** — operators use `curl`. The acceptance criteria are wire-level.
- **Machine-initiated RPC** (`handleRpc` is still unwired in `runControlPlane`) — ZOS-91 doesn't need it. Follow-up ticket; until then machine→plane requests answer `method_not_found` by design.
- **Hardware anchoring** — deliberately skipped (privacy + platform cost); `machine.json` + `installId` is the anchor.
- **Harness discovery / process supervision** — that is `ZOS-88`.
- **Tauri daemon bundling** — `ZOS-97`.
- **Exactly-once command delivery** — the channel stays at-least-once (documented in `fleet.md`).

## Risks

| Risk | Mitigation |
|---|---|
| Existing deployed `machine.id` files rotate on upgrade and orphan plane records | P1 test 3 makes migration same-id; that test is the guard |
| A hard throw on env conflict breaks the current compose fleet if the operator changes `ZOSMA_MACHINE_ID` | Error message names `ZOSMA_MACHINE_ID_RESET=1`; README documents it; test 5 asserts the message |
| Plane treats a newer daemon's manifest as invalid | Validators ignore unknown keys (tested); plane stores the manifest opaquely |
| Revoked daemon hot-loops | P4 terminal state + test asserting no reconnect |
| Duplicate-id guard locks out a legitimate restart that races the old socket's close | The guard only rejects when a *different* live connection holds the id and is still `OPEN`; a reconnect after close is unaffected (P5 test 2) |
