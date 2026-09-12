# Zosma Cowork — How It Works (Technical Overview)

> Top-down tour of the three moving parts — **web**, **daemon**, **control plane** — and what actually happens from the moment you type a message until tokens render in the chat.

## 1. The cast

| Piece | What it is | Where | Role |
|---|---|---|---|
| **Web** (`apps/web`) | Next.js app (React + TypeScript) | Browser renders it; server routes run in Node on the same machine | The face. Chat UI, session list, model picker, file/git views |
| **Daemon** (`apps/daemon`) | Standalone Hono HTTP server, owns the Pi SDK runtime | `127.0.0.1` loopback only (plus an optional outbound WS to the control plane) | The brain. One live Pi session runtime per machine — files, git, tool calls, model I/O happen here |
| **Control plane** (`apps/control-plane`) | Small Node server (WS + REST, command store) | A separate host (company backend in fleet mode) | The switchboard. Connects operator clients to employee daemons that are behind NAT/firewalls |
| **Protocol** (`packages/protocol`) | Shared schemas + frame validators | npm-workspace package | One wire contract for RPC envelopes, normalized events, and control-plane frames |

Two conversations exist, and keeping them straight is the whole mental model:

1. **Local conversation** — browser ↔ web server routes ↔ daemon over loopback (`/ipc`). This is how a chat turn happens today.
2. **Fleet conversation** — control plane ↔ daemon over an *outbound* WebSocket. This is how a remote operator reaches a machine that has no inbound port.

---

## 2. Why the daemon exists at all

The web app used to run the Pi runtime in-process. That is gone: the daemon now owns every live session.

Reasons, briefly:

- **One runtime per machine, not per tab/app.** Sessions survive the web app restarting; the desktop shell and the browser both point at the same daemon.
- **Credentials and execution stay local.** Model API keys, the Pi adapter, file access, and git live behind a `127.0.0.1`-bound Bearer-token gate. Nothing externally reachable.
- **A single supervision point.** The daemon supervises the Pi runtime, tears down sessions on shutdown, and publishes normalized events for any client to subscribe to.

The daemon's HTTP surface (`apps/daemon/src/server.ts`):

- `GET /health` → readiness (`starting` / `ready` / `shutting-down`)
- `POST /ipc` → JSON-RPC-ish dispatch of `git:*`, `files:*`, `read:*`, `auth:*`, `pi:*` ops
- `POST /ipc/stream` → SSE stream of normalized Pi events

Every request must present the shared daemon token (`ZOSMA_DAEMON_TOKEN`, persisted per-machine otherwise). Requests into the daemon are **never** browser-direct: the browser cannot reach loopback-with-token (no CORS), so web *server* routes relay.

---

## 3. Control plane — what it does

The control plane (`apps/control-plane/src/server.ts`) exists for the **fleet** case: you want to operate AI coworkers on many employee machines from one place, and those machines are behind NAT/firewalls.

The trick: **nothing inbound**. The daemon *dials out* (`apps/daemon/src/outbound/connector.ts`) to the control plane over WebSocket. Firewall/NAT friendly by construction.

What the control plane provides:

- **Registry** — each daemon connects and sends a `hello` frame (`machineId`, `version`, `watermark`); the plane tracks connected machines and their state.
- **Command push** — an operator (web/mobile client elsewhere) injects a command via REST `POST /machines/{id}/commands`; the plane appends it to a durable per-machine log and pushes it immediately over the machine's open socket as `rpc.request` with a server-generated correlation id.
- **Replay with watermark** — if the machine is offline or reconnects, the plane replays only commands above the machine's last known `watermark` (its highest handled seq). Commands are idempotent because the machine **acks** each one (`control.ack`); acked commands are never replayed. So a dropped connection can't double-execute side effects.
- **Machine-initiated RPCs** — the machine can also call *up*: `rpc.request` to the plane, answered on the same correlation id by the plane's `handleRpc`.
- **Heartbeats** — ping/pong frames; a missed pong tears the connection and the daemon reconnects with jittered exponential backoff, carrying its watermark.

Durability is lazy by design (`apps/control-plane/src/store.ts`): one JSONL file per machine, seq starting at 1, acks in a sibling file, everything replayed into memory on plane restart. Volume is low (fleet command push) — no SQLite until queries need it.

