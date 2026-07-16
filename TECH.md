# Zosma Cowork — Technical Architecture

> **Audience:** First-time developers joining this codebase. This is the onboarding doc you read before you touch any file.

---

## 0. What This Is (In One Paragraph)

Zosma Cowork is a **desktop AI coworker** — a native app (not a website) that pairs a React UI shell with a Node.js agent engine (the *sidecar*). The engine runs large-language-model (LLM) prompts, orchestrates tool calls (GitHub, Google Workspace, file system), manages authentication, and streams results back to the UI in real time. Think of it as "ChatGPT + VS Code + Notion" in one desktop window, but the AI actually has hands: it can clone repos, send emails, create calendar events, and install its own extensions.

**The business outcome:** A commercial user (executive, accountant, lawyer, engineer) types natural-language requests into one chat window and gets work product — documents, code, analysis, emails — without switching between 5 different SaaS tools. The AI has persistent memory (session history), multi-provider model access (OpenAI, Anthropic, Google, local Ollama), and deep tool integration into the user's existing software stack.

---

## 1. The Three-Layer Architecture (High-Level)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            LAYER 1: REACT UI                            │
│  (User sees this: chat bubbles, settings panels, tool call cards)       │
│  React 19 · Tailwind CSS v4 · shadcn/ui · Radix UI                    │
├─────────────────────────────────────────────────────────────────────────┤
│                           LAYER 2: TAURI RELAY                          │
│  (You never see this. It forwards bytes. That's its whole job.)         │
│  Rust · tokio · serde_json                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                          LAYER 3: AGENT SIDECAR                         │
│  (The brain. Prompts, tool calls, auth, extensions, scheduling.)      │
│  Node.js · @earendil-works/pi-coding-agent                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why three layers? Why not just one?

| If we tried... | What would break |
|---|---|
| Bundle the AI engine **inside** Tauri/Rust | Rust has no mature LLM SDK, no npm ecosystem for AI tools, no Google/Slack/GitHub API clients. We'd be rewriting the world in Rust. |
| Run the engine **in the browser** (Web Workers) | No filesystem access, no shell commands, no spawning npm for extensions, no native keychain storage, CORS blocks half the APIs. |
| Make it a **web app** (Next.js + serverless) | No desktop feel, no native OS integration, no persistent background tasks, latency to a remote server ruins the "coworker" feel. |

The **sidecar pattern** is the sweet spot: the UI is a fast native desktop app (Tauri + React), the engine is a rich Node.js process with full OS access, and the relay is a thin Rust pipe between them. Each layer does what it's good at.

---

## 2. What Is a Sidecar? (Deep Dive)

### The Concept

A **sidecar** is a separate process that rides alongside your main application. In Kubernetes, a sidecar container augments a pod. In desktop apps, a sidecar process augments the main GUI process with capabilities the GUI runtime can't (or shouldn't) have.

### Our Sidecar: Why Node.js?

The sidecar is a Node.js process running `@earendil-works/pi-coding-agent` (pi-mono SDK). Here's why Node.js specifically:

