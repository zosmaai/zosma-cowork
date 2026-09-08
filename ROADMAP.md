# Zosma Cowork Roadmap

> **Last updated:** 2026-09-09
> **Current state:** The local Pi-powered web/Tauri product is shipping. The transport-independent Pi backend and versioned read-only API foundation are shipped; interactive API cutover is next.

This is the current roadmap. Historical v0.3 planning is retained in Git history rather than presented as active work.

## Shipped

- Tauri shell with the Next.js web application as the product UI.
- Pi backend contracts, stable errors, runtime management, session services, and model services.
- Versioned `/api/v1` health, capability, model, runtime-state, and read-only session endpoints.
- Persistent sessions, session trees, concurrent runs, streaming, tools, files, Git, worktrees, extensions, provider configuration, and desktop packaging.
- Local-first operation with the existing web/Tauri runtime.

## Current focus: complete the versioned agent API

1. Move session creation, prompts, abort, steering, follow-ups, queues, and SSE to `/api/v1`.
2. Move runtime controls, tools, compaction, Bash, model/thinking controls, and reload to `/api/v1`.
3. Move history, branching, export, auto-name, and extension UI responses to `/api/v1`.
4. Retire legacy agent/session/model routes after browser migration and compatibility checks are complete.

Detailed slice plans and acceptance criteria live in [`docs/superpowers/roadmaps/2026-09-07-modular-headless-pi-backend-roadmap.md`](docs/superpowers/roadmaps/2026-09-07-modular-headless-pi-backend-roadmap.md).

## Next platform boundaries

- Workspace, home, file, and file-index APIs.
- Git status, diff, and worktree APIs.
- Model configuration, project trust, provider credentials, and OAuth APIs.
- Skills, plugins, app updates, and remaining utility APIs.

Each boundary is extracted behind transport-independent TypeScript services, exposed through thin `/api/v1` adapters, and kept compatible with existing callers during migration.

## Product direction

### Machine runtime

- One TypeScript Cowork daemon per employee machine or managed server.
- Local credentials, process supervision, heartbeats, reconnects, recovery, artifacts, and approvals.
- Native protocol adapters rather than terminal-screen scraping.

### Clients and control plane

- TypeScript HTTP/realtime control plane for hosted and self-hosted deployments.
- Web, Tauri desktop, and Expo mobile clients using shared protocol contracts.
- Outbound daemon connections so employee machines do not require public inbound ports.

### Harnesses and team work

- Pi remains the first-class runtime with its existing extensions, skills, prompts, providers, steering, and session behavior.
- Add native Claude Code, Codex app-server, and ACP-compatible harness adapters with capability negotiation.
- Add team workspaces, scheduled work, approvals, policies, audit history, search, usage controls, and business-system integrations.

## Roadmap rules

- Mark work shipped only after implementation and verification land on `main`.
- Keep detailed design and implementation plans in `docs/superpowers/`.
- Prefer small vertical slices with contract tests and compatibility adapters.
- Update this file whenever the active phase changes; do not revive date-based estimates from the retired v0.3 plan.
