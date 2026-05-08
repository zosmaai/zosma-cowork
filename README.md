# Zosma Cowork

**English** | [中文](./README.zh.md) | [Español](./README.es.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Português](./README.pt.md) | [Русский](./README.ru.md) | [한국어](./README.ko.md) | [हिंदी](./README.hi.md)

[![CI](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml)
[![Release](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> A desktop AI coworker built on the [pi coding agent](https://github.com/earendil-works/pi-coding-agent) — streaming, thinking, tool calls, multi-turn sessions, and steering, all in a beautiful native app.

![Zosma Cowork screenshot](./assets/screenshot.png)

## Features

- **Node.js agent sidecar** — The pi-mono TypeScript SDK runs in a managed sidecar process for full agent capabilities (extensions, tools, providers)
- **Thin Tauri relay** — The Rust layer is a minimal IPC bridge between React and the sidecar, keeping the native desktop shell lightweight
- **pi extension ecosystem** — Compatible with pi extensions via `DefaultResourceLoader` — skills, tools, and prompts auto-discovered from `~/.zosmaai/cowork/`
- **Multi-turn sessions** — Full conversation continuity with persistent session history
- **Streaming responses** — See the agent think, write, and call tools in real-time
- **Thinking blocks** — Expandable reasoning from the model
- **Tool call timeline** — Live bash/edit/write tool calls with args and results
- **Session management** — Persistent chat sessions saved to `~/.zosmaai/cowork/`
- **Light & dark mode** — Warm cream light mode, warm charcoal dark mode
- **Keyboard shortcuts** — `Cmd/Ctrl+Shift+K` to focus, `Cmd/Ctrl+N` for new session
- **Abort & steering** — Stop a running agent mid-turn, send follow-up steering messages
- **Claude-inspired UI** — 3-column layout with sidebar, workspace, and info panel

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Tauri v2 Desktop Shell (Rust — thin relay)                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────┐  │
│  │  Left Sidebar   │  │  Center Workspace│  │Right Panel │  │
│  │  (Sessions)     │  │  (Chat/Welcome)  │  │(Progress)  │  │
│  └─────────────────┘  └──────────────────┘  └────────────┘  │
│           ▲ React + Tailwind CSS v4                         │
│           │                                                  │
│  ┌────────┴─────────────────────────────────────────────┐   │
│  │  Tauri IPC Commands                                   │   │
│  │  get_models · send_prompt · abort · set_model         │   │
│  │  save_auth · has_credentials · reload                  │   │
│  └────────────┬───────────────────────────┬──────────────┘   │
└───────────────┼───────────────────────────┼──────────────────┘
                │  stdin/stdout JSON lines   │
┌───────────────┼───────────────────────────┼──────────────────┐
│  Agent Sidecar (Node.js)                  │                  │
│  ┌──────────┴──────────────────────────┐ │                  │
│  │  pi-mono SDK (@earendil-works/pi)   │ │                  │
│  │  • AuthStorage — API keys           │ │                  │
│  │  • ModelRegistry — model discovery  │ │                  │
│  │  • SessionManager — conversation    │ │                  │
│  │  • DefaultResourceLoader            │ │                  │
│  │    → extensions, skills, prompts    │ │                  │
│  └──────────┬──────────────────────────┘ │                  │
│             │                              │                  │
│       LLM Providers                        │                  │
│  (OpenAI, Anthropic, Google, ...)          │                  │
└─────────────────────────────────────────────┘                  │
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4, Radix UI |
| Desktop Shell | Tauri v2, Rust, Tokio |
| Agent Engine | Node.js sidecar using `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| Testing | Vitest, Testing Library, jsdom |
| Linting | Biome (frontend + sidecar), Clippy (Tauri relay) |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (for Tauri desktop shell)

### Quick Start

```bash
# Install frontend dependencies
npm install

# Install agent-sidecar dependencies
cd agent-sidecar && npm install && cd ..

# Run frontend dev server
npm run dev:frontend

# Run full Tauri app (frontend + Rust relay + Node.js sidecar)
npm run dev
```

### Scripts

```bash
# Frontend
npm run lint          # Biome lint
npm run typecheck     # TypeScript check
npm run test          # Vitest run
npm run validate      # lint + typecheck + test
npm run format        # Biome format

# Tauri
npm run build:frontend
npm run build         # Build release binary

# Agent Sidecar
cd agent-sidecar
npm run build         # TypeScript → JavaScript
npm run dev           # tsx watch (standalone development)

# Rust (Tauri relay only)
cargo fmt --all --check
cargo clippy --workspace -- -D warnings
```

## Config & Data

| What | Location | Notes |
|------|----------|-------|
| LLM providers & API keys | `~/.zosmaai/cowork/auth.json` | Managed by the app |
| Model definitions | `~/.zosmaai/cowork/models.json` | Managed by the app |
| Extensions & skills | `~/.zosmaai/cowork/extensions/` | Pi-compatible extensions |
| Session history | `~/.zosmaai/cowork/` | Managed by Zosma Cowork |

## IPC Protocol

The Tauri relay communicates with the Node.js sidecar via stdin/stdout JSON lines:

**Commands (→ sidecar):**

| Command | Description |
|---------|-------------|
| `init` | Initialize agent with zosmaDir config |
| `get_models` | List available models from all providers |
| `prompt` | Send user message, stream events |
| `abort` | Cancel running prompt |
| `set_model` | Switch active model |
| `save_auth` | Save API key for a provider |
| `reload` | Reinitialize with fresh extensions/auth |

**Events (← sidecar):**

| Event | UI Effect |
|-------|-----------|
| `ready` | Models loaded, enable UI |
| `event` | Agent session events (thinking, text, tool calls) |
| `done` | Prompt completed |
| `result` | Response to a request command |
| `error` | Error with message |

## Project Structure

```
zosma-cowork/
├── agent-sidecar/                # Node.js agent process
│   └── src/
│       └── index.ts              # Sidecar: pi-mono SDK, stdin/stdout protocol
├── src/                          # React frontend
│   ├── components/               # UI components
│   │   ├── ChatMessage.tsx       # Message with thinking + tool calls
│   │   ├── ThinkingBlock.tsx     # Expandable reasoning
│   │   ├── ToolCallTimeline.tsx  # Tool execution timeline
│   │   ├── MessageInput.tsx      # Chat input
│   │   └── ui/                   # Primitives (tooltip, badge, etc.)
│   ├── hooks/
│   │   ├── usePiStream.ts        # Streaming state machine (useReducer)
│   │   └── useSessions.ts        # Session persistence
│   ├── types/
│   │   ├── index.ts              # ChatMessage, ToolCallInfo
│   │   └── pi-events.ts          # CoworkEvent types
│   ├── App.tsx                   # Main 3-column layout
│   └── App.css                   # Tailwind theme (light + dark)
├── src-tauri/                    # Tauri desktop shell (thin Rust relay)
│   └── src/
│       ├── main.rs               # Entry point
│       └── lib.rs                # IPC commands → sidecar process
├── docs/                         # Architecture & plans
└── .github/workflows/            # CI/CD
```

## License

MIT © [Zosma AI](https://zosma.ai)
