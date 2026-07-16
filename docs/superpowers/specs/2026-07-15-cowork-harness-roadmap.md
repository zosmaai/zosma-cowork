# CoWork Harness & Modularity — Roadmap

**Date:** 2026-07-15
**Status:** decomposition agreed; sub-project 1 in design

## Problem

The sidecar ↔ Rust ↔ React communication is event-based (JSONL over
stdin/stdout + Tauri `Channel`/`emit`) but its self-healing is half-built, and
the code that owns the comms is monolithic — hard to port a module into a
sibling CoWork fork. Two intertwined goals:

1. **No abrupt stops** — a self-correcting harness (little-coder-style tight
   loop) that detects mid-stream death/stall and recovers instead of leaving a
   stuck spinner.
2. **Portable modularity** — clean harness-core vs domain-module seams so a
   module (Gmail, Google Workspace, office-docs, a provider) can be lifted into
   another CoWork copy with minimal rewiring.

Doing (1) well forces the boundaries (2) needs, so harness-first.

## Current architecture (as-found)

```
React usePiStream.ts (763 lines: reducer + event xlate + channel + queue + abort)
  │ invoke("run_prompt", Channel<PiEvent>)     per-stream channel
  │ listen("queue_update" | "ready" | "sidecar_lost" | "tasks_changed" | ...)
  ▼
Rust relay lib.rs  — spawn sidecar, pipe JSONL, restart loop (3x backoff),
  │                  emits sidecar_lost / ready{sidecarRestarted}
  ▼
Node sidecar index.ts + commands/handler-registry.ts + event-bus.ts
  │ JSONL stdin/stdout via protocol.ts (send/log, EPIPE-safe)
  └ EventBus also feeds remote-server.ts (WebSocket clients)
  domain modules: gmail/ google-auth/ google-workspace/ google-calendar/
                  office-docs/ gemini-antigravity/ providers/ tasks-store/
```

### Known gaps
- `usePiStream` does **not** listen to `sidecar_lost` → mid-stream death =
  silent Channel = UI stuck `isRunning:true` forever.
- No stream-level heartbeat / timeout / watchdog.
- No resume-after-restart, no idempotent replay of an in-flight turn.
- Delta reconcile exists for text (`text_end`) but not thinking (word-doubling
  bug) — same "no authoritative reconcile" class.

---

## Sub-project 1 — Self-healing comms harness  (BUILD FIRST)

Full design in a dedicated spec (this session). Scope headline:
- Detect: stream watchdog (heartbeat/timeout) + `sidecar_lost` wiring in the UI.
- Recover: graceful finalize of partial turn, classify error, bounded
  auto-retry/resume, surface state to the user (never a silent stall).
- Reconcile: authoritative snap for thinking (mirror `text_end`) so replays
  self-correct.
- Small-model friendliness: tight loop, structured recoverable errors, no
  reliance on the model to "notice" a broken stream.

Design doc: `2026-07-15-self-healing-harness-design.md` (in progress).

---

## Sub-project 2 — Portable modularity  (DOCUMENT NOW, BUILD LATER)

**Goal:** a module = one folder + one manifest, liftable into a sibling fork by
copy + register, no edits to harness core.

### Refactor targets (ranked)
1. **`usePiStream.ts` (763 lines) → split.** Extract:
   - `pi-event-router` (pure: PiEvent → reducer action) — testable, portable.
   - `streamReducer` (already a reducer; move to its own file).
   - `useSidecarChannel` (Tauri Channel/invoke wiring + lifecycle).
   - `useQueue` (queue_update listener + steer/follow-up).
   The hook becomes thin composition. Event router is the reusable seam.
2. **Sidecar harness-core vs domain-modules seam.** Define a stable internal
   contract: `harness/` (protocol, event-bus, handler-registry, session-store,
   steering, agent-init) vs `modules/<domain>/` each exposing a manifest
   (`{ commands, tools, events, setup }`). Domain folders already exist
   (gmail/, google-*/, office-docs/) — formalize the registration interface so
   a module self-registers instead of index.ts wiring it by hand.
3. **Module manifest + registry.** One `module.ts` per domain declaring what it
   contributes (commands, tools, front-end panels via extension-ui-bridge).
   handler-registry consumes manifests, not hardcoded imports.
4. **Front-end domain panels.** Settings/domain UIs (Authentication, Google,
   Tasks) pair with their sidecar module — co-locate so a module ports with its
   UI.

### Portability contract (target)
- A module depends only on `harness/*` public types, never on another module.
- Cross-module needs go through the event-bus or a declared dependency, not
  direct import.
- Removing a module = delete its folder + drop its manifest registration.

### Out of scope for sub-project 2
- Runtime extension store (extensions stay build-time, per AGENTS.md).
- Rust relay stays thin; no per-module Rust code.

---

## Sequencing
1. Sub-project 1 (harness) → defines the harness/module seam by necessity.
2. Sub-project 2 (modularity) → formalize seam, split usePiStream, module
   manifests. Uses writing-roadmaps (multi-phase) when picked up.
