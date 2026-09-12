# Zosma Cowork — Agent Engineering Standards

> **Purpose:** This document governs all development work on `zosma-cowork`. Every agent must read and follow these standards before writing code.

---

## 1. Philosophy

- **TDD First:** No production code without a failing test first. The only exceptions are trivial config/string changes (Scenario 3).
- **Less Code, More Work:** Reusable components, pure functions, and shared utilities over duplication.
- **Modular Architecture:** Each module has a single responsibility. Dependencies flow inward.
- **Production Ready:** Every PR must pass CI (test, lint, build, security scan) before merge.

---

## 2. Test-Driven Development (TDD)

### The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

### Three Scenarios

| Scenario | When | Process |
|---|---|---|
| **1. New Feature** | Default for all new files/functions | 1. Write failing test → 2. Watch it fail → 3. Write minimal code → 4. Watch it pass → 5. Refactor |
| **2. Modify Tested Code** | Changing code with existing tests | 1. Run existing tests (green) → 2. Make change → 3. Run tests (still green) → 4. Add test if behavior changed |
| **3. Trivial Change** | Typo, config tweak, string literal | Use judgment. Run relevant tests after. |

### Test Requirements

- One behavior per test. If the name contains "and", split it.
- Use real code over mocks. Mock only external I/O (filesystem, network, Tauri APIs).
- Watch the test **fail for the expected reason** before implementing.
- All tests must pass with pristine output (no warnings, no errors).

### Testing Stack

| Layer | Framework | Command (repo root) |
|---|---|---|
| Workspace | pnpm 10 monorepo | `npm test` runs `pnpm -r test` (single root lockfile) |
| Agent Daemon | TypeScript `tsc --noEmit` | `pnpm daemon:build` / `pnpm -C apps/daemon build` |
| Tauri Relay | `cargo test` | `cd apps/desktop && cargo test` |

---

## 3. Code Architecture

### Monorepo layout (pnpm workspace)

```
zosma-cowork/
├── apps/
│   ├── web/                  # Next.js app (React + TypeScript)
│   │   ├── app/              # Next app router routes (incl. /api/v1 boundary)
│   │   ├── components/       # App-specific components (ActivityBar, ChatMessage, …)
│   │   │   └── ui/           # shadcn-style primitives — NEVER import app-specific code
│   │   ├── lib/              # Pure utilities (cn(), daemon-client, models-cache) — no React
│   │   ├── hooks/            # Reusable React hooks (usePiStatus, …)
│   │   ├── services/         # Business logic / API wrappers (pi-client, …)
│   │   ├── bin/              # Launch options (pi-web-options.js)
│   │   └── scripts/          # package-server, dev-daemon supervisor
│   ├── daemon/               # Standalone Hono HTTP server (apps/daemon/src/server.ts)
│   │   └── src/              # index (entry), orchestrator, auth/, files/, git/, pi/, read/
│   ├── desktop/              # Tauri shell (apps/desktop/src — Rust)
│   │   ├── src/main.rs       # Entry point only
│   │   ├── src/lib.rs        # Tauri commands, sidecar process management (WEB_ENTRY_REL)
│   │   ├── scripts/          # fetch-node.mjs (downloads node binaries)
│   │   └── binaries/         # node + npm bundled for the runtime
│   ├── website/              # Marketing / docs site (Next.js + Turbopack)
│   └── oauth-broker/         # Google OAuth broker (standalone — own npm lockfile)
├── packages/
│   └── protocol/             # Shared runtime schemas, commands, events (not an app)
├── docs/                     # Design docs, security, plans, superpowers roadmaps
└── scripts/                  # Shared helpers (check-shared-port, validate-release-config)
```

**Rules:**
- `components/ui/` are pure, reusable primitives. They know nothing about pi, daemon, or wire protocols.
- `lib/` contains pure functions with zero side effects. These are the easiest to test.
- `hooks/` wrap imperative APIs (fetch, browser APIs) into declarative React.
- `services/` encapsulate all HTTP calls (`daemon-client` → daemon `/ipc`) and external I/O.
- The daemon HTTP server (Hono) is the only server besides Next. Web routes proxy to it over `/api/v1` (see `apps/web/lib/daemon-client.ts`).
- Tauri (`apps/desktop`) is intentionally thin — it spawns/supervises the daemon + packaged Next server and renders `apps/web`.
- The pi-mono SDK (`@earendil-works/pi-coding-agent`) is only used inside `apps/daemon/src/pi/adapter.ts`.
- Never write to stdout except protocol messages (daemon logging goes to stderr).
- Tauri commands return `Result<T, String>` with user-friendly error messages; never panic in production code.

---

## 4. Styling & UI

