# Fleet Mode

Fleet mode is Zosma Cowork running **many daemons across many machines**, driven from **one control plane** — where **no machine ever accepts an inbound connection**.

| Piece | Code |
|---|---|
| Control plane (registry + command store + REST + WS) | `apps/control-plane/src/` |
| Machine side (outbound connector) | `apps/daemon/src/outbound/connector.ts` |
| Machine identity | `apps/daemon/src/identity.ts` |
| Capability manifest | `apps/daemon/src/manifest.ts` |
| Wire format + close codes | `packages/protocol/src/control-plane.ts` |
| Deployment | `docker-compose.yml` (`--profile fleet`), `Dockerfile.control-plane`, `Dockerfile.daemon`, `Dockerfile.web` |

**Status: minimal by design, and Docker is the supported deployment.** Fleet is deliberately kept small: one process, one JSONL store, one shared token, no UI, no database, no operator. The intended population is **machines you control — servers, build boxes, cluster nodes** — not employee laptops. Kubernetes is the eventual host for the same daemon, not a rewrite; see [Kubernetes integration (future)](#kubernetes-integration-future). What is intentionally *not* built is listed in [Scope freeze](#scope-freeze-what-not-to-build).

---

## The mental model

Single-host mode is a local loop:

```
browser → web container → daemon (same box)
```

Fleet mode adds a hub that every machine dials **out** to:

```
                    ┌──────────────────────┐
  operator/curl ───►│   control plane      │  :64714  (REST + WS /ws)
                    │   registry + store   │
                    └───┬──────────┬───────┘
        outbound WS     │          │     outbound WS
        (daemon dials)  │          │
                 ┌──────▼───┐  ┌───▼──────┐
                 │ daemon A │  │ daemon B │   ← servers, build boxes,
                 │ pi agent │  │ pi agent │     cluster nodes
                 └──────────┘  └──────────┘
                 no inbound ports on A or B
```

Three consequences fall out of "the daemon dials out":

- **No inbound port, no per-machine ingress, no firewall rule.** A machine only needs outbound reachability to one URL — no NodePort, no per-host DNS, no reverse proxy per box. It works unchanged across network zones and NAT.
- **Identity belongs to the box and outlives credentials** (`machine.json` in the data volume, seeded once from `ZOSMA_MACHINE_ID`). The plane can queue work for a machine that is currently down and keeps its registry record indefinitely.
- **The plane is a command bus, not a remote shell.** A pushed command routes through the same `handlePiRpc` a local UI uses (`apps/daemon/src/index.ts`), so a remote machine executes exactly what its local UI could — no more. The daemon's file-access roots and approval broker still apply.

---

## Quick start (Docker)

### Prerequisites

- Docker Desktop or Docker Engine with Compose v2.
- A Pi credential inside the daemon's Pi home (`pi-home` volume → `/root/.pi`). Without it the daemon runs but agent turns cannot authenticate.
- A trusted workspace directory on the host, mounted into the daemon (and the web container, at the **same path**).

### Step 1 — tokens and `.env`

```bash
cp .env.example .env
```

Minimum to fill in:

```bash
# both profiles
ZOSMA_DAEMON_TOKEN=$(openssl rand -hex 32)    # daemon <-> web
ZOSMA_WORK_DIR=./work                          # host workspace, mounted at /work
ZOSMA_WEB_PORT=3000

# fleet profile only
ZOSMA_CONTROL_PLANE_TOKEN=$(openssl rand -hex 32)          # plane <-> daemons
ZOSMA_CONTROL_PLANE_URL=ws://control-plane:64714/ws        # in-cluster URL
ZOSMA_MACHINE_ID=node-1                                    # adopted on first run, then persisted
ZOSMA_MACHINE_NAME="build-node-1"                          # optional display name
```

The plane **refuses to start without `ZOSMA_CONTROL_PLANE_TOKEN`** (`apps/control-plane/src/index.ts`), so under `restart: unless-stopped` an unset token is a crash loop, not an open plane. The daemon accepts fleet wiring only when **all three** of `ZOSMA_CONTROL_PLANE_URL`, `ZOSMA_CONTROL_PLANE_TOKEN`, and `ZOSMA_MACHINE_ID` are set; otherwise it runs single-host.

### Step 2 — start it

```bash
# single host: web + daemon only
docker compose up --build

# fleet: adds the control plane on :64714
docker compose --profile fleet up --build -d
```

The daemon logs its identity and the plane it dialled:

```
zosma-daemon up  … controlPlane: ws://control-plane:64714/ws  machineId: node-1  manifestVersion: 1
control plane connected  machineId: node-1
```

### Step 3 — verify

```bash
PLANE=http://localhost:64714
TOKEN=$(grep '^ZOSMA_CONTROL_PLANE_TOKEN=' .env | cut -d= -f2)

# registry: identity + advertised capability, durable across restarts
curl -s -H "Authorization: Bearer $TOKEN" $PLANE/machines | jq

# dispatch a command and poll its reply
CID=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"method":"pi:health"}' $PLANE/machines/node-1/commands | jq -r .correlationId)
curl -s -H "Authorization: Bearer $TOKEN" $PLANE/machines/node-1/commands/$CID | jq
# → {"ok":true,"command":{"method":"pi:health",…},"reply":{"ok":true,"data":{"ready":true}}}
```

Expected `$PLANE/machines` entry: `machineId`, `name`, `connected`, `firstSeenAt`, `lastSeenAt`, and a `manifest` (`manifestVersion`, `platform`, `arch`, adapters, a service list containing `pi:prompt`).

### Step 4 — add real machines

On each additional machine, run `Dockerfile.daemon` (or the daemon binary) with:

```bash
ZOSMA_CONTROL_PLANE_URL=wss://plane.example.com/ws   # TLS is mandatory off-localhost
ZOSMA_CONTROL_PLANE_TOKEN=<same shared token>
ZOSMA_MACHINE_ID=node-2                              # adopted on first run, then persisted
ZOSMA_MACHINE_NAME="build-node-2"
ZOSMA_ALLOWED_ROOTS=/work                            # what the UI/commands may open
ZOSMA_DAEMON_HOST=0.0.0.0                            # only if a local web container must reach it
```

Persist two volumes, or the machine loses its identity and its login:

| Container path | Holds |
|---|---|
| `/data` | machine identity (`machine.json`), daemon token, instance lock |
| `/root/.pi` | Pi credentials, sessions, model config |
| `/work` (host workspace) | what the agent operates on |

`ZOSMA_MACHINE_ID` is a **seed, not an override**: a value conflicting with the persisted identity fails startup (see [Machine identity](#machine-identity)), which is deliberate — it stops one machine from silently claiming another's registry record and queued commands.

### Step 5 — operate

```bash
TOKEN=$(grep '^ZOSMA_CONTROL_PLANE_TOKEN=' .env | cut -d= -f2); PLANE=http://localhost:64714

# revoke a machine: tombstone it, drop its socket, daemon stops reconnecting (terminal)
curl -X DELETE $PLANE/machines/node-2 -H "Authorization: Bearer $TOKEN"

# re-admit it, then restart the daemon: revocation is terminal, so a machine that
# received 4003 will NOT dial back on its own. (A machine that was offline during
# the revocation reconnects by itself once re-admitted.)
curl -X POST $PLANE/machines/node-2/register -H "Authorization: Bearer $TOKEN"
docker compose restart daemon        # or restart the remote machine's daemon container

docker compose --profile fleet logs -f control-plane     # follow
docker compose --profile fleet down                      # stop, keep volumes (identity + queue survive)
docker compose --profile fleet down -v                   # stop and WIPE identity, queue, Pi home
```

Back up `/store` (the `cp-store` volume): it holds the pending command queue and reply history. Losing it loses queued work, **not** the machines — they re-register on reconnect.

### If a machine never appears in the registry

1. **Check the wiring inside the daemon container** — this is the usual cause:

   ```bash
   docker compose exec daemon env | grep ZOSMA_CONTROL_PLANE
   ```

   All three of `..._URL`, `..._TOKEN`, `..._MACHINE_ID` must be non-empty. An empty `ZOSMA_CONTROL_PLANE_URL` means the daemon quietly runs **single-host** (compose passes it through as empty). Since ZOS-91 it also logs `fleet disabled: ZOSMA_CONTROL_PLANE_URL is empty …` — if that line is missing, fleet *is* enabled and the problem is elsewhere. A URL with no token fails loudly at boot instead.
2. `docker compose logs control-plane` — refusals are logged there (`revoked machine refused`, `duplicate machine id refused`).
3. `curl -H "Authorization: Bearer $TOKEN" $PLANE/health` — is the plane up?
4. A persisted-id conflict is deliberate and loud: the daemon fails to boot rather than claiming another machine's record. Rotate with `ZOSMA_MACHINE_ID_RESET=1` (then unset it).

---

## Configuration reference

### Daemon

| Variable | Default | Meaning |
|---|---|---|
| `ZOSMA_DAEMON_TOKEN` | generated into `<dataDir>/daemon.token` | Local daemon↔web token. |
| `ZOSMA_DAEMON_PORT` | `7441` | Listen port. |
| `ZOSMA_DAEMON_HOST` | `127.0.0.1` (`0.0.0.0` in the image) | Bind address. Unrelated to fleet traffic, which is outbound. |
| `ZOSMA_DAEMON_DATA_DIR` | `~/.zosma-cowork` (`/data` in the image) | Identity, lock, local state. |
| `ZOSMA_ALLOWED_ROOTS` | *(unset)* | Comma-separated roots the file gate may read/browse. |
| `ZOSMA_WARM_CWD` | *(unset)* | Pre-warm a Pi session for this dir (first-chat latency). |
| `ZOSMA_MACHINE_ID` | *(unset)* | Seed for the identity; adopted on first run, then persisted. Conflict = fatal. |
| `ZOSMA_MACHINE_NAME` | `hostname()` | Display name. |
| `ZOSMA_MACHINE_ID_RESET` | *(unset)* | `1` = rotate the identity (to `ZOSMA_MACHINE_ID` if set, else a fresh id). **Unset it afterwards.** |
| `ZOSMA_CONTROL_PLANE_URL` | *(unset)* | `ws://`/`wss://` plane endpoint. Fleet is enabled only when all three plane vars are set. |
| `ZOSMA_CONTROL_PLANE_TOKEN` | *(unset)* | Fleet bearer token. Read from env only — **no `_FILE` variant** (relevant to Kubernetes, see below). |

### Control plane

| Variable | Default | Meaning |
|---|---|---|
| `ZOSMA_CONTROL_PLANE_TOKEN` | **required** (throws) | Shared Bearer token for WS upgrade + REST. |
| `ZOSMA_CONTROL_PLANE_PORT` | `64714` | Listen port. |
| `ZOSMA_CONTROL_PLANE_HOST` | `127.0.0.1` (`0.0.0.0` in the image) | Bind address. |
| `ZOSMA_CONTROL_PLANE_DATA` | OS temp dir (`/store` in the image) | Command log, acks, replies, `machines.jsonl`, `revoked.txt`. |

---

## Wire protocol

One authenticated WebSocket per machine at `/ws`, Bearer token on the upgrade. Frames are JSON with `type` + payload, validated by schema (`FRAME_VALIDATORS`); an invalid or unknown frame is **ignored, never fatal**.

| Frame | Direction | Meaning |
|---|---|---|
| `cowork.v1.control.hello` | machine → plane | Register/identify: `machineId`, `name`, `version`, `watermark`, and a `manifest` (platform, arch, hostname, daemon/node versions, adapters, services). Sent on every (re)connect. |
| `cowork.v1.control.rpc.request` | plane → machine | A command to execute: `correlationId`, `method`, `params`. |
| `cowork.v1.control.rpc.request` | machine → plane | A machine-initiated request (reserved; see Limits). |
| `cowork.v1.control.rpc.response` | machine → plane | The result: `correlationId`, `ok`, `data` or `error`. |
| `cowork.v1.control.ack` | machine → plane | "Handled — stop replaying this." Clears the command from the pending set. |
| `cowork.v1.control.ping` / `pong` | both | Heartbeat. A missed pong (> 2× interval) tears the socket down and triggers reconnect. |
| `cowork.v1.control.watermark` | machine → plane | Defined, currently unused (watermark rides on `hello`). |

Close codes that matter:

| Code | Meaning |
|---|---|
| `4003` | Machine revoke — **terminal**: the daemon stops reconnecting and logs what an operator must do. Re-admission clears the tombstone but does **not** revive a daemon that already received `4003`; restart it. |
| `4004` | Duplicate machine id — another live connection already holds this id; the new one is refused (the live registration is never hijacked). |

`hello.manifest` is **additive**: every field is optional and unknown keys are ignored, so a daemon without a manifest registers fine (verified against a running plane) and a newer daemon needs no plane change. Only a breaking change moves `manifestVersion`.

`method` is a daemon RPC name: `pi:health`, `pi:start`, `pi:resume`, `pi:prompt`, `pi:command`, `pi:update`, `pi:cancel`, `pi:close`, `pi:list`, `pi:probe`, `pi:dispose`.

---

## Machine identity

Each daemon keeps a durable identity in its data volume (`machine.json`, mode 0600): a stable `machineId`, `createdAt`, `installId` (changes on re-install), and a display `name`.

The rule is **the machine is the box, not the login**: changing Pi/provider credentials never rotates the identity, so a machine keeps its registry record and its queued commands across credential changes.

| Situation | Result |
|---|---|
| Restart | Same `machineId`, same `createdAt` |
| Upgrade from an older daemon (bare `machine.id`) | Migrated to `machine.json` with the **same id** — existing plane records are not orphaned |
| First run with `ZOSMA_MACHINE_ID=alpha`, nothing persisted | `alpha` is adopted and persisted |
| `ZOSMA_MACHINE_ID=alpha` while a different id is persisted | **Boot fails** with an actionable error — a changed env value must never silently claim another machine's record |
| `ZOSMA_MACHINE_ID_RESET=1` | Rotates the identity (to `ZOSMA_MACHINE_ID` if set, else a fresh id). Idempotent when the target is already in place |
| Second daemon connects with a live machine id | Refused with close `4004` |
| Machine revoked by an operator | Refused with close `4003`; the daemon **stops reconnecting** instead of hot-looping. Re-admission alone does not bring it back — the daemon must be restarted. |
| Machine revoked while it was offline, then re-admitted | Reconnects normally on its next start — it never received `4003` |

**Caveat for shared machines.** "The machine is the box" assumes one tenant per box. If several users share a node, box-level identity conflates them and revocation becomes all-or-nothing across those users. On shared cluster nodes, per-tenant identity (e.g. a projected ServiceAccount token) is the right model and this decision should be revisited rather than ported.

---

## Delivery guarantees

The plane keeps a **durable per-machine command log** (`<storeDir>/<machineId>.jsonl`, seq from 1) plus an ack set and a reply journal. Order of operations on the machine side:

```
receive rpc.request
  → run handler
  → send rpc.response      ← result reaches the plane first
  → send ack               ← only now is the command cleared
```

Two safeguards make the ordering safe in both directions: `rpc.response` before `ack` means a drop between them cannot lose the result (a regression test asserts the store sees `["reply", "ack"]`), and replay skipping replied commands means that same drop cannot re-run the handler either.

- **Offline machines queue.** `push` appends to the log and, if the machine is not connected, does nothing else. On the next `hello` the plane replays everything unacked.
- **Reconnect replays only what was missed.** Replay skips already-acked commands, so a flapping connection does not re-run completed work.
- **A lost ack cannot cause a second execution.** The plane replays only commands with **no durable reply**; once `rpc.response` has landed, the command is readable through the command route and is never re-sent, even though it stays unacked. This closes the window that previously re-ran a handler when the socket died between `rpc.response` and `ack`.
- **Residual at-least-once window.** If the connection drops *before* the reply reaches the plane, the command is still unacked and unanswered, so it is replayed and the handler may run twice. Exactly-once is not offered: a crash mid-handler is indistinguishable from a command that never arrived. Keep pushed handlers idempotent.

The store is append-only JSONL + in-memory state — durable across plane restarts, sized for command-push volume, not a database.

---

## Operator surface

There is **no fleet UI**. The web app has zero control-plane awareness — it only ever talks to a local daemon. Operators use the REST API.

| Route | Purpose |
|---|---|
| `POST /machines/:id/commands` | Ingest + push (or queue) a command. |
| `GET /machines/:id/commands/:cid` | Fetch a command and its reply. |
| `POST /machines/:id/commands/:cid/ack` | Ack out-of-band (normally the daemon's own `ack` frame does this). |
| `GET /machines` | Registry snapshot: `machineId`, `connected`, `watermark`, `name`, `manifest`, `firstSeenAt`, `lastSeenAt`. Durable — an offline machine stays listed, including across a plane restart. |
| `DELETE /machines/:id` | Revoke a machine: drop its live socket (close `4003`), remove it from the registry listing, and tombstone the id in `revoked.txt`. Survives a plane restart. |
| `POST /machines/:id/register` | Clear the tombstone so the machine may register again. A daemon that already received `4003` must be restarted; an offline one reconnects by itself. |
| `GET /health` | Unauthenticated liveness. |

All routes except `/health` require `Authorization: Bearer $ZOSMA_CONTROL_PLANE_TOKEN`.

---

## Security model

- **One shared Bearer token** authenticates both the WS upgrade and the REST surface. It is fleet-wide, not per-machine, and there is no per-operator authorization. Anyone holding it can push commands to any registered machine — and a pushed `pi:prompt` runs with that machine's Pi credentials and workspace access.
- **Always TLS off-localhost** (`wss://`, HTTPS for REST). The compose defaults are plaintext on a Docker network and are for local testing only.
- **The plane does not widen the daemon's blast radius.** Pushed commands go through the same RPC gate as local ones, so `ZOSMA_ALLOWED_ROOTS` and the approval broker still apply.
- **Store files are plaintext** on disk beside the plane. Protect the `/store` volume.
- Reconnect uses jittered exponential backoff (250 ms → 30 s cap), so a plane restart does not produce a thundering herd.

---

## When to use it

| Situation | Use fleet? |
|---|---|
| Run the agent on one box, one workspace | ❌ single-host compose |
| Run the agent on 3–20+ machines you control from one place | ✅ |
| Machines must not accept inbound connections (network zones, hardening) | ✅ (that is the point) |
| Need to queue work for a machine that is currently down or redeploying | ✅ queue + replay |
| Need an audit trail of what was dispatched to which machine | ✅ the JSONL log is that trail |
| Need scheduled/placement decisions across machines | ❌ external orchestrator (see below) |
| Need unattended remote code execution as a service | ❌ operator still holds a shared token; there is no per-user authz |
| Need a web dashboard across machines | ❌ not built — REST/curl today |
| Need exactly-once command semantics | ⚠️ at-least-once; make handlers idempotent |

Short version: **fleet replaces "SSH into each box and run it" with a queue and a registry.**

---

## Limits (honest list)

- **No fleet UI.** REST only.
- **Machine-initiated RPC is not wired.** The protocol supports it, but `runControlPlane` passes no `handleRpc`, so an upward request answers `method_not_found`.
- **Watermark is always 0** in the current connector. Correctness rests on the ack set, which is sufficient; a real watermark would only reduce replay scan cost.
- **No multi-plane / failover.** One plane URL per daemon.
- **Re-admission does not un-stop a daemon.** Close `4003` is terminal by design, so `register` only clears the tombstone: a machine that was connected when it was revoked stays down until its daemon is restarted, while a machine that was offline during the revocation reconnects by itself. The daemon's log now says exactly that (re-admit, then restart). Making re-admission alone sufficient would mean deliberately re-dialling a revoked identity — not built.
- **Revocation is a single switch, not a policy.** One shared fleet token means anyone holding it can revoke any machine (and push to any machine). `POST /machines/:id/register` re-admits unconditionally — no per-operator authorization, no revocation audit trail beyond `revoked.txt`, no per-machine key rotation.
- **Capability advertisement has no consumer yet.** The manifest is stored and returned by `GET /machines`; nothing routes or schedules by it. Keep it that way until something actually dispatches on capability.
- **`installId` has no consumer.** It is recorded, not used.
- **`DAEMON_SERVICES` is hand-maintained** (`apps/daemon/src/manifest.ts`) and mirrors the RPC surface by hand, so it can drift from the real handlers.
- **No hardware anchoring.** Identity lives in the data volume, so copying that volume copies the identity; `installId` distinguishes a re-install but does not detect a cloned disk.
- **At-least-once, narrowed.** A command can still be executed twice if the connection drops *before* its reply reaches the plane (a crash mid-handler looks identical to a command that never arrived). A lost ack alone no longer duplicates work — replay skips commands that already have a durable reply.
- **No per-machine command quotas or rate limiting** on the REST surface.
- **Identity is a raw machine id, not a cryptographic key.** Authentication is the shared token; `machineId` is a routing label.

---

## Kubernetes integration (future)

**Nothing here is implemented.** It is recorded so the migration is a re-platform of the *deployment*, not a rewrite of the daemon. Read the earlier assessment conclusion first: the plane's unusual features all exist to solve one problem — **the target has no inbound port**. Cluster nodes are reachable in-cluster, so the moment the fleet lives inside a cluster, a large part of the plane becomes redundant rather than wrong.

### What Kubernetes already provides

| Built here | Kubernetes equivalent | Verdict |
|---|---|---|
| `machines.jsonl` registry | `Node` objects (`kubectl get nodes`) | replace |
| `machine.json` identity, `machineId`, `createdAt` | node name + kubelet identity | replace |
| `installId` | meaningless (image/pod identity) | drop |
| `hello.manifest` (platform/arch/adapters/services) | node labels + allocatable; **service surface = pinned image digest** | drop |
| `revoked.txt` + `4003` + `/register` | delete Node/SA, taint, NetworkPolicy | replace |
| duplicate-id guard `4004` | uniqueness of node/pod names | drop |
| shared fleet bearer token | ServiceAccount + RBAC + TLS bootstrap | replace |
| heartbeat ping/pong | node leases | drop |
| JSONL command log + ack + replay | Job/CRD + watch — **or nothing at all** | replace or delete |
| outbound connector | in-cluster HTTP/WS to a `Service` | replace |
| `Dockerfile.control-plane`, `--profile fleet` | manifests / Helm | drop |

### The decision that decides the architecture

Agent sessions are **node-bound**: workspace checkout, `~/.pi` credentials, a long-lived streaming interactive process, approval prompts.

- **Design A — stateless workers + shared storage** (RWX PVC, object store, or git-backed workspaces). A session can resume anywhere, so k8s reschedules freely and *the entire queue/identity/registry layer goes*, including replay and ack. Dispatch = create a Job.
- **Design B — node-pinned session state on local disk.** Cannot be rescheduled. Kubernetes gives *addressing* (`nodeName` affinity, StatefulSet ordinal) but **not** "hold this intent until the node owning the session is healthy". That gap is the residual custom code: a small dispatcher + a durable intent record, using node conditions instead of a hand-rolled heartbeat.

**Only Design B keeps a queue** — and in that case the existing JSONL log + replay + ack is the one part worth porting rather than deleting.

### Wiring sketch (not applied anywhere)

`/data` and `/root/.pi` become PVCs; the machine id comes from the node name rather than an env seed:

```yaml
kind: DaemonSet            # one daemon per node; StatefulSet if sessions must pin
spec:
  template:
    spec:
      serviceAccountName: zosma-daemon          # identity + RBAC replace the shared token
      containers:
        - name: daemon
          image: <registry>/zosma-daemon:<digest>   # digest pins the capability surface
          env:
            - name: ZOSMA_MACHINE_ID
              valueFrom: { fieldRef: { fieldPath: spec.nodeName } }   # addressing, free
            - name: ZOSMA_MACHINE_NAME
              valueFrom: { fieldRef: { fieldPath: spec.nodeName } }
          volumeMounts:
            - { name: data, mountPath: /data }
            - { name: pi-home, mountPath: /root/.pi }
            - { name: work, mountPath: /work }
```

Two honest gaps to close when this is attempted:

1. **The daemon reads `ZOSMA_CONTROL_PLANE_TOKEN` from the environment only** (no `_FILE` variant). A projected SA token therefore needs either a Secret injected as env, or a small change to read a token file.
2. **Capability currently travels in `hello.manifest`, not in node labels.** Under k8s, advertise platform/arch/hardware via labels and let the image digest carry the service surface — do not port the manifest as a second source of truth.

### Migration order (each step deletes something)

1. Put a `Service` + `NetworkPolicy` in front of the daemon's existing local RPC surface. The daemon already exposes a token-authenticated HTTP RPC endpoint, so no new protocol is required.
2. Replace the shared token with ServiceAccount + RBAC.
3. Replace the identity file with `spec.nodeName` (or the StatefulSet ordinal).
4. Replace the manifest with node labels + image digest.
5. Replace dispatch: `Job` per command (Design A) or a small dispatcher + intent record (Design B).
6. Delete the plane: `identity.ts`, `manifest.ts`, `control-plane/server.ts`, `control-plane/store.ts`, the connector's fleet half, `Dockerfile.control-plane`, the `fleet` compose profile — and their tests.

### What stays in every design

- **The daemon and its RPC surface.** This is the product; it is orthogonal to transport and does not change.
- **The protocol types as a boundary.** They are additive and machine-agnostic today, which is exactly what makes the swap cheap: the same daemon can front the plane or an in-cluster Service.
- **Approval broker + `ZOSMA_ALLOWED_ROOTS`** — policy stays at the machine, not the scheduler.
- **`/data` + `/root/.pi` as durable volumes** (→ PVCs).
- **One cheap thing worth keeping even on k8s:** an append-only record of dispatched commands. Kubernetes garbage-collects Job history by default; the JSONL log has no TTL.

### Also revisit

- **Decision "machine is the box, not the login"** if nodes are shared between users (above).
- **`fleet.md` and `README.md`** currently describe an outbound-only topology motivated by unreachable machines. If the fleet is in-cluster, the motivation changes from *unreachable* to *uniform and credential-free deployment* — the design still holds, the reasoning should be restated.

---

## Scope freeze (what not to build)

Fleet is intentionally minimal. Do not add, without a consumer that exists today:

- a fleet UI, dashboard, or scheduling/placement logic
- capability-based routing on `hello.manifest` (nothing reads it yet)
- per-machine keys, mTLS, or an operator/RBAC layer on the plane (Kubernetes replaces these — see above)
- a database behind the store (JSONL is the intent)
- exactly-once delivery, retries with idempotency keys, or quotas

If a requirement seems to need one of these, first answer the two questions in [Kubernetes integration](#kubernetes-integration-future): *is the target reachable?* and *is session state node-pinned?* The answer usually decides between extending the plane and replacing it.