> Status: the control-plane server and the daemon's outbound connector exist as the ZOS-96 building block, but the connector is **not yet wired into the daemon's startup path** (`orchestrator.ts` / `index.ts` don't instantiate it). Today's shipped chat flow is purely local (next section). Plan: daemons connect out, and the hosted/self-hosted web client talks to the control plane instead of a loopback daemon.

---

## 4. The local chat flow — first text to rendered reply

This is the live path today. Numbers match the diagram below.

```mermaid
sequenceDiagram
    participant U as User
    participant B as Browser (React chat UI)
    participant W as Web server route (Next.js)
    participant D as Daemon (127.0.0.1)
    participant P as Pi SDK runtime (in daemon)

    U->>B: type "…" + Enter
    B->>W: POST /api/agent/new {cwd, type:"prompt", message}
    W->>D: pi:start (root-gated cwd) ; pi:prompt (first message)
    D->>P: start session → run turn
    Note over P: tools, files, git, model calls — executed on machine
    P-->>D: normalized events (tokens/tool runs/terminal)
    B->>W: GET /api/agent/[id]/events (SSE, opened while turn runs)
    W->>D: pi:stream watch → /ipc/stream (SSE)
    D-->>W: event frames
    W-->>B: bridged SSE → chat renders tokens live
```

**Step by step:**

1. **User types.** Browser UI issues `POST /api/agent/new` with the working directory (`cwd`), the message, and the model scope (`apps/web/app/api/agent/new/route.ts`).

2. **Web grants the root.** The web app trusts the workspace first: `allowFileRoot(cwd)` (web-side file gate) and `piAllowRoot(cwd)` (daemon-side allowed-roots) run **before** the session starts — the daemon's `pi:start` file gate rejects any cwd outside an allowed root, so grant-before-start matters after a daemon restart.

3. **Daemon starts the session.** `piStart` relays `pi:start` to the daemon over `POST /ipc` (`apps/web/lib/daemon-client.ts` → `daemonIpc`). The daemon's Pi RPC dispatch (`apps/daemon/src/pi/rpc.ts`) gates the cwd, then `PiAdapter.start` creates a real Pi SDK session. The web gets back the session id (a temporary key is replaced by the real one).

4. **First prompt.** The same request sends `pi:prompt` with the message. Back inside the daemon, `adapter.prompt` runs the whole turn — Pi decides on tools, touches files/git on the local machine, calls the model. From here on, **everything expensive happens in the daemon process**.

5. **Streaming back.** While the turn runs, the browser opens `GET /api/agent/[id]/events` (`route.ts`). The web route checks whether the session is live (`pi:list`); if not but the session file exists on disk, it asks the daemon to **resume** it (`pi:resume` with the persisted session file) — same wake-up semantics as the old in-process runtime. Then it opens `POST /ipc/stream` on the daemon (`pi:stream`, watch mode).

6. **Event bridge.** The daemon streams normalized Pi events over SSE; `lib/daemon-agent-stream.ts` re-frames them into the browser's agent-event wire contract; the chat renders tokens/tool progress live.

7. **Subsequent messages.** No start needed — `POST /api/agent/[id]` (`route.ts`) maps `prompt` → `pi:prompt`, everything else (set model, fork, bash, get state…) → `pi:command`. If the daemon forgot the session (restart), the route hands the persisted session file to `pi:resume` and retries.

8. **Persistence.** Pi writes session files to its agent dir on disk; the web reads that index for the sidebar (session list and messages) without needing a live runtime.

### Why the daemon "comes into the picture"

The web app deliberately knows nothing about running agents. Every interaction that could touch a model, execute a tool, or read a machine path is a relayed call: browser → web route → `daemonIpc` → daemon → Pi adapter. The web keeps only what is safe and static: session-file index reads, model/skill/plugin discovery, and the SSE bridge. Failing the daemon is loud — routes reply `503 daemon_unreachable`/`daemon_not_configured` so a misconfigured machine is visible, never silent.

---

## 5. Control plane in the chat flow (fleet mode)

Same user experience, different plumbing. The operator's client (web app on *their* machine, or mobile) is a **control-plane client**, not a local-daemon client:

```mermaid
sequenceDiagram
    participant O as Operator (web/mobile, anywhere)
    participant CP as Control plane
    participant D as Employee daemon (NAT'd machine)
    participant P as Pi runtime

    D->>CP: WS connect + hello (machineId, watermark)
    CP-->>CP: register machine; durable log per machine
    O->>CP: POST /machines/{id}/commands {method, params}
    CP->>CP: append cmd (seq+1) → push rpc.request now
    CP->>D: rpc.request (correlationId, method, params)
    D->>P: execute command (session turn)
    P-->>D: events → ack(correlationId)
    D->>CP: control.ack (replay never re-sends)
    D-->>CP: rpc.response (correlationId, ok/data/error)
```

Role of the control plane in that flow, explicitly:

- **Addressability** — it is the stable rendezvous point machines dial into; the operator never needs the machine's IP.
- **Delivery guarantee** — commands are logged before delivery and replayed on reconnect above the watermark; acks make the whole thing idempotent.
- **Routing** — it routes both directions: operator→machine command push *and* machine→operator RPC responses (and machine-initiated RPCs via `handleRpc`).
- **Supervision view** — `/machines` lists registered machines and their connected/watermark state.

Where local chat and fleet chat differ: in fleet mode the *turn doesn't belong to a single browser tab* — the session lives in the employee daemon's Pi runtime, and event/ack traffic passes through the plane. But the local principle holds: **execution stays on the machine, control is centralized.**

---

## 6. One-paragraph mental model

- **Web** renders and relays; it never executes.
- **Daemon** is the local brain that owns the Pi runtime; private, loopback-bound.
- **Control plane** makes daemons reachable and manageable from anywhere via outbound sockets, with a durable, at-least-once command channel.
- A message goes: **browser → web route → daemon `/ipc` → Pi SDK → (tools/model on machine) → normalized events → SSE back through web → browser renders.**
- The control plane is the same story scaled to a fleet: commands flow **operator → plane → daemon socket → Pi → ack**, with replay making dropped connections harmless.