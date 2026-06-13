# Contributing to Zosma Cowork

Thank you for your interest in contributing! This document will help you get
started with development setup, architecture, and workflow.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (first time)](#quick-start-first-time)
- [Running in Dev Mode](#running-in-dev-mode)
- [Production Build](#production-build)
- [Project Structure](#project-structure)
- [Key Architecture](#key-architecture)
- [Workflow](#workflow)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 22+** — with npm
- **Rust 1.85+** — via [rustup](https://rustup.rs/)
- **Tauri v2 system deps** — on Linux:

  ```bash
  sudo apt-get install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
      libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```

---

## Quick Start (first time)

```bash
# 1. Clone
git clone https://github.com/zosmaai/zosma-cowork.git
cd zosma-cowork

# 2. Install frontend dependencies
npm install

# 3. Install sidecar dependencies (triggers vendor fetch via postinstall)
cd agent-sidecar
npm install
cd ..

# 4. Launch the full app
npm run dev
```

---

## Running in Dev Mode

### Full app (Tauri window + HMR frontend + sidecar)

This is the main dev command:

```bash
npm run dev
```

Under the hood this runs `tauri dev`, which:

1. Runs `scripts/ensure-dev-resources.mjs` (the `beforeDevCommand`) to create
   lightweight **dev stubs** for any missing Tauri bundle resources (see below)
2. Starts **Vite** dev server on `http://localhost:1420` (hot-reload for React)
3. Compiles and opens the **Tauri** desktop window (Rust relay)
4. The Rust `setup()` hook spawns the **sidecar** (`agent-sidecar/src/index.ts`)
   via `tsx` (TypeScript directly, no bundle needed)
5. The sidecar and Rust relay communicate over stdin/stdout JSON lines

#### Dev bundle resources (why `ensure-dev-resources.mjs` exists)

Tauri's `build.rs` validates at **compile time** that every
`bundle.resources` entry in `src-tauri/tauri.conf.json` exists on disk —
in dev as well as release. Two of those resources are generated, gitignored
artifacts:

- `src-tauri/agent-sidecar/index.cjs` — the esbuild sidecar bundle
  (produced by `scripts/prebuild.mjs`)
- `src-tauri/binaries/node` — the bundled Node.js runtime
  (fetched by `src-tauri/scripts/fetch-node.mjs`)

Those generators only run from `beforeBuildCommand` (production `tauri build`),
so a fresh checkout running `npm run dev` would otherwise fail with
`resource path 'agent-sidecar/index.cjs' doesn't exist`. In dev the sidecar
runs from TS source via `tsx` and `binaries/node` is never spawned, so the
`beforeDevCommand` writes harmless **stub placeholders** to satisfy the check
rather than running the slow bundle + ~50 MB Node download. A production
`npm run build` overwrites the stubs with the real artifacts.

### Individual parts

```bash
# Frontend only (useful for UI work)
npm run dev:frontend             # Vite at http://localhost:1420

# Sidecar only (for debugging remote server)
cd agent-sidecar
npx tsx src/index.ts             # starts, waits for init command on stdin

# In another terminal, send init:
echo '{"type":"init","zosmaDir":"/tmp/zosma-test"}' | npx tsx src/index.ts
```

### Testing the Remote Access feature (Phase 6.0)

1. Launch the app: `npm run dev`
2. Open **Settings → Remote Access**
3. Toggle the switch to **Enable** — this sends a `start_remote` command
   to the sidecar, which starts an HTTP+WebSocket server on port 8765
4. A **QR code** appears — scan it with your phone on the same Wi-Fi
5. Enter the **PIN** shown on screen
6. You can now access the app from your phone browser

> **Firewall**: If you're on Linux with `ufw`, allow the port first:
> ```bash
> sudo ufw allow 8765
> ```

> **Note**: The current web UI is the desktop SPA — it shows the onboarding
> screen because the phone browser doesn't have Tauri APIs. A dedicated
> mobile web UI that communicates via the remote API is planned for
> **Phase 6.1**.

> For **outside home network**: install [Tailscale](https://tailscale.com/) on
> both devices. The Remote Access UI auto-detects Tailscale IPs (100.x.x.x).
> Or use `ngrok http 8765`.

---

## Production Build

```bash
npm run build
```

This runs the full production pipeline:

1. `node src-tauri/scripts/fetch-node.mjs` — downloads bundled Node.js binary
2. `node scripts/prebuild.mjs` — bundles the sidecar via esbuild:
   - `npm ci` in `agent-sidecar/`
   - `npm run bundle` → esbuild inlines everything into `dist/bundle.cjs`
   - Patches `import_meta.url` for CJS compatibility
   - Inlines pi-coding-agent's package.json
   - Copies bundle to `src-tauri/agent-sidecar/index.cjs`
3. `npm run build:frontend` — Vite production build → `dist/`
4. `tauri build` — Tauri bundles everything into .AppImage / .deb / .pacman

---

## Project Structure

```
zosma-cowork/
├── agent-sidecar/              # Node.js sidecar (pi-mono SDK)
│   ├── src/
│   │   ├── index.ts            # Main entry — stdin/stdout JSON protocol
│   │   ├── event-bus.ts        # In-process EventEmitter for broadcasting
│   │   ├── command-queue.ts    # Thread-safe queue for HTTP/WS commands
│   │   ├── remote-server.ts    # HTTP+WS server for phone access
│   │   ├── extension-manager.ts
│   │   ├── office-docs/        # Office document generation extension
│   │   └── vendor/             # Vendored pi-anthropic-messages bridge
│   ├── scripts/
│   │   └── fetch-vendor.mjs    # Fetches vendored anthropic bridge
│   └── package.json
├── src/                        # React frontend
│   ├── App.tsx                 # Root component with routing/layout
│   ├── components/
│   │   ├── RemoteAccessPanel.tsx   # Phase 6.0 — QR, PIN, toggle
│   │   ├── SettingsPage.tsx    # Settings with section navigation
│   │   ├── ChatView.tsx
│   │   └── ...
│   ├── hooks/                  # React hooks (usePiStream, useAuth, etc.)
│   ├── lib/                    # Utilities (themes, telemetry)
│   └── types/                  # TypeScript type definitions
├── src-tauri/                  # Tauri v2 Rust shell
│   ├── src/
│   │   ├── lib.rs              # Tauri commands + sidecar lifecycle
│   │   └── analytics.rs        # Telemetry
│   ├── tauri.conf.json
│   └── Cargo.toml
├── MVP-ROADMAP.md              # Phase-by-phase development roadmap
└── .aur/                       # AUR package files (Arch Linux)
```

---

## Key Architecture

### Communication flow

```
React Frontend (TypeScript/React)
    │  invoke("tauri_command")
    ▼
Tauri Rust Relay (lib.rs)
    │  JSON line over stdin
    ▼
Node.js Sidecar (agent-sidecar/src/index.ts)
    │  handleCommand() dispatches to SDK
    ▼
pi-mono Agent SDK
```

The sidecar has **two input paths** that converge into `handleCommand()`:

```
┌─────────────────┐     stdin JSON line     ┌──────────────┐
│  Tauri (Rust)   │ ──────────────────────► │              │
└─────────────────┘                         │              │
                                            │ handleCommand│
┌─────────────────┐     commandQueue.dequeue│              │
│ Phone Browser    │ ───────────► POST /api  └──────────────┘
│ (HTTP/WebSocket) │◄─────────── SSE / WS     EventBus
└─────────────────┘                          (event-bus.ts)
```

### Remote Access protocol

The sidecar embeds an HTTP+WebSocket server (`remote-server.ts`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/command` | POST | Enqueue a command (prompts, settings, etc.) |
| `/api/events` | GET | SSE streaming of all sidecar events |
| `/ws` | WebSocket | Full bidirectional event streaming |
| `/api/verify-pin` | POST | PIN-based pairing for remote devices |
| `/api/status` | GET | Health check + connected clients |

See `MVP-ROADMAP.md` § Phase 6 for the full specification.

---

## Workflow

1. **Branch**: `git checkout -b feature/my-feature` (from latest `main`)
2. **Code**: Make your changes
3. **Check**: `npm run validate` (lint + typecheck + test) + `cargo fmt`
4. **Commit**: [Conventional Commits](https://www.conventionalcommits.org/)
5. **Push**: `git push fork feature/my-feature`
6. **PR**: Open to `zosmaai/zosma-cowork:main`

### Commit format

```
feat: add streaming support for tool calls
fix: resolve memory leak in usePiStream hook
docs: update README with new screenshots
style: format Rust code with cargo fmt
refactor: simplify event parsing logic
test: add tests for ThinkingBlock component
chore: update dependencies
```

### Code style

```bash
npm run lint        # Biome lint
npm run lint:styles # Inline token-color style guardrail (issue #272)
npm run format      # Biome auto-format
npm run typecheck   # TypeScript check
npm run test        # Vitest
npm run validate    # All of the above

cd src-tauri
cargo fmt          # Rust formatting
cargo clippy       # Rust lints
```

#### Styling: prefer Tailwind utilities over inline token colors

Design tokens are mapped to Tailwind utilities in `src/App.css` via `@theme`
(`bg-card`, `text-foreground`, `border-border`, `bg-sidebar-accent`, …). Use
those utilities instead of inline `style={{ background: "hsl(var(--card))" }}`
strings — inline styles can't be deduped by Tailwind, bypass `cn()` /
`tailwind-merge`, and lose hover/focus/dark variants.

`npm run lint:styles` enforces a **ratcheting baseline**
(`scripts/inline-token-style-baseline.json`): the count of inline
`hsl(var(--token))` references may only ever go *down*. If you migrate some to
utilities, regenerate the baseline:

```bash
npm run lint:styles -- --update
```

Reserve inline `style` for genuinely dynamic values (computed gradients, motion
values, runtime dimensions, alpha-modulated states).

---

## Testing

### Frontend tests

```bash
npm run test              # Run once
npm run test:watch        # Watch mode
```

Tests live next to components: `ComponentName.test.tsx`

### Rust tests

```bash
cd src-tauri && cargo test
```

---

## Troubleshooting

### `npm run dev` crashes with esbuild EPIPE

```
Error: The service is no longer running: write EPIPE
```

**Cause:** This happens when Vite's dependency optimizer (esbuild) is killed
by memory pressure during cargo compilation.

**Fix:**

```bash
# 1. Clear Vite's cache
rm -rf node_modules/.vite

# 2. Clean stale Rust artifacts (can accumulate 10-20GB)
cd src-tauri && cargo clean && cd ..

# 3. Try again
npm run dev
```

If cargo compilation is too slow (first build from clean), you can also:

```bash
# Pre-build the frontend so Vite doesn't need to optimize during compile
npm run build:frontend
# Then in another terminal:
npm run dev
```

### Bundled node binary `resource path 'binaries/node' doesn't exist`

**Cause:** The `fetch-node.mjs` script hasn't been run. In dev mode this is
harmless — the sidecar falls back to your system Node.js.

**To fix for production builds:**

```bash
node src-tauri/scripts/fetch-node.mjs
```

### `agent-sidecar/src/vendor/anthropic-messages/` is missing

The vendored pi-anthropic-messages bridge is fetched via postinstall:

```bash
cd agent-sidecar
npm run postinstall
# Or just: npm install  (runs postinstall automatically)
```

### Sidecar TypeScript errors about imports

The sidecar uses `tsx` to run TypeScript directly in dev mode. Make sure
you have the sidecar deps installed:

```bash
cd agent-sidecar && npm install
```

---

## Questions?

- Open a [GitHub Discussion](https://github.com/zosmaai/zosma-cowork/discussions)
- Email: [hello@zosma.ai](mailto:hello@zosma.ai)

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
