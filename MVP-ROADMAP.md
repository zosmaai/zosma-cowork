# Zosma Cowork v1 MVP — Roadmap & Architecture

> **Status:** Draft v1 | **Target:** Launch-quality desktop app for founders & solo devs
>
> "A beautiful, minimal desktop companion that makes the pi coding agent feel like a real coworker."

---

## 🔍 Current State Analysis

### What works today
| Layer | Status | Notes |
|-------|--------|-------|
| Tauri shell app | ✅ Working | Window management, Rust backend |
| `pi` process spawning | ✅ Working | JSON stream mode, abort support |
| Event stream parsing | ✅ Working | Full type coverage for all pi event types |
| Chat message display | ⚠️ Partial | Works but streaming UX has gaps (blank flashes, tool call sync issues) |
| Dark/light theme | ✅ Working | Warm cream / warm dark |
| Sidebar with sessions | ⚠️ Partial | Non-functional tabs (Files, Tools, Settings are placeholders) |
| Right panel | ❌ Placeholder | Progress dots, artifacts, context are all hardcoded mockups |
| Message input | ✅ Basic | Textarea + submit. No file attachment, no @-mentions, no voice |
| Welcome/install flow | ✅ Working | Detects pi, offers one-click install |

### What's broken or missing
1. **Chat goes blank sometimes** — race condition between streaming state and message submission. The `useEffect` that moves messages from stream state to history doesn't properly handle rapid sends or aborts.
2. **Tool call state sync is flaky** — `message.content` doesn't reliably update tool call results within the same assistant message context.
3. **Non-functional tabs** — Files, Tools, Settings all say "coming soon". Three of four nav items are dead.
4. **Right panel is mock UI** — no live data for progress, artifacts, context, or connectors.
5. **No file attachment** — can't drag-drop or @-mention files.
6. **No voice** — a desktop app without voice in 2025 is table stakes for founders.
7. **No task/scheduling UI** — users have no visibility into scheduled prompts, background work.
8. **No app/system tray** — can't minimize to tray and get notified when pi finishes work.
9. **No news/context pane** — founders want daily briefings, not just a chat window.
10. **No extension/app marketplace** — no way for users to install and configure capabilities without touching JSON files.

---

## 🎯 v1 Vision

> **One-sentence pitch:** A beautiful, minimal, voice-native desktop companion for the pi coding agent, with an app ecosystem that makes it trivially easy for founders to configure their daily workflow.

### Target Users
- **Solo founders / indie hackers** — need daily news, task tracking, quick code help
- **Small teams** — want shared context, scheduled standups, project management
- **Power users of pi** — want a GUI that doesn't get in the way

### Design Principles
1. **Chat-first, voice-native** — the primary interaction is conversation. Voice is always available.
2. **Minimal chrome** — no toolbar clutter. Navigation is hidden until summoned (CMD+K).
3. **Progressive disclosure** — panels, tool calls, artifacts appear contextually, not always.
4. **App ecosystem** — capabilities are installed as "apps" (not extensions). Each has a UI config panel.
5. **Offline-capable** — core chat works offline. Apps may need network.

---

## 🧱 Architecture

```
┌─────────────────────────────────────────────────────┐
│               Zosma Cowork Desktop                   │
│  ┌──────────┐ ┌────────────────────┐ ┌────────────┐ │
│  │  Sidebar  │ │    Main Content    │ │ Right Panel│ │
│  │  (nav,   │ │  ┌──────────────┐  │ │ (context,  │ │
│  │  sessions)│ │  │  Chat View   │  │ │  artifacts,│ │
│  │          │ │  │  (messages,  │  │ │  tasks,    │ │
│  │          │ │  │   file diff, │  │ │  progress) │ │
│  │          │ │  │   previews) │  │ │           │ │
│  │          │ │  └──────────────┘  │ └────────────┘ │
│  └──────────┘ └────────────────────┘                │
│              Tauri (Rust) Backend                    │
│  ┌─────────────────────────────────────────────────┐│
│  │  pi process manager │ App registry │ Scheduler  ││
│  │  Event stream parser│ File indexer │ Apps API   ││
│  └─────────────────────────────────────────────────┘│
│                       │                              │
│              pi --mode json | RPC                    │
│                       │                              │
│              ┌────────┴────────┐                     │
│              │   pi coding     │                     │
│              │   agent CLI     │                     │
│              └─────────────────┘                     │
└─────────────────────────────────────────────────────┘
```