- **shadcn/ui** primitives with Tailwind CSS v4.
- Theme tokens via CSS custom properties in `App.css`.
- Dark mode only (for now). All colors reference `hsl(var(--...))`.
- Desktop-native feel: minimal borders, subtle shadows, proper scrollbars.

---

## 5. Git Workflow

### Branch Naming

```
feat/session-persistence
fix/memory-leak-in-chat
refactor/extract-pi-client
docs/api-reference
chore/update-dependencies
```

### Commit Convention (Conventional Commits)

```
feat: add session persistence via Tauri events
fix: prevent double scroll on message append
refactor: extract PiClient from usePiStatus hook
test: add coverage for formatTime utility
docs: update AGENTS.md with testing rules
chore: bump @tauri-apps/api to 2.5.0
```

### PR Requirements

- [ ] All tests pass (`pnpm test`, `cd apps/desktop && cargo test`)
- [ ] Lint passes (`pnpm lint`, `cd apps/desktop && cargo clippy -- -D warnings`)
- [ ] Type check passes (`pnpm typecheck`)
- [ ] Daemon + web build (`pnpm daemon:build`, `pnpm web:build`)
- [ ] Security scan passes (pnpm/npm audit, cargo audit)
- [ ] PR description explains what and why

---

## 6. CI/CD

### Pull Request Checks (`.github/workflows/ci.yml`)

Triggers: `push` to `main`, `pull_request`

Jobs:
1. **Workspace Lint, Typecheck & Test**
   - `pnpm install --frozen-lockfile`
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm web:build`

2. **Daemon Build**
   - `pnpm install --frozen-lockfile`
   - `pnpm daemon:build`

3. **Tauri Build Check** (cwd `apps/desktop`)
   - `cargo fmt --check`
   - `cargo clippy -- -D warnings`
   - `cargo build`

### Security Scan (`.github/workflows/security.yml`)

- Weekly + on PR
- `npm audit --audit-level=moderate`
- `cargo audit`
- CodeQL analysis (GitHub native)

### Release Pipeline (`.github/workflows/release.yml`)

Triggers: `push` of version tag (`v*.*.*`)

Jobs:
1. **Version Validation** — ensure tag matches `package.json` and `Cargo.toml`
2. **Build Matrix**
   - macOS (x64 + arm64)
   - Windows (x64)
   - Linux (x64 — AppImage + .deb)
3. **Code Signing** (future — macOS notarization, Windows cert)
4. **Create GitHub Release** with artifacts
5. **Publish to npm** (if CLI component exists)

---

## 7. Code Quality Gates

| Gate | Tool | Fail Condition |
|---|---|---|
| Type Safety | TypeScript strict mode | Any `tsc --noEmit` error |
| Lint | Biome (frontend), Clippy (Tauri relay) | Any warning with `--deny-warnings` |
| Format | Biome, rustfmt | Any diff from `fmt --check` |
| Test Coverage | Vitest (c8), cargo tarpaulin | < 70% for new code |
| Dependencies | npm audit, cargo audit | Moderate+ severity unpatched |
| Secrets | GitLeaks (CI) | Any leaked secret pattern |

---

## 8. Error Handling

### Frontend

- All `invoke()` calls must be wrapped in `try/catch`.
- Errors surface in UI via toast/inline message — never silent fails.
- Use Result/Either pattern for complex flows (future).

### Backend

- Tauri commands return `Result<T, String>` with user-friendly error messages.
- Internal errors are logged via `tauri-plugin-log`.
- Never panic in production code. Use `?` operator with `map_err`.

---

## 9. Performance

- React: Use `React.memo`, `useMemo`, `useCallback` for expensive renders.
- Virtualize long lists (react-window or similar) when messages > 100.
- Rust: Avoid blocking the main thread. Use `tokio::spawn` for I/O.
- Bundle size: Monitor with `vite-bundle-analyzer`. Target < 500KB gzipped.

---

## 10. Documentation

- **AGENTS.md** (this file) — engineering standards.
- **README.md** — user-facing setup and usage.
- **ARCHITECTURE.md** (future) — system design decisions.
- **docs/plans/*.md** — implementation plans for complex features.
- Inline docs: JSDoc for exported functions, Rust doc comments for public APIs.

---

## 11. Checklist for Every Feature

Before claiming a feature is complete:

- [ ] Tests written and watched to fail first
- [ ] Implementation minimal and passing
- [ ] Refactored for clarity (no duplication)
- [ ] Lint and type checks pass
- [ ] Manual verification in `npm run dev`
- [ ] Commit message follows convention
- [ ] PR description includes what, why, and testing notes

---

**Last Updated:** 2026-09-11  
**Enforced By:** CI gates + code review