1. **NPM ecosystem** — We install AI model clients (`openai`, `@anthropic-ai/sdk`), Google API clients (`googleapis`), GitHub tools (`octokit`), and 50+ other packages dynamically. No other runtime has this density of ready-made API clients.
2. **Dynamic extension loading** — The AI can `pnpm install` new tools at runtime (e.g. "I need a Figma API client for this task"). Only Node.js has a mature package manager that works from inside a running process.
3. **pi-mono SDK is Node.js-native** — The `@earendil-works/pi-coding-agent` package is built on Node.js streams, EventEmitters, and file-system APIs. Porting it to Rust or WebAssembly would be a multi-year rewrite.
4. **Sandbox escape** — The sidecar runs outside the browser sandbox. It can `git clone`, `pnpm install`, write to `~/Documents`, read system keychains, and spawn subprocesses. The React UI *cannot* do these things (and shouldn't).

### The Lifecycle

```
App Launch
    │
    ▼
Tauri (Rust) starts
    │
    ▼
Tauri spawns Node.js sidecar process
    │   ┌──────────────────────────────────────┐
    │   │ Sidecar: main() → initAgent()        │
    │   │   ├── Load auth.json                │
    │   │   ├── Load models.json              │
    │   │   ├── Load session history          │
    │   │   ├── Initialize pi-mono SDK        │
    │   │   └── Send "ready" event            │
    │   └──────────────────────────────────────┘
    │
    ▼
Tauri relays "ready" → React UI
    │
    ▼
React UI enables chat input
```

The sidecar stays alive for the entire app session. If it crashes, the UI shows an error. If the user triggers a command that needs a restart (e.g. installing an extension), the sidecar calls `initAgent()` again internally — it does NOT restart the process.

---

## 3. The Communication Protocol (JSON Lines over Stdio)

This is the **most important concept** in the codebase. Every message between React ↔ Tauri ↔ Sidecar follows the same wire format.

### Wire Format: JSON Lines (JSONL)

Each message is one line of JSON text, terminated by `\n`. The sidecar reads from stdin line-by-line; Tauri reads from the sidecar's stdout line-by-line.

```
{"type":"init","zosmaDir":"/Users/alice/.zosmaai/cowork"}\n
{"type":"prompt","id":"p-abc123","text":"Summarize Q3 revenue"}\n
{"type":"event","event":{"type":"text_delta","delta":"The"}}\n
{"type":"event","event":{"type":"text_delta","delta":" Q3"}}\n
{"type":"done","id":"p-abc123"}\n
{"type":"result","id":"gm","data":{"models":[...]}}\n
{"type":"error","id":"p-abc123","message":"API rate limit exceeded"}\n
```

### Message Types

| Type | Direction | Purpose |
|---|---|---|
| `init` | Tauri → Sidecar | Boot-time: tells the sidecar where its data directory is. |
| `prompt` | React → Sidecar | User sent a chat message. Starts a streaming response. |
| `steer` | React → Sidecar | Mid-turn course correction (delivered after current tools finish). |
| `follow_up` | React → Sidecar | Message appended to the end of the current task. |
| `abort` | React → Sidecar | Stop the current prompt/stream immediately. |
| `event` | Sidecar → React | Streaming chunk (text, thinking, tool call, error, etc.). |
| `done` | Sidecar → React | Stream ended successfully. |
| `result` | Sidecar → React | One-shot response to a non-streaming command (e.g. `get_models`). |
| `error` | Sidecar → React | Something failed. Carries `id` of the command that failed. |

### Why JSON Lines and not gRPC / WebSockets / HTTP?

| Approach | Why we didn't use it |
|---|---|
| **gRPC** | Requires protobuf definitions, codegen, complex build pipeline. Overkill for 50 command types. |
| **WebSockets** | Needs a WebSocket server inside the sidecar, port binding, reconnection logic, firewalls. |
| **HTTP REST** | Polling is slow for streaming. Server-sent events (SSE) need an HTTP server. |
| **Shared memory / IPC** | Platform-specific (Unix domain sockets vs Windows named pipes). JSONL on stdio works identically on macOS, Windows, Linux. |
| **JSON Lines on stdio** | Simple, debuggable (`cat` the pipe), no ports, no network stack, works everywhere, language-agnostic. |

### The `id` Field: Request/Response Matching

Every command has a unique `id`. When React sends `prompt` with `id: "p-abc123"`, the sidecar streams `event` messages with that same `id`. When the stream ends, it sends `done` with `id: "p-abc123"`. This lets the UI correlate responses with requests, even when multiple prompts are queued.

For non-streaming commands (e.g. `get_models`), the `id` is used to match the `result` or `error` response. Tauri maintains a `pending_requests` map of `id → oneshot channel` to resolve async `invoke()` calls.

---

## 4. Layer-by-Layer Deep Dive

---

### 4.1 Layer 1: React Frontend (`src/`)

**Philosophy:** The UI is a dumb(ish) shell. It renders what the sidecar tells it to render. It holds no business logic about how LLMs work, how tool calls execute, or how auth flows complete. All of that lives in the sidecar.

#### Directory Structure

```
src/
├── chat/
│   └── ChatView.tsx        # Main chat canvas: message list, input, streaming UI
├── components/ui/          # Pure, reusable primitives (Button, Badge, Dialog)
│   └── No app imports here! They know nothing about pi or cowork.
├── components/
│   ├── ChatMessage.tsx     # Renders a single chat bubble (markdown, tools, thinking)
│   ├── MessageInput.tsx    # Textarea + send/steer/follow-up + model selector
│   ├── Sidebar.tsx         # Session list, new session, folder grouping, search
│   ├── HomeView.tsx        # The main workspace view (chat + sidebar + panels)
│   ├── SettingsPage.tsx    # Settings tabs container
│   ├── CommandPalette.tsx  # Ctrl+K command picker (built-in + custom commands)
│   ├── StatusLine.tsx      # Bottom bar: model, tokens, cost, thinking level
│   ├── ErrorBanner.tsx     # Top error toast banner
│   ├── SplashScreen.tsx    # Loading overlay during sidecar init
│   ├── UpdateBanner.tsx    # "Update available" notification
│   ├── DocumentsPanel.tsx  # File attachments / document panel
│   ├── ToolCallTimeline.tsx # Visual timeline of tool executions
│   ├── ArtifactPreview.tsx # Preview for generated files/code/images
│   ├── TasksList.tsx       # Scheduled tasks list view
│   ├── TaskDetailPage.tsx  # Individual task run detail view
│   ├── RunHistory.tsx      # History of scheduled task executions
│   ├── MobileBottomNav.tsx / MobileTopBar.tsx  # Responsive mobile chrome
│   ├── ProviderAuthSection.tsx  # Provider auth status + connect buttons
│   ├── CustomInstructions.tsx   # Per-session system prompt editor
│   ├── ConversationSearch.tsx   # Full-text search across all sessions
│   ├── HelpDialog.tsx      # Keyboard shortcuts + help overlay
│   ├── FeedbackButtons.tsx / FeedbackDialog.tsx  # User feedback collection
│   └── settings/           # Settings sub-pages
│       ├── Authentication.tsx      # OAuth + API key management
│       ├── About.tsx             # App info, version, links
│       ├── Appearance.tsx        # Theme, font scale, chat width
│       ├── Instructions.tsx      # Global custom instructions editor
│       ├── Workspace.tsx         # Data directory + folder settings
│       ├── CustomProviderRow.tsx # Custom OpenAI-compatible provider form
│       ├── UpdateSettingsRow.tsx # Auto-update preferences
│       └── Theme.tsx             # Theme token customization
├── hooks/
│   ├── usePiStream.ts      # THE hook: streaming state machine + event parsing
│   ├── useAuth.ts          # OAuth status, login, logout, provider state
│   ├── useProviders.ts     # Model provider list + custom provider CRUD
│   ├── useExtensionUi.ts   # Extension dialog bridge (ctx.ui → React modals)
│   ├── useExtensionUi.ts   # Extension dialog bridge (ctx.ui → React) — NOT user management
│   ├── useTasks.ts         # Scheduled tasks: list, detail, runs
│   ├── useRoutinesExtension.ts  # Pi-routines extension integration
│   ├── useGithub.ts        # GitHub auth status + orgs + login
│   ├── useAppUpdate.ts     # Check for updates + install progress
│   ├── useArtifactLoader.ts # Load file artifacts from disk
│   ├── useFilePicker.ts    # Native file picker via Tauri dialog API
│   ├── usePasteDetection.ts # Clipboard paste detection for image drops
│   ├── useGreeting.ts      # Welcome/greeting message logic
│   └── useTelemetry.ts     # Analytics event tracking
├── lib/
│   ├── cn.ts               # Tailwind class merging (clsx + tailwind-merge)
│   ├── model-key.ts        # "provider/model-id" string formatting
│   ├── sessionStats.ts     # Token/cost/thinking level types
│   ├── builtinCommands.ts  # Built-in slash commands (/clear, /help, etc.)
│   ├── commandFilter.ts    # Fuzzy command filtering for palette
│   ├── artifacts.ts        # Artifact file handling (save, open, preview)
│   ├── brand-links.ts      # External link registry (docs, support, etc.)
│   ├── scroll.ts           # Scroll-to-bottom behavior for chat
│   ├── font-scale.ts       # Dynamic font scaling utility
│   ├── chat-width.ts       # Chat panel width preferences
│   ├── themes.ts           # Theme token definitions
│   ├── wallpaper.ts        # Background wallpaper settings
│   ├── cron.ts             # Cron expression parsing/validation
│   ├── statusLabels.ts     # Human-readable status labels
│   ├── updateChannel.ts    # Update channel resolution (direct vs managed)
│   ├── external-links.ts   # Safe external link opening
│   ├── key-format.ts       # Keyboard shortcut formatting
│   ├── rehypeHighlightTerm.ts  # Markdown term highlighting
│   ├── utils.ts            # General utilities
│   └── telemetry.ts        # Telemetry event definitions
├── types/
│   ├── index.ts            # ChatMessage, ToolCallInfo, CoworkEvent, Command
│   ├── pi-events.ts         # Raw event types from the pi SDK
│   ├── auth.ts             # Auth-related TypeScript types
│   └── commands.ts         # Built-in command type definitions
└── contexts/
    └── UpdateProvider.tsx  # React context for app update state
```

**Note:** `invoke()` is imported directly from `@tauri-apps/api/core` wherever it's needed. There is no central `services/` directory — Tauri calls are co-located with the components/hooks that use them.

#### Key Frontend Concepts

**`usePiStream.ts`** — This is the most complex file in the frontend. It manages the entire streaming lifecycle via a `useReducer` pattern:

- `START_STREAM` → Creates user message bubble + empty assistant bubble
- `TURN_RESET` → New assistant sub-turn starts (think → tool → think → answer)
- `TEXT_DELTA` / `THINKING_DELTA` → Append streaming text
- `TEXT_END` → Snap to authoritative final text (fixes word-duplication bugs)
- `TOOL_CALL_START` / `TOOL_CALL_UPDATE` / `TOOL_PARTIAL_OUTPUT` → Tool execution lifecycle
- `STREAM_COMPLETE` → Finalize the assistant bubble into the message list
- `QUEUE_UPDATE` / `QUEUE_OPTIMISTIC` → Steering + follow-up message queues

**Why a reducer?** Streaming events arrive out of order, can be replayed (after compaction), and can be interleaved with tool calls. A reducer guarantees deterministic state transitions regardless of event ordering.

**Tauri Events vs. Tauri Commands** — The frontend communicates with Tauri in two ways:

1. **Commands** (`invoke("send_prompt", { text, ch: channel })`) — One-shot request/response. Used for starting a prompt, saving auth, changing settings. Commands return a Promise.
2. **Events** (`listen("oauth_completed", callback)`) — Broadcast pub/sub. The Rust relay emits events globally so multiple React components can listen. Used for OAuth progress, extension UI dialogs, queue updates, and task progress.

#### Frontend → Tauri Call Flow

```
User types "Analyze Q3 revenue" + presses Enter
    │
    ▼
React: dispatch({ type: "START_STREAM", prompt: text })
    │
    ▼
React: invoke("send_prompt", { text, ch: streamingChannel })
    │
    ▼
Tauri (Rust): scmd() → write to sidecar stdin
    │
    ▼
Sidecar: receives { type: "prompt", id: "p-xxx", text: "..." }
    │
    ▼
Sidecar: starts LLM stream, SDK emits events
    │
    ▼
Sidecar: send({ type: "event", event: { type: "text_delta", delta: "The" } })
    │
    ▼
Tauri (Rust): read_stdout() → parses JSONL → routes to channel
    │
    ▼
React: channel.onmessage(event) → dispatch({ type: "TEXT_DELTA", delta: "The" })
    │
    ▼
React: re-renders with updated text
```

---

### 4.2 Layer 2: Tauri Relay (`src-tauri/src/lib.rs`)

**Philosophy:** This file is intentionally thin. It spawns the sidecar, forwards JSONL, and exposes typed Rust commands to the frontend. It contains ZERO business logic about LLMs, auth, or tools. If you find yourself wanting to add "smart" logic here, it belongs in the sidecar instead.

#### Key Responsibilities

| Responsibility | How it works |
|---|---|
| **Spawn sidecar** | `spawn_sidecar()` finds the Node.js binary + sidecar entrypoint, starts the process, sends `init` JSONL. |
| **Read stdout** | `read_stdout()` loops over JSONL lines, deserializes each, routes by `type`. |
| **Write stdin** | `scmd()` serializes a JSON value and writes it to the sidecar's stdin pipe. |
| **Channel routing** | `send_prompt` creates a `Channel` (Tauri's typed stream), stores it in `pending_prompts` map, forwards events to it. |
| **Request/response** | `scmd_r()` sends a command, creates a oneshot channel, stores it in `pending_requests`, waits for the matching `result`/`error`. |
| **Event broadcasting** | OAuth events, queue updates, task events are emitted as Tauri events (not just to the active prompt channel) so the UI can listen globally. |

#### The Windows Problem (A Case Study)

The Rust file has ~500 lines of path resolution and Windows edge-case handling. Why? Desktop apps launched from Finder/explorer don't inherit a shell's PATH, and bundled Node.js needs special care:

- **Extended-length paths** — Windows paths like `` `\\?\C:\...` `` crash Node.js v24's module resolver. We strip the `` `\\?\` `` prefix before passing paths to Node.
- **Node.js shims** — `fetch-node.mjs` writes shell-script placeholders for missing architectures. We sniff the first two bytes (`#!` or `@e`) to skip shims and find the real binary.
- **Console windows** — Spawning a console-subsystem child from a GUI parent creates a black `cmd.exe` popup. We set the `CREATE_NO_WINDOW` (0x08000000) flag to suppress it.
- **MITM proxies** — Corporate ZScaler / Cloudflare WARP certs aren't in Node's bundled CA store. We pass `--use-system-ca` so Node also reads the OS trust store (macOS keychain, Windows cert store, Linux `ca-certificates`).
- **`NODE_OPTIONS` leak** — Child `npm` processes inherit the parent's `NODE_OPTIONS`; older Node versions reject unknown flags and exit with code 9. We pass `--use-system-ca` as a CLI argument (consumed only by this Node process) rather than via `NODE_OPTIONS` (which leaks to all children).

**Lesson:** The Tauri layer is where platform-specific plumbing lives. The sidecar stays clean because the Rust layer handles OS quirks.

---

### 4.3 Layer 3: Agent Sidecar (`agent-sidecar/src/`)

**Philosophy:** This is where the brain lives. The sidecar is a long-running Node.js process that:

1. Initializes the pi-mono SDK (auth, models, sessions, extensions)
2. Listens for commands on stdin
3. Executes commands (LLM prompts, auth flows, tool calls, extension installs)
4. Streams results back on stdout

#### Post-Refactor Module Structure

After the refactor (the reason you're reading this doc), the monolithic 4081-line `index.ts` was split into focused modules:

```
agent-sidecar/src/
├── index.ts                          # Orchestrator: main(), initAgent(), readline loop
├── protocol.ts                       # send() and log() — the ONLY way to write stdout
├── gh-auth.ts                        # GitHub CLI auth wrappers (status, login, logout, orgs)
├── extension-ui-bridge.ts            # Dialog bridge: ctx.ui → React UI via Tauri events
├── agent-init.ts                     # Pure init: directories, sessions, resource loader, settings
├── prompt-runner.ts                  # runPromptTask() + continuation loop + watchdog
├── commands/
│   ├── types.ts                      # All 50+ command type interfaces
│   ├── handler-registry.ts           # Factory: creates handler with all dependencies
│   └── handlers/
│       ├── core.ts                   # init, models, prompt, abort, steer, thinking
│       ├── auth.ts                   # OAuth, API key save/validate
│       ├── custom-providers.ts       # User-defined OpenAI-compatible endpoints
│       ├── extensions.ts             # Extension list only — NO user-facing management
│       ├── google.ts                 # Google Workspace connect/disconnect/prefs
│       ├── remote.ts                 # Remote server mode (HTTP/WS bridge)
│       ├── sessions.ts               # Session CRUD, load, save, search
│       ├── settings.ts               # Settings & instructions read/write
│       ├── skills.ts                 # Skill search & listing
│       └── tasks.ts                  # Scheduled task bridge (task-fire)
```

#### The `HandlerDependencies` Pattern

Commands need to mutate main()'s state (session, authStorage, modelRegistry, etc.). Instead of global variables, we use a `HandlerDependencies` interface that exposes getters and setter callbacks:

```typescript
interface HandlerDependencies {
  session: AgentSession | null;
  authStorage: AuthStorage | null;
  modelRegistry: ModelRegistry | null;
  zosmaDir: string;
  getSettings: () => Record<string, unknown>;
  setSettings: (s: Record<string, unknown>) => void;
  // ... etc
}
```

This keeps the state in one place (`main()`) while letting handlers read/write it through a typed interface. No global singletons, no hidden side effects.

#### The pi-mono SDK (`@earendil-works/pi-coding-agent`)

The sidecar is a thin wrapper around the pi-mono SDK. The SDK provides:

| SDK Module | What it does |
|---|---|
| `AuthStorage` | OAuth + API key management, persistent storage in `auth.json` |
| `ModelRegistry` | Discovers available models from all configured providers |
| `AgentSession` | An LLM conversation session: send prompt, receive streaming events |
| `ResourceLoader` | Loads skills, extensions, and tools from disk and npm |
| `ExtensionManager` | Hot-reloads extensions, validates manifests, manages UI permissions |
| `TaskScheduler` | Runs scheduled prompts in isolated sessions (cron-like) |

The sidecar doesn't reimplement any of this — it configures the SDK, forwards commands to it, and translates SDK events into our JSONL protocol.

#### The Extension System (Developer-Managed)

Extensions are what make this more than "just a chat app." In the **commercial product**, extensions are **100% developer-managed** — the developer decides what ships, the end user never touches extension management.

**The rule:** Extensions are installed at build time. Users cannot install, uninstall, enable, disable, or configure them. The product arrives with a fixed, deterministic feature set.

**Why fully developer-managed?**

| Concern | If users could manage extensions | Developer-managed |
|---|---|---|
| **Security** | AI/user could install arbitrary npm packages | Every extension is vetted before the build |
| **Compliance** | Feature set is non-deterministic | Binary is auditable and fixed |
| **Support** | "Why does my install look different?" | Every client runs the same binary |
| **UI clutter** | Extension store, toggles, config forms in settings | Clean settings — no extension noise |
| **Scope creep** | AI suggests installing random tools | Developer controls the product vision |

An extension is an npm package (or local folder) that:

1. Exposes a `manifest.json` declaring tools, skills, and UI permissions
2. Registers tools that the AI can call (e.g. `send_email`, `create_calendar_event`)
3. Can request UI permissions (e.g. `ctx.ui.confirm("Send this email?")`)
4. Is bundled into the sidecar at build time (via `agent-sidecar/scripts/fetch-vendor.mjs`)

**How a developer installs an extension:**

```bash
# 1. Add the extension to the vendor list
cd agent-sidecar
pnpm install <extension-package>        # e.g. pi-gcalendar, pi-gmail

# 2. Or use the vendor script to fetch from a specific tag
node scripts/fetch-vendor.mjs --repo zosmaai/pi-gcalendar --tag v1.2.0

# 3. Build the sidecar
pnpm run bundle                          # Produces dist/bundle.cjs

# 4. Build the full app
cd ..
pnpm run build                           # Tauri bundles the sidecar into the binary
```

**What the end user sees:**

```
User: "Schedule a meeting tomorrow at 3pm"
    │
    ▼
LLM: sees "calendar_create_event" tool (pre-registered by bundled extension)
    │
    ▼
LLM: calls calendar_create_event({ title: "Meeting", start: "2026-07-12T15:00:00" })
    │
    ▼
Extension: calls Google Calendar API with stored OAuth token
    │
    ▼
Extension: returns "Event created: https://calendar.google.com/..."
    │
    ▼
UI: renders tool call card with "Open in Calendar" button
```

**What the end user NEVER sees:**
- Extension store
- "Install extension" button
- Extension toggle switches
- Extension config forms
- npm package names

#### The `ctx.ui` Bridge (Extension Dialogs → React UI)

When an extension calls `ctx.ui.confirm("Delete this file?")`, the SDK blocks the tool call until the user responds. But the SDK runs in the sidecar — the user is in the React UI. Here's the bridge:

```
Extension tool: ctx.ui.confirm("Delete this file?")
    │
    ▼
SDK: pauses tool execution, emits "ui_request" event
    │
    ▼
Sidecar: intercepts event, wraps in JSONL protocol
    │
    ▼
Tauri: reads "ui_request" → emits as Tauri event
    │
    ▼
React: listen("ui_request") → renders ConfirmationDialog
    │
    ▼
User clicks "Yes"
    │
    ▼
React: invoke("send_ui_response", { id, confirmed: true })
    │
    ▼
Tauri: writes JSONL to sidecar stdin
    │
    ▼
Sidecar: resolves the pending promise
    │
    ▼
SDK: resumes tool execution with "confirmed"
    │
    ▼
Tool proceeds to delete the file
```

This is a **distributed async/await** pattern: the extension writes synchronous-looking code (`await ctx.ui.confirm()`), but under the hood it spans three processes (Node.js → Rust → React) and back.

---

## 5. How the Layers Depend on Each Other

### Data Flow (Prompt Lifecycle)

```
[React UI]            [Tauri Relay]              [Agent Sidecar]
    │                       │                          │
    │ invoke("send_prompt") │                          │
    │──────────────────────>│                          │
    │                       │ scmd() → write stdin     │
    │                       │─────────────────────────>│
    │                       │                          │ parse command
    │                       │                          │ start LLM stream
    │                       │                          │
    │                       │ read stdout ←────────────│ send event
    │                       │<─────────────────────────│
    │ channel.onmessage     │                          │
    │<──────────────────────│                          │
    │ re-render with text   │                          │
    │                       │                          │
    │                       │ read stdout ←────────────│ send done
    │                       │<─────────────────────────│
    │ dispatch(STREAM_COMPLETE)                      │
    │                       │                          │
```

### The Init Sequence (App Boot)

```
Tauri starts
    │
    ├───> Spawn sidecar (find Node.js, find entrypoint, set env vars)
    │
    ├───> Send { type: "init", zosmaDir: "/Users/.../.zosmaai/cowork" }
    │
    │       Sidecar: create directories, load auth/models/settings,
    │       initialize pi SDK, send { type: "ready" }
    │
    ├───> Tauri receives "ready" → sets atomic flag
    │
    └───> React UI queries has_credentials() → decides onboarding vs. chat
```

### The OAuth Sequence (Google Example)

```
User clicks "Connect Google"
    │
    ▼
React: invoke("google_connect", { prefs, byo })
    │
    ▼
Tauri: scmd_r() with 5-minute timeout
    │
    ▼
Sidecar: starts PKCE consent flow, opens browser
    │
    ▼
Sidecar: sends "oauth_progress" events via Tauri events (not the prompt channel)
    │
    ▼
React: listen("oauth_progress") → shows "Opening browser..." toast
    │
    ▼
User completes consent in browser
    │
    ▼
Sidecar: exchanges code for tokens, fans out to config files
    │
    ▼
Sidecar: sends "oauth_completed" event
    │
    ▼
React: listen("oauth_completed") → refreshes auth status, enables Google tools
```

### The Dependency Graph (Code-Level)

```
React Frontend
    ├── depends on: @tauri-apps/api (invoke, listen, Channel)
    ├── depends on: sidecar (via Tauri — never directly)
    └── NEVER imports from agent-sidecar/src/

Tauri Relay
    ├── depends on: tokio (async runtime)
    ├── depends on: serde_json (JSONL parsing)
    ├── depends on: sidecar process (stdin/stdout pipes)
    └── NEVER imports from React or agent-sidecar

Agent Sidecar
    ├── depends on: @earendil-works/pi-coding-agent (SDK)
    ├── depends on: @earendil-works/pi-ai (OAuth, models)
    ├── depends on: @earendil-works/pi-agent-core (core types)
    ├── depends on: Node.js stdlib (fs, path, child_process)
    ├── depends on: npm ecosystem (googleapis, octokit, etc.)
    └── NEVER imports from React or Tauri
```

**Critical rule:** The dependency graph is a DAG (directed acyclic graph). React depends on Tauri. Tauri depends on the sidecar process. The sidecar knows nothing about React or Tauri. Violating this (e.g. importing a React component in the sidecar) would break the architecture.

---

## 6. The Business Outcome: What This Architecture Enables

### For the End User

| Feature | How the architecture makes it possible |
|---|---|
| **Multi-provider AI** | `ModelRegistry` discovers models from OpenAI, Anthropic, Google, Ollama, and custom endpoints. The user picks in a dropdown. |
| **Persistent sessions** | Session history is JSON files on disk. The sidecar loads them on init. No database, no cloud account needed. |
| **Background tasks** | `TaskScheduler` runs scheduled prompts in isolated sidecar sessions. The UI can be closed; tasks still run. |
| **Tool integration** | Extensions register tools dynamically. The AI can send emails, create calendar events, clone repos, run shell commands — all through natural language. |
| **Offline/local AI** | Ollama runs locally. The sidecar talks to it via HTTP. No internet required for local models. |
| **No vendor lock-in** | Auth keys are stored locally in `auth.json`. Models are configured in `models.json`. The user owns their setup. |
| **Desktop-native feel** | Tauri gives native menus, keybindings, OS notifications, auto-updater, and a `<500KB` JS bundle. |

### For the Developer

| Feature | How the architecture makes it possible |
|---|---|
| **Fast UI iteration** | `pnpm run dev:frontend` runs just Vite. No Rust compile, no sidecar spawn. Hot reload in `<1s`. |
| **Type safety across layers** | TypeScript types in `src/types/` mirror the JSONL shapes. Rust commands are typed with `serde`. The sidecar uses TypeScript strict mode. |
| **Testable business logic** | Pure functions in `src/lib/` and `agent-sidecar/src/` are easy to unit test. The Tauri relay has almost no logic to test. |
| **Extension ecosystem** | Third-party developers can publish npm packages that add tools. The app installs them at runtime. No app store review needed. |
| **Cross-platform** | One codebase builds for macOS (x64 + arm64), Windows (x64), and Linux (x64). The sidecar + JSONL protocol is platform-agnostic. |

---

## 7. Module-by-Module Reference

### 7.1 Frontend Modules

| Module | What it does | When you touch it |
|---|---|---|
| `src/App.tsx` | Root component. Session state, sidecar lifecycle, routing, theme provider. | Adding a new top-level route or provider. |
| `src/chat/ChatView.tsx` | Main chat canvas. Renders message list, input area, streaming state. | Changing chat layout or adding panes. |
| `src/components/ChatMessage.tsx` | Renders a single chat bubble (user or assistant). Markdown, tool call cards, thinking blocks. | Changing how messages look or adding new bubble types. |
| `src/components/MessageInput.tsx` | Textarea with send/steer/follow-up buttons, model selector, file attachments, queue display. | Adding input features (voice, attachments, shortcuts). |
| `src/components/Sidebar.tsx` | Session list with folder grouping, new session, rename, delete, pin, search. | Changing session management UI. |
| `src/components/HomeView.tsx` | Main workspace view composing chat + sidebar + right panels. | Changing overall workspace layout. |
| `src/components/CommandPalette.tsx` | Ctrl+K command picker. Built-in commands + fuzzy search. | Adding new slash commands. |
| `src/components/StatusLine.tsx` | Bottom status bar: active model, token/cost stats, thinking level pill. | Changing status bar content. |
| `src/components/SettingsPage.tsx` | Settings tabs container (Authentication, Appearance, Workspace, About, etc.). | Adding new settings categories. |
| `src/components/ErrorBanner.tsx` | Top-level error display with dismiss and retry. | Changing error surfacing. |
| `src/components/SplashScreen.tsx` | Loading overlay during sidecar init with progress messages. | Changing startup UX. |
| `src/components/ToolCallTimeline.tsx` | Visual timeline of tool executions within a message. | Changing tool visualization. |
| `src/components/ArtifactPreview.tsx` | Preview pane for generated files, code, images. | Adding new artifact types. |
| `src/components/TasksList.tsx` / `TaskDetailPage.tsx` | Scheduled tasks UI: list view and individual run detail. | Changing task management UI. |
| `src/components/ConversationSearch.tsx` | Full-text search across all session files. | Changing search behavior. |
| `src/components/DocumentsPanel.tsx` | File attachments and document management panel. | Changing file handling. |
| `src/hooks/usePiStream.ts` | The streaming state machine. 500+ lines of reducer logic for event → state transitions. | **Only if you're changing the streaming protocol or event shapes.** This is the most fragile file in the frontend. |
| `src/hooks/useAuth.ts` | OAuth status, login, logout, provider state. | Adding new auth providers. |
| `src/hooks/useProviders.ts` | Model provider list + custom provider CRUD. | Adding new provider types. |
| `src/hooks/useExtensionUi.ts` | Extension dialog bridge. Listens for `ui_request`/`ui_cancel` Tauri events. | Adding new dialog types. |
| `src/hooks/useExtensionUi.ts` | Extension dialog bridge — handles `ctx.ui.confirm/select/input` from running extensions. NOT a management UI. | Changing dialog behavior. |
| `src/hooks/useTasks.ts` | Scheduled tasks: fetch list, load detail, poll runs. | Changing task scheduling UI. |
| `src/hooks/useGithub.ts` | GitHub auth status, org list, login/logout. | Changing GitHub integration. |
| `src/hooks/useAppUpdate.ts` | Check for updates, download progress, install. | Changing auto-update behavior. |
| `src/hooks/useTelemetry.ts` | Analytics event tracking and batching. | Adding new telemetry events. |
| `src/lib/builtinCommands.ts` | Built-in slash commands (`/clear`, `/help`, etc.) with execution logic. | Adding new commands. |
| `src/lib/model-key.ts` | `provider/model-id` string formatting and parsing. | Changing model identification. |
| `src/lib/sessionStats.ts` | Token count, cost, context window, thinking level types. | Changing telemetry types. |
| `src/lib/artifacts.ts` | Artifact file handling: save, open, determine preview type. | Adding new artifact formats. |
| `src/lib/themes.ts` | Theme token definitions (dark mode, custom tokens). | Changing theming system. |
| `src/types/pi-events.ts` | TypeScript types for every event the pi SDK can emit. | Must stay in sync with SDK versions. |
| `src/types/auth.ts` | Auth-related TypeScript types (providers, OAuth states). | Adding new auth types. |
| `src/types/commands.ts` | Built-in command type definitions. | Adding new command types. |
| `src/contexts/UpdateProvider.tsx` | React context for app update state (available, downloading, ready). | Changing update flow. |

### 7.2 Tauri Relay Modules

| Module | What it does | When you touch it |
|---|---|---|
| `src-tauri/src/lib.rs` | All Tauri commands, sidecar spawn, stdout reader, stdin writer, event routing. | **Only if you're adding a new command or changing the spawn logic.** |
| `src-tauri/src/analytics.rs` | (Stub) Telemetry/analytics forwarding. | If adding product analytics. |
| `src-tauri/Cargo.toml` | Rust dependencies. | Adding a new Rust crate. |

### 7.3 Agent Sidecar Modules

| Module | What it does | When you touch it |
|---|---|---|
| `index.ts` | Orchestrator: main(), initAgent(), the stdin readline loop. | Changing startup sequence or command routing. |
| `protocol.ts` | `send()` and `log()` — the ONLY functions that write to stdout. All other modules import these. | **Never change the wire format without updating Tauri AND React.** |
| `gh-auth.ts` | GitHub CLI authentication: status probe, device-flow login, logout, org listing. | Changing GitHub auth behavior. |
| `extension-ui-bridge.ts` | Bridges `ctx.ui` dialog calls to Tauri events. Maintains whitelist of allowed UI permissions. | Adding new dialog types or changing permission model. |
| `agent-init.ts` | Pure initialization: resolve workspace directory, load sessions, build resource loader, load settings, build system prompt. | Changing where data lives or how the workspace is discovered. |
| `prompt-runner.ts` | `runPromptTask()`: starts a prompt, handles continuation loops (agent_end → auto-follow-up), watchdog timer, cleanup. | Changing prompt lifecycle or auto-continuation behavior. |
| `commands/types.ts` | TypeScript interfaces for all 50+ command payloads. | Adding a new command type. |
| `commands/handler-registry.ts` | Factory that creates handlers with access to all mutable state. Routes commands to domain handlers. | Adding a new command handler. |
| `commands/handlers/core.ts` | Core engine commands: init, get_models, prompt, abort, steer, thinking levels. | Changing model selection, prompt behavior, or thinking controls. |
| `commands/handlers/auth.ts` | Auth commands: save_auth, validate_provider_key, start_oauth, cancel_oauth, logout, get_auth_status. | Adding new auth providers or changing key validation. |
| `commands/handlers/google.ts` | Google Workspace: connect, disconnect, prefs, app status, install. The most complex handler (PKCE consent flow). | Changing Google scope selection or consent flow. |
| `commands/handlers/sessions.ts` | Session commands: reload, new, list, save, load, delete, rename, pin, search. | Changing session format or search behavior. |
| `commands/handlers/tasks.ts` | Task bridge: forwards task commands to the pi-routines scheduler. | Changing scheduled task behavior. |

---

## 8. Key Design Decisions (And Why)

### Why JSONL on stdio instead of a proper RPC framework?
**Because debuggability matters.** When something breaks, you can `tail -f` the sidecar's stdout and see every event in real time. You can pipe a captured session into the sidecar for replay. You can write a 10-line Python script that talks to the sidecar. gRPC would require protobuf definitions, generated code, and complex tooling. JSONL is human-readable, universally parseable, and zero-overhead.

### Why a separate `agent-sidecar` package?
**Because bundling.** The sidecar is bundled into the production binary as a compiled `.cjs` file + a bundled Node.js binary. It's a separate build step (`cd agent-sidecar && pnpm run bundle`) that produces a self-contained artifact. The frontend build knows nothing about it. Separation of concerns.

### Why no database?
**Because files are enough.** Session history is JSON files. Auth is JSON. Settings is JSON. Models are JSON. A database would add complexity, migration headaches, and lock-in. Files are human-readable, git-diffable, and trivially backed up.

### Why Rust for the relay instead of Electron's main process?
**Because Tauri is small and fast.** The Rust relay compiles to a ~15MB binary. Electron's main process + renderer + preload + node integration would be 150MB+. Tauri uses the OS webview (WebKit on macOS, WebView2 on Windows), so there's no bundled Chromium. Faster startup, smaller updates, native OS feel.

### Why the pi-mono SDK instead of calling OpenAI directly?
**Because the SDK handles the hard parts.** Streaming parsing, tool call orchestration, token counting, context window management, multi-turn reasoning, extension loading, auth refresh, model discovery, queue management, compaction, and error recovery. Reimplementing this in the sidecar would be 50,000+ lines of code. The SDK is the product; the sidecar is the adapter.

### Why pre-install extensions instead of runtime install?
**Because this is a commercial product.** In a commercial context:
1. **Security** — Runtime `pnpm install` opens the door to supply-chain attacks, typosquatting, and malicious packages. Pre-installing means the developer vets every extension.
2. **Compliance** — Financial, healthcare, and legal clients need deterministic feature sets. "The AI might install something" is not acceptable.
3. **Supportability** — When a client's install breaks, debugging a pre-bundled binary is easier than debugging a runtime-modified environment.
4. **Simplicity** — No bundled npm binary, no PATH manipulation for child processes, no `NODE_OPTIONS` leakage issues. The Tauri spawn logic shrinks by ~200 lines.
5. **No user-facing extension UI** — No extension store, no toggle switches, no config forms cluttering the settings panel. The product is clean and focused.

---

## 9. Getting Started (Your First Day)

### 1. Read the files in this order:
1. `README.md` — setup instructions
2. `TECH.md` — this doc (architecture)
3. `AGENTS.md` — coding standards (TDD, file structure, git workflow)
4. `src-tauri/src/lib.rs` — understand how Tauri commands map to sidecar commands
5. `src/hooks/usePiStream.ts` — understand the streaming state machine
6. `agent-sidecar/src/index.ts` — understand the sidecar orchestrator
7. `agent-sidecar/src/commands/handler-registry.ts` — understand command routing

### 2. Run the app:
```bash
pnpm install
cd agent-sidecar && pnpm install && cd ..
pnpm run dev        # Full app (frontend + Tauri + sidecar)
```

### 3. Make a small change:
- Add a log line in `agent-sidecar/src/protocol.ts`
- Change a button color in `src/components/ui/Button.tsx`
- Add a new Tauri command in `src-tauri/src/lib.rs` and call it from a React hook (e.g. `src/hooks/useAuth.ts`)

### 4. Run the checks:
```bash
pnpm run typecheck    # Frontend TypeScript
pnpm test             # Frontend tests
cd agent-sidecar && npx tsc --noEmit   # Sidecar TypeScript
```

### 5. Before your first PR:
Read `AGENTS.md` sections 2 (TDD), 5 (Git Workflow), and 11 (Feature Checklist). Every PR must pass CI: lint, typecheck, test, build, security scan.

---

## 10. Glossary

| Term | Definition |
|---|---|
| **pi / pi-mono** | The `@earendil-works/pi-coding-agent` SDK — the core AI engine. "Mono" because it's a single package (not split into agent-core, agent-ai, etc.). |
| **Sidecar** | The Node.js process that runs the pi-mono SDK, spawned by Tauri. |
| **Tauri** | A Rust framework for building desktop apps with a web frontend. Smaller and faster than Electron. |
| **JSONL** | JSON Lines — one JSON object per line, newline-delimited. Our wire protocol. |
| **Prompt** | A user message sent to the AI. Triggers a streaming response. |
| **Steer** | A mid-turn course correction — delivered after current tool calls finish but before the next LLM call. |
| **Follow-up** | A message appended to the end of the current task — delivered when the agent has nothing else to do. |
| **Extension** | An npm package that adds tools, skills, or UI dialogs to the AI. |
| **Skill** | A reusable prompt template (e.g. "Write a blog post following our style guide"). |
| **Tool call** | When the AI decides to call a function (e.g. `send_email`) instead of generating text. |
| **Session** | A persisted conversation thread with the AI. Stored as JSON files. |
| **Resource loader** | The SDK component that discovers and loads extensions, skills, and tools from disk. |
| **PKCE** | Proof Key for Code Exchange — a secure OAuth flow used by Google auth. |
| **Task fire** | A scheduled task execution — runs a prompt at a scheduled time in an isolated session. |
| **Context window** | The maximum tokens an LLM can process. The SDK manages this via compaction (summarizing old turns). |

---

*Last updated: 2026-07-11 (post-refactor: index.ts split from 4081→339 lines)*