### Key Layers

#### 1. Backend (Tauri/Rust)
- **Pi Process Manager** — spawns/manages `pi --mode json` child processes. Handles abort, restart, health checks.
- **Event Stream Parser** — typed JSON line parser → Rust enum → emitted to frontend via Tauri events/channels.
- **App Registry** — manages installed apps (npm/git/local). Each app = pi package with config schema.
- **Scheduler** — lightweight cron for scheduled prompts. Events emitted when tasks complete.
- **File Indexer** — watches `.pi/cowork/` and project directories for file context.
- **Voice** — uses Tauri speech-to-text or OS-level STT (whisper.cpp, macOS native).

#### 2. Frontend (React + Tailwind v4)
- **Chat View** — the core. Streaming markdown, tool call cards, inline diffs, thinking blocks.
- **Composer** — text input + voice button + @-mention autocomplete + file drag-drop.
- **Context Panel** — right sidebar showing active files, tasks, progress, artifacts (collapsible).
- **Command Palette** — CMD+K for everything: commands, apps, files, sessions.
- **Navigation** — minimal top/side nav. Chat, Tasks, App Store, Settings.

#### 3. App System (pi packages with GUI config)
- **Standard format**: npm/git pi packages with a `cowork` section in `package.json`
- **Config schemas**: packages declare their config UI (text fields, toggles, selects, key-value)
- **Runtime**: apps are loaded as pi extensions + cowork renders their config panel from schema

---

## 📦 The "App" Model (vs Extensions)

### Problem
Pi extensions are powerful but:
- No standardized UI configuration
- No discoverability
- Users edit JSON files to configure them
- Each extension uses different patterns

### Solution: Cowork Apps

A **cowork app** is a pi package (npm/git) with an additional `cowork` manifest:

```json
{
  "name": "@zosmaai/cowork-news",
  "keywords": ["pi-package", "cowork-app"],
  "cowork": {
    "displayName": "Daily News",
    "description": "Curated news based on your interests",
    "icon": "newspaper",
    "category": "productivity",
    "config": {
      "schema": {
        "type": "object",
        "properties": {
          "topics": {
            "type": "array",
            "items": { "type": "string" },
            "default": ["ai", "startups", "python"],
            "ui": { "component": "tags-input", "label": "Topics to follow" }
          },
          "sources": {
            "type": "array",
            "items": { "type": "string" },
            "ui": { "component": "select", "label": "News sources", "options": ["hackernews", "techcrunch", "arxiv"] }
          },
          "frequency": {
            "type": "string",
            "enum": ["daily", "weekly", "manual"],
            "default": "daily",
            "ui": { "component": "segmented", "label": "Delivery frequency" }
          }
        }
      }
    },
    "scheduledTask": {
      "schedule": "0 8 * * *",
      "prompt": "Give me today's news on {{topics}} from {{sources}}"
    }
  }
}
```

### App Store UI
Cowork discovers apps from:
1. Built-in curated apps (shipped with cowork)
2. User-installed pi packages with `cowork` manifests
3. Community app registry (future)

Each app shows in a dashboard with:
- Toggle on/off
- Config panel (generated from schema)
- Status indicator (running, idle, error)
- Uninstall button

### Categories of Apps
| Category | Examples | Config Complexity |
|----------|----------|-------------------|
| **News & Briefings** | Daily news, HN top, Arxiv radar, Twitter digest | Medium |
| **Task Management** | Todoist sync, Linear tickets, GitHub issues | Medium |
| **Scheduling** | Standup bot, meeting notes, calendar summary | Low |
| **Dev Tools** | Code review bot, dependency checker, deploy watcher | High |
| **Data & Analytics** | Revenue dashboard, user analytics, SEO checker | High |
| **Communication** | Email drafts, Slack summaries, PR comments | Medium |

---

## 🗺️ MVP Roadmap (Phased)

### Phase 0: Foundation (Week 1-2)
**Goal:** Fix the chat experience. Make it rock-solid before adding features.

| # | Task | Details |
|---|------|---------|
| 0.1 | Fix streaming race conditions | Rewrite `usePiStream` to properly buffer events, handle abort mid-stream, avoid blank screens. Use a reducer pattern instead of `useState` chaining. |
| 0.2 | Fix tool call sync | Tool call results should accumulate correctly within the same assistant message. Add proper dedup and ordering. |
| 0.3 | Add error recovery | When pi process crashes, show a clear error with retry button. Auto-restart on configurable timeout. |
| 0.4 | Remove placeholder tabs | Replace Files/Tools/Settings with actual nav items or consolidate into Chat-only. |
| 0.5 | Add robust session management | Sessions persist to disk, survive app restarts, show proper timestamps and previews. |
| 0.6 | Keyboard shortcuts | CMD+K (command palette), CMD+N (new session), CMD+W (close), Ctrl+Tab (switch sessions) |

### Phase 1: Core Experience (Week 3-4)
**Goal:** A delightful, minimal chat experience that feels native and polished.

| # | Task | Details |
|---|------|---------|
| 1.1 | Redesign chat view | Cleaner message bubbles, better spacing, code block copy button, inline images, collapsible tool calls |
| 1.2 | Smart composer | Placeholder hints that change based on context, multi-line support, keyboard-friendly |
| 1.3 | @-mention file system | Type `/files` or `@` to fuzzy-search and attach files. Files are resolved to absolute paths and passed as context to pi. |
| 1.4 | Drag & drop files | Drop files into composer → attached as context. Shows file preview chips. |
| 1.5 | Voice input | Microphone button → transcription via system STT (macOS `say`, whisper.cpp) → inserts as text or sends directly |
| 1.6 | Real right panel | Live tool call progress, file artifacts, usage/cost tracking, active context list |
| 1.7 | System tray | Minimize to tray, click to open, notification when pi finishes a task |

### Phase 2: Tasks & Scheduling (Week 5-6)
**Goal:** Make Zosma Cowork your daily operations hub.

| # | Task | Details |
|---|------|---------|
| 2.1 | Task view | Dedicated /tasks view showing active, pending, and completed tasks from pi's scheduling system |
| 2.2 | Schedule UI | Visual cron/interval editor. "Every morning at 8 AM" → human-friendly schedule picker |
| 2.3 | Task history | List of past scheduled runs with results, timestamps, and the ability to re-run |
| 2.4 | Notifications | System notification when a scheduled task completes or errors. Click notification → focus cowork. |
| 2.5 | Dashboard widget | Home screen shows next scheduled task, recent completions, quick "What's on today?" button |

### Phase 3: App Store & Ecosystem (Week 7-8)
**Goal:** Turn Zosma Cowork into a platform.

| # | Task | Details |
|---|------|---------|
| 3.1 | App registry backend | Tauri commands: `install_app`, `uninstall_app`, `list_apps`, `get_app_config`, `update_app_config`. Backed by settings.json. |
| 3.2 | App config panel UI | Auto-generate config forms from JSON schema. Text, toggle, select, tags-input, segmented, slider components. |
| 3.3 | App dashboard | Grid of installed apps. Toggle on/off. Status badges. Quick-config. |
| 3.4 | App discovery | "Browse apps" tab showing curated list + ability to install via URL/npm spec |
| 3.5 | News app (first-party) | Daily news based on topics. Configurable sources, frequency. Uses pi + web search. |
| 3.6 | Startup pack | Ship with 3-5 curated apps: News, GitHub Activity, Daily Standup, Email Digest |

### Phase 4: Polish & Distribution (Week 9-10)
**Goal:** Ship to users.

| # | Task | Details |
|---|------|---------|
| 4.1 | App icon & branding | Proper icons, app store screenshots, onboarding flow |
| 4.2 | Distribution pipeline | CI that builds .dmg (macOS), .msi (Windows), .deb/.AppImage (Linux) |
| 4.3 | Auto-update | Tauri updater with GitHub releases |
| 4.4 | Telemetry (opt-in) | Crash reporting, usage analytics that help prioritize features |
| 4.5 | Documentation | User guide, developer docs for building apps, API reference |
| 4.6 | Public launch | Product Hunt, HN, dev.to, pi Discord |

---

## 🎨 UI Architecture

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  [CMD+K] [—] [□] [X]                    [theme] [tray]  │  ← Title bar (custom or native)
├────────┬─────────────────────────────────┬───────────────┤
│        │                                 │               │
│ Nav    │   Chat / Task / App View        │  Context      │
│        │                                 │  Panel        │
│  💬    │   ┌─────────────────────────┐   │  (collapsible)│
│  ✓     │   │  Messages (scrollable)  │   │               │
│  📦    │   │                         │   │  • Active file│
│  ⚙️    │   │  ─────────────────────  │   │  • Tool calls │
│        │   │                         │   │  • Artifacts  │
│        │   └─────────────────────────┘   │  • Tasks      │
│        │                                 │  • Cost/usage │
│        │   ┌─────────────────────────┐   │               │
│        │   │  Composer               │   │               │
│        │   │  [🎤] [📎] [@file ...]  │   │               │
│        │   └─────────────────────────┘   │               │
├────────┴─────────────────────────────────┴───────────────┤
│  Status: model | tokens | tasks | pi status              │  ← Footer
└──────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Sidebar = minimal navigation** — just icons with tooltips. Chat, Tasks, Apps, Settings. No text labels.
2. **Context panel = collapsible right sidebar** — hidden by default, slides in on hover or when relevant (tool calls, artifacts, errors)
3. **Command palette = CMD+K** — universal search/action. "New session", "Install app", "Run task", "Open file", "Change model"
4. **Composer = rich** — voice button, file attachment, @-mention, send. No extra toolbar.
5. **Footer = quiet status** — shows active model, token usage, running tasks count, pi connection status

### Color & Typography
- **Warm neutrals** (already have a solid theme in App.css)
- **One accent color** (the warm orange/amber from current theme)
- **Font**: Inter (UI) + JetBrains Mono (code)
- **Size**: 13px base. Intentionally small for density.

---

## 🔩 Technical Implementation Notes

### Fixing the Chat Stream (highest priority)

Current bug: blank screen happens because `useEffect` for `streamState.isRunning` / `streamState.message` doesn't sequence properly with `handleSend`. Race:

1. User sends message → `startStream()` called
2. Stream starts → `state.message` populated
3. Stream ends → `isRunning` becomes false
4. `useEffect` fires → moves message to history, calls `resetStream()`
5. But between step 3 and 4, a re-render can show empty state

**Fix:** Use `useReducer` with explicit action types instead of multiple `useState` + `useEffect` chains. The reducer handles:
- `START_STREAM` → set running=true, create placeholder message
- `STREAM_UPDATE` → update message content/thinking/toolCalls
- `STREAM_ERROR` → mark error on message
- `STREAM_COMPLETE` → move to finalized messages array, clear running state
- `ABORT_STREAM` → clear running, mark as aborted
- `ADD_USER_MESSAGE` → append user message

### Voice Integration

**Approach (simplest):** Use Web Speech API in the browser context (WebKit on macOS via Tauri). If unavailable, fall back to:
- macOS: `say` → pipe to whisper.cpp or macOS speech recognition (`NSSpeechRecognizer` via Tauri command)
- Linux: `whisper.cpp` or `speech-recognition` via pipewire
- Windows: Windows.Media.SpeechRecognition

**MVP:** Push-to-talk button. Records audio, sends to transcription, inserts text into composer (or sends directly if configured).

### @-mention / File Picker

1. Type `@` or `/files` in composer → triggers autocomplete dropdown
2. Fuzzy match against open project files (watched via Tauri file watcher)
3. Select file → inserts `@path/to/file.ts` as a chip
4. On send → `read path/to/file.ts` is prepended to the prompt

### Scheduler Integration

Pi already has `schedule_prompt` tool. Cowork surfaces it:
- Tauri backend uses `tokio::time::interval` or `cron` crate for scheduling
- On schedule trigger → runs `pi --mode json "prompt"` via the same stream system
- Results stored and surfaced in UI + system notification
- Users configure via Task view or from within chat ("schedule daily news at 8 AM")

### App Registry

```typescript
interface CoworkApp {
  id: string;                    // npm:@zosmaai/cowork-news
  name: string;                  // "Daily News"
  description: string;
  icon: string;                  // lucide icon name
  category: string;              // "news" | "tasks" | "devtools" | ...
  enabled: boolean;
  config: Record<string, unknown>;  // user's saved config
  schema: JSONSchema;            // for generating config UI
  status: "idle" | "running" | "error";
  lastRun?: { timestamp: number; result: string; error?: string };
  scheduledTask?: {
    schedule: string;            // cron expression
    promptTemplate: string;      // with {{variable}} placeholders
  };
}
```

App registry is stored in `~/.pi/cowork/apps.json` (separate from pi settings to keep things clean).

### Home Directory

The app stores data in `~/.zosmaai/cowork/` — separate from `~/.pi/agent/` (pi's own config).

```
~/.zosmaai/cowork/
├── sessions/           # Session data (JSONL format)
└── ...
```

---

## 📱 Feature Table by Phase

| Feature | Phase | Priority | Effort | Notes |
|---------|-------|----------|--------|-------|
| Fix chat stream | 0 | 🔴 Critical | 2 days | #1 blocker. Must be rock-solid. |
| Remove placeholder tabs | 0 | 🔴 Critical | 1 day | Dead UI erodes trust |
| Session persistence | 0 | 🟡 High | 2 days | Survive app restart |
| Keyboard shortcuts | 0 | 🟢 Medium | 1 day | CMD+K, CMD+N, Esc |
| Error recovery | 0 | 🟡 High | 1 day | Pi crash → graceful retry |
| Redesigned chat view | 1 | 🔴 Critical | 3 days | Core experience |
| Smart composer | 1 | 🔴 Critical | 2 days | with @-mentions |
| Drag & drop files | 1 | 🟡 High | 2 days | File context |
| Voice input | 1 | 🟡 High | 3 days | Push-to-talk |
| Real right panel | 1 | 🟡 High | 3 days | Live tool calls, artifacts |
| System tray | 1 | 🟢 Medium | 2 days | Background operation |
| Task view | 2 | 🟡 High | 3 days | Visual task management |
| Schedule UI | 2 | 🟡 High | 3 days | Human-friendly cron editor |
| Notifications | 2 | 🟢 Medium | 2 days | Native OS notifications |
| Dashboard widget | 2 | 🟢 Medium | 1 day | Home screen |
| App registry backend | 3 | 🔴 Critical | 3 days | Core platform feature |
| App config panel | 3 | 🔴 Critical | 3 days | Auto-generated forms |
| App dashboard | 3 | 🟡 High | 2 days | Installed apps grid |
| App discovery | 3 | 🟢 Medium | 2 days | Browse & install |
| News app (1st-party) | 3 | 🟡 High | 3 days | Flagship app |
| Branding & icons | 4 | 🟢 Medium | 2 days | Launch readiness |
| Distribution pipeline | 4 | 🟡 High | 2 days | CI builds |
| Auto-update | 4 | 🟢 Medium | 2 days | Tauri updater |
| Docs & launch | 4 | 🟡 High | 3 days | Ship it |

---

## 🧠 Key Open Questions

1. **Should cowork be the only "pi home" or complement existing pi?** → I think it should be complementary. `~/.pi/agent/` remains pi's config; `~/.pi/cowork/` is cowork's config. Cowork can manage pi packages via the app system, but doesn't replace pi's own extension management.

2. **Voice: built-in or first-party app?** → MVP: built-in push-to-talk. If too complex, ship as a first-party app. Voice should feel native, not bolted on.

3. **App config schema format?** → JSON Schema is the most portable. Use `react-jsonschema-form` or a lightweight custom renderer. Could also use a Cowork-specific DSL that's simpler.

4. **Scheduling: in-process (Rust cron) or rely on pi's schedule tool?** → Both. Cowork's Tauri backend runs the cron, then invokes pi. This keeps scheduling alive even if the frontend is closed. Pi's own `schedule_prompt` is for in-session scheduling.

5. **Monorepo or single package?** → Single package for now. Split into `zosma-cowork` (Tauri app) + `create-cowork-app` (scaffolding for app developers) later.

---

## ✅ Immediate Next Steps

1. **Phase 0 sprint:** Fix the chat stream. This is the #1 thing users notice.
   - Rewrite `usePiStream` with `useReducer`
   - Add test coverage for stream lifecycle
   - Confirm no blank screens on rapid send/abort cycles

2. **Phase 0 cleanup:**
   - Remove dead tabs from sidebar. Replace with just Chat + a configurable nav.
   - Make sessions persist to `~/.pi/cowork/sessions/`
   - Add CMD+K command palette

3. **Phase 1 start:** Composer improvements + right panel
   - Rich composer with @-mention prototype
   - Voice button (records, sends to whisper, inserts text)
   - Right panel with live tool call data from the stream

---

## 📋 Quick-Start: What to build first (this week)

1. `src/hooks/usePiStream.ts` — **rewrite with useReducer.** No more race conditions. Add proper state machine: `idle → streaming → complete | error | aborted`.

2. `src/App.tsx` — **simplify layout.** Remove the non-functional tabs. Show Chat view only + a hamburger menu for settings. Right panel becomes hidden by default, shown on tool calls.

3. `src/components/Composer.tsx` — **new component.** Textarea + voice button + file attachment zone. Standalone, reusable.

4. `~/.pi/cowork/` — **create the home directory.** Start storing sessions and settings there.

5. `src/commands/Palette.tsx` — **CMD+K command palette.** Search "New session", "Install app", "Open file", "Change model".

---

*This document is a living artifact. Update as decisions are made and priorities shift.*

---

## 🗂️ Phase 5: Office Document Generation (DOCX/PPTX/XLSX)

**Goal:** Give every user the ability to create, edit, and preview professional Microsoft Office documents (Word, PowerPoint, Excel) through natural language — no design skills needed.

### Why This Matters

| Insight | Implication |
|---------|------------|
| Zosma's target users are laptop/Windows users working in Microsoft Office 365 | Office documents are table stakes for founders — pitch decks, business plans, financial models, reports, proposals |
| AI agents can generate content but produce ugly, unformatted documents | Human-level layout awareness is the differentiator |
| No desktop AI app has native Office document creation | First-mover advantage for Zosma Cowork |
| Existing libraries need code; OfficeCLI gives agents a CLI-native way to build documents | The agent (not a separate service) drives the creation loop |

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 Zosma Cowork + Office Docs               │
│                                                          │
│  User: "Create a pitch deck for my AI startup"           │
│       │                                                   │
│       ▼                                                   │
│  Agent (pi) receives request                              │
│       │                                                   │
│       ├─ ▶ Reads OfficeCLI skill rules                     │
│       ├─ ▶ Calls OfficeCLI via pi tools                    │
│       │    (create → add → set → format → watch)           │
│       ├─ ▶ Previews in browser via `officecli watch`       │
│       └─ ▶ Saves .pptx/.docx/.xlsx to user's project      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │           OfficeCLI (single binary)               │    │
│  │  • DOM path: /slide[1]/shape[@name=Title]        │    │
│  │  • View modes: outline, stats, issues, html      │    │
│  │  • Live preview: `officecli watch file.pptx`     │    │
│  │  • Batch ops: multiple edits, one save cycle      │    │
│  │  • Validate: OpenXML schema checks               │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Tool Layer for the Agent

The agent needs a set of pi tools wrapping OfficeCLI commands. These sit between the agent's reasoning and the OfficeCLI binary:

```
Tool: create_document
  → officecli create <path>.docx|.pptx|.xlsx

Tool: edit_document
  → officecli add|set|remove <path> <dom-path> --prop ...

Tool: read_document
  → officecli view <path> <mode>  (outline|text|html|issues|stats)

Tool: preview_document
  → officecli watch <path> --browser

Tool: find_and_format
  → officecli set <path> / --prop find=<text> --prop bold=true

Tool: batch_edit
  → officecli batch <path> < batch.json
```

### Supported Document Types

#### 📄 Word (.docx)
| Feature | OfficeCLI Support | Notes |
|---------|:---:|-------|
| Paragraphs & runs | ✅ | Bold, italic, color, size, font, spacing |
| Tables | ✅ | Merge cells, borders, shading, widths |
| Headers/footers | ✅ | First-page diff, odd/even |
| Images (PNG/JPG/GIF/SVG) | ✅ | SVG auto-rasterized for older Word |
| Charts | ✅ | Bar, line, pie, scatter |
| Hyperlinks & TOC | ✅ | Auto-generated TOC |
| Footnotes/endnotes | ✅ | Proper reference numbering |
| Tracked changes & comments | ✅ | Agent-reviewable edit proposals |
| Equations | ✅ | OMML math format |
| Watermarks | ✅ | Text and picture |
| Section breaks & margins | ✅ | Different orientations in same doc |
| Content controls | ✅ | Structured fill-in forms |
| i18n & RTL | ✅ | Per-script font slots, BCP-47 lang tags |
| Document protection | ✅ | Read-only, edit restrictions |

#### 📽️ PowerPoint (.pptx)
| Feature | OfficeCLI Support | Notes |
|---------|:---:|-------|
| Slides & layouts | ✅ | Slide masters, custom layouts |
| Shapes (text, rect, ellipse, etc.) | ✅ | Precise positioning (cm/inches) |
| Tables on slides | ✅ | With styling |
| Charts | ✅ | All chart types |
| Images & SVG | ✅ | SVG support |
| Connectors & groups | ✅ | Smart shapes with connectors |
| Video & audio | ✅ | Embedded media |
| Morph transitions | ✅ | `morph-ppt` and `morph-ppt-3d` skills |
| 3D models | ✅ | 3D model support |
| Slide notes & comments | ✅ | Speaker notes, reviewer comments |
| Placeholders | ✅ | Template-based slides |

#### 📊 Excel (.xlsx)
| Feature | OfficeCLI Support | Notes |
|---------|:---:|-------|
| Sheets, rows, cells | ✅ | Rich text in cells |
| Cell merging & styling | ✅ | Borders, fills, fonts, alignment |
| 20+ chart types | ✅ | Bar, column, line, pie, scatter, etc. |
| Pivot tables | ✅ | Rows, cols, values, filters, sort, aggregators |
| Conditional formatting | ✅ | Color scales, data bars, icon sets |
| Data validation | ✅ | Dropdowns, ranges, custom formulas |
| Autofilter & sorting | ✅ | Interactive filtering |
| Named ranges | ✅ | Formula-friendly references |
| Sparklines | ✅ | Inline mini-charts |
| OLE objects | ✅ | Embedded content |

### Design Rules (Human-Level Quality)

OfficeCLI alone produces functional documents. **Design rules make them beautiful.**

#### For Presentations (Pitch Decks, Reports)
| Rule | Detail |
|------|--------|
| Color palette | Match topic: dark navy/slate for tech, warm for creative, clean white for enterprise |
| Typography | Title 36-44pt, subtitle 18-24pt, body 14-16pt. Sans-serif headers, serif for body text |
| Layout variation | Never two identical slide layouts in a row. Mix title/section → content → chart → image → quote |
| Margins & spacing | 0.5" margins minimum, 0.3-0.5" between blocks, never touch edges |
| Bullet hierarchy | Indented properly. Max 3 levels. Use icons in colored circles, not plain dots |
| Charts | Clean axis labels, consistent legend placement, accessible colorblind-friendly palettes |
| Images | Proper aspect ratios, no stretching, alt text for accessibility |

#### For Documents (Reports, Proposals)
| Rule | Detail |
|------|--------|
| Table of contents | Auto-generated, page numbers aligned right |
| Heading hierarchy | H1 → H2 → H3. Never skip levels. Consistent numbering or not, pick one |
| Paragraph spacing | 6pt after paragraphs. No double-spacing between sections unless intentional |
| Page numbers | Footer, centered or right-aligned. Title page often omitted |
| Table styling | Header row bold with shading, alternating row colors, borders consistent |
| Bullet/numbering | Proper Word bullet library (not unicode bullets). Multi-level list styles |
| Smart quotes | Always use curly quotes, straight for code |

#### For Spreadsheets (Financial Models, Reports)
| Rule | Detail |
|------|--------|
| Header row | Bold, colored background, frozen |
| Number formatting | Consistent decimal places, currency symbols, percentage format |
| Column widths | Content-aware. Wrap text or expand columns |
| Color coding | Green for inputs, blue for formulas, red for warnings, no garish defaults |
| Print area | Set correctly with page margins, scaling, repeat header rows |

### 5.1 | Install OfficeCLI on first document request

When a user asks to create a document, the agent checks if OfficeCLI is available:
- If not installed → download the binary to `~/.zosmaai/cowork/bin/officecli`
- If already installed → verify version is recent enough
- Future: bundle OfficeCLI in Zosma Cowork's own dependencies

```bash
# Install (automatic in agent flow)
curl -fsSL https://github.com/iOfficeAI/OfficeCLI/raw/main/install.sh | bash
# Or download binary directly
curl -L -o ~/.zosmaai/cowork/bin/officecli https://github.com/iOfficeAI/OfficeCLI/releases/latest/download/officecli-linux-x64
chmod +x ~/.zosmaai/cowork/bin/officecli
```

### 5.2 | Make OfficeCLI available as pi tools in the sidecar

Register pi tools for each OfficeCLI operation. These are defined in `agent-sidecar/src/tools/`:

| Tool Name | OfficeCLI Command | Purpose |
|-----------|------------------|---------|
| `create_document` | `officecli create <path>` | Create blank DOCX/PPTX/XLSX |
| `add_document_element` | `officecli add <path> <path> --prop ...` | Add slides, shapes, paragraphs |
| `set_document_element` | `officecli set <path> <path> --prop ...` | Format text, resize, recolor |
| `remove_document_element` | `officecli remove <path> <path>` | Delete elements |
| `read_document` | `officecli view <path> <mode>` | Read as outline/text/issues |
| `batch_edit_document` | `officecli batch <path> < batch.json` | Multiple edits, one save |
| `preview_document` | `officecli watch <path>` | Live preview in browser |
| `validate_document` | `officecli validate <path>` | Check against OpenXML schema |
| `find_and_format` | `officecli set <path> / --prop find=...` | Find & replace with formatting |

### 5.3 | Add "Documents" section in the right panel

A new collapsible section in the right panel showing:
- Recent documents created in the current session
- Preview thumbnails (via `officecli view <path> html` rendered as iframe)
- Quick actions: "Open file", "Share", "Export"
- Status: generating, ready, error

### 5.4 | Ship with built-in document templates for common use cases

| Template | Documents Included |
|----------|------------------|
| 🚀 Startup Pitch | Pitch deck (12 slides), Executive summary (Word), Financial model (Excel) |
| 📊 Business Report | Quarterly review (PPTX), Full report (DOCX), Data appendix (XLSX) |
| 📝 Proposal | Technical proposal (DOCX), Scope overview (PPTX), Budget (XLSX) |
| 📐 Academic | Paper template (DOCX), Presentation (PPTX) |

Each template is a skill file the agent loads (`officecli load_skill pitch-deck`) combined with cow-specific design rules.

### 5.5 | Agent prompt enhancement — natural language to document

Augment the system prompt with a `Document Generation` capability block so the agent knows how to use these tools:

```markdown
## Document Generation

You can create professional Office documents (DOCX, PPTX, XLSX) using OfficeCLI.

### Multi-step workflow:
1. **Plan**: Understand the document type, audience, and required sections
2. **Create**: Generate the file structure with create_document
3. **Build**: Add content element by element (slides, paragraphs, tables, charts)
4. **Format**: Apply design rules — colors, fonts, spacing, alignment
5. **Review**: Preview via preview_document or read_document to check quality
6. **Fix**: Address any issues found in read_document issues mode
7. **Deliver**: Present the final file path to the user

### Design rules:
- Always vary slide layouts (never two identical in a row)
- Use consistent color palettes matching the topic
- Set proper margins (0.5" min) and spacing
- For tables: bold header with shading, alternating row colors
- For charts: clean axis labels, accessible palettes
- Always validate document before presenting to user
```

### Phased Rollout

| # | Task | Details |
|---|------|---------|
| 5.1 | Agent-side OfficeCLI detection + install | Check `which officecli`, download if missing to `~/.zosmaai/cowork/bin/`, verify version |
| 5.2 | pi tool wrappers | Create the 8 pi tool definitions in the sidecar that call OfficeCLI with JSON output parsing |
| 5.3 | Design rules as skill files | Port pptx skill color palettes + layout rules + font pairings as loadable skill files |
| 5.4 | Documents right-panel UI | Recent docs list, preview thumbnails, quick actions |
| 5.5 | Document templates | Ship 3-5 template packs as first-party assets |
| 5.6 | Agent prompt augmentation | Inject the Document Generation capability block into system instructions |
| 5.7 | QA loop | Preview → detect issues → fix cycle. Subagent-driven visual QA for PPTX layout |
| 5.8 | Tests | End-to-end tests: create doc → edit → view → validate pipeline |

### Success Criteria

- User says "Create a pitch deck for my startup" → agent produces a professional 10-12 slide deck in <2 minutes
- User says "Generate a quarterly report from this data" → agent creates a Word doc with formatted tables, TOC, and charts
- User says "Build a financial model" → agent creates an Excel sheet with formulas, formatting, and pivot tables
- Documents open correctly in Microsoft Office 365, Google Docs/Sheets, LibreOffice
- Documents pass OfficeCLI validation (no OpenXML schema errors)
- Documents pass visual QA (formatted correctly, consistent design)
