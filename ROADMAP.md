# Zosma Cowork — Product Roadmap

> **Last updated:** 2026-07-14
> **Current version:** v0.3.0
> **Status:** Active development — pre-v1

---

## Vision

A native desktop AI coworker that makes the pi coding agent feel like a real coworker. Lightweight (Tauri), extensible (pi extensions), and beautiful. Not a chatbot — an agent that connects to your tools, works on your files, and stays out of the way.

---

## Current State (v0.3.0 — July 2026)

### What works today

| Layer | Status | Details |
|-------|--------|---------|
| **Tauri shell** | ✅ | Window mgmt, system tray, auto-update, cross-platform (macOS/Win/Linux) |
| **Agent sidecar** | ✅ | Node.js sidecar running pi-mono SDK, stdin/stdout JSON protocol |
| **Streaming chat** | ✅ | Real-time token streaming, thinking blocks, tool call timeline |
| **Session management** | ✅ | Save/load/rename/pin/delete sessions, JSONL storage, folder grouping |
| **Model selection** | ✅ | Multi-provider, model picker, per-session override |
| **Tool calling** | ✅ | File ops, shell, web search/fetch, Google Workspace, Office docs |
| **Extensions platform** | ✅ | App Store UI, install/enable/disable extensions, config panels |
| **Skills system** | ✅ | 25+ curated skills, skill browse/install UI |
| **Slash commands** | ✅ | Built-in registry, help dialog, command palette |
| **Custom instructions** | ✅ | `~/.zosmaai/cowork/INSTRUCTIONS.md`, UI editor |
| **Right panel** | ✅ | Tool call timeline, artifact preview, run history |
| **Office documents** | ✅ | OfficeCLI integration — create/edit preview DOCX/PPTX/XLSX |
| **Google Workspace** | ✅ | Gmail, Calendar, Drive — broker-aware OAuth |
| **Discord** | ✅ | Via apps platform, bot setup |
| **GitHub** | ✅ | Via `gh` CLI bundling |
| **Remote access** | ✅ | Embedded HTTP+WS server, QR code pairing, PWA |
| **Mobile web** | ✅ | Responsive React build served to phone browsers |
| **Tasks/scheduling** | ✅ | pi-routines vendored, task list + detail UI, run history |
| **Settings** | ✅ | Auth, extensions, skills, instructions, theme, telemetry, remote access |
| **Themes** | ✅ | Dark/light, brand-blue variant |
| **Distribution** | ✅ | Homebrew, Winget, AUR, .deb, .AppImage, .dmg, .msi |

### What's partially built

| Feature | Status | Gap |
|---------|--------|-----|
| **Messenger bridge** | ⚠️ | `pi-messenger-bridge` works but needs setup wizard UI |
| **Voice input** | ⚠️ | Web Speech API wired, needs UX polish |
| **Drag & drop files** | ⚠️ | Basic attach works, no preview chips |
| **@-mention autocomplete** | ⚠️ | File picker wired, needs fuzzy search UX |
| **Design Studio** | ⚠️ | Artifact preview exists, skill absorption from Open Design planned |
| **Conversation search** | ⚠️ | Deep search via sidecar, needs better UI |

### What's not built

| Feature | Priority | Notes |
|---------|----------|-------|
| **Microsoft Teams** | High | Only messaging gap that matters |
| **Slack ops** | Medium | Deeper than chat bridge (search, channels, users) |
| **Jira** | High | Zero pi extensions exist, PM-critical |
| **Notion** | High | Docs/wiki, no pi extension exists |
| **Salesforce/CRM** | Medium | Enterprise differentiator |
| **Figma** | Low | Design handoff |
| **Kubernetes/AWS CLIs** | Low | Bundle binaries, zero code |

---

## Roadmap Phases

### Phase 1: Core Polish (Weeks 1–4)

**Goal:** Make the existing experience rock-solid before adding features.

| # | Task | Status | Effort |
|---|------|--------|--------|
| 1.1 | Streaming robustness — eliminate blank flashes on rapid send/abort | ✅ Done (#309) | — |
| 1.2 | Error recovery — pi crash → graceful retry with clear error UI | ✅ Done (#309) | — |
| 1.3 | Session persistence — survive app restart, proper timestamps | ✅ Done | — |
| 1.4 | Slash commands — built-in registry + command palette | ✅ Done (#324) | — |
| 1.5 | Windows compatibility — bundled Node.js, long-path fix, OAuth quoting | ✅ Done (#327) | — |
| 1.6 | Model selector polish — controlled open, per-session override | ✅ Done (#324) | — |
| 1.7 | Empty state redesign — centered input, deterministic greeting | ✅ Done (#310) | — |
| 1.8 | Font scale / zoom — Large/Extra-Large without overflow | ✅ Done (#313) | — |
| 1.9 | Conversation search — deep content search across all sessions | ⏳ Partial | 1 day |
| 1.10 | Drag & drop — file preview chips, image paste thumbnails | ⏳ Partial | 2 days |

### Phase 2: Extensions Ecosystem (Weeks 5–10)

**Goal:** Turn Zosma Cowork into a platform. Ship the top 3 missing integrations.

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 2.1 | **`@zosmaai/pi-jira`** — search, create, update, transition, comment, sprint mgmt | 🔴 High | 1 week |
| 2.2 | **`@zosmaai/pi-github`** — issues, PRs, Projects v2, Actions, releases | 🔴 High | 3 days (bundle `gh`) |
| 2.3 | **`@zosmaai/pi-notion`** — search, read, create, update pages + databases | 🔴 High | 3 days |
| 2.4 | Messenger setup wizard — guided Discord/Slack/Telegram/WhatsApp onboarding | 🟡 Med | 2 days |
| 2.5 | `@zosmaai/pi-slack-ops` — search messages, manage channels, user profiles | 🟡 Med | 2 days |
| 2.6 | `@zosmaai/pi-teams` — messages, channels, meetings via Microsoft Graph | 🟡 Med | 3 days |
| 2.7 | `@zosmaai/pi-postgres` — query, schema inspect (wrap `pg` npm) | 🟢 Low | 1 day |
| 2.8 | `@zosmaai/pi-sentry` — issue search, release tracking | 🟢 Low | 1 day |
| 2.9 | Extension config validation — schema-based form validation in Settings | 🟡 Med | 2 days |
| 2.10 | Extension auto-update — check for updates, notify user | 🟢 Low | 1 day |

**Extension strategy:**
- Don't fork existing pi extensions — pin tested versions, contribute upstream
- Build new integrations under `@zosmaai/` npm scope
- Keep vendored (Google Workspace, Gmail, Calendar) for broker-aware auth
- CLI bundling (gh, kubectl, psql) where possible — zero maintenance

### Phase 3: Design Studio (Weeks 11–16)

**Goal:** Absorb Open Design's capabilities natively — prototype, deck, template generation.

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 3.1 | Skill absorption — port Open Design SKILL.md files into cowork skills | 🔴 High | 2 days |
| 3.2 | DESIGN.md schema — 9-section brand contract as a skill format | 🔴 High | 1 day |
| 3.3 | Craft references — typography, color, anti-AI-slop rules as injected context | 🟡 Med | 1 day |
| 3.4 | Prompt composition — sidecar composes DESIGN.md + craft + skill body | 🟡 Med | 2 days |
| 3.5 | Artifact preview polish — live reload, comment mode, slider controls | 🟡 Med | 3 days |
| 3.6 | Export pipeline — HTML/PDF/PPTX from preview iframe | 🟡 Med | 2 days |
| 3.7 | Design system gallery — browse 68+ brand templates | 🟢 Low | 1 day |

**Key insight:** Open Design has no proprietary engine. It spawns a coding agent CLI and feeds it a composed prompt. Cowork can do the same natively — absorb the content (skills, DESIGN.md, craft), not the daemon.

### Phase 4: Mobile Unification (Weeks 17–20)

**Goal:** One React app serves both desktop and phone. Kill the vanilla `mobile/index.html` fork.

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 4.1 | PWA manifest — service worker, "Add to Home Screen", splash screen | 🔴 High | 1 hour |
| 4.2 | Responsive layout — `App.tsx` mobile breakpoints, bottom nav, slide-over sidebar | 🔴 High | 3 days |
| 4.3 | Delete `mobile/index.html` — unified React build | 🔴 High | 0.5 days |
| 4.4 | Touch-friendly composer — larger send button, voice button, emoji | 🟡 Med | 2 days |
| 4.5 | Pull-to-refresh — session list, message history | 🟡 Med | 1 day |
| 4.6 | Connection status bar — connected/disconnected indicator, auto-reconnect | 🟡 Med | 1 day |
| 4.7 | Tailscale detection + docs — show Tailscale IP in Remote Access panel | 🟢 Low | 0.5 days |
| 4.8 | Security audit — PIN pairing, HTTPS, rate limiting, CORS | 🔴 High | 2 days |

### Phase 5: Office Documents (Weeks 21–24)

**Goal:** Professional DOCX/PPTX/XLSX creation via natural language. Already partially shipped.

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 5.1 | OfficeCLI auto-install — detect, download to `~/.zosmaai/cowork/bin/` | ✅ Done (#315) | — |
| 5.2 | pi tool wrappers — create, add, set, remove, view, batch, watch, validate | ✅ Done | — |
| 5.3 | Design rules — color palettes, typography, layout variation as skill files | ⏳ Partial | 2 days |
| 5.4 | Documents right-panel — recent docs, preview thumbnails, quick actions | ⏳ Partial | 2 days |
| 5.5 | Template packs — startup pitch, business report, proposal, academic | 🟡 Med | 3 days |
| 5.6 | Agent prompt augmentation — Document Generation capability block in system prompt | 🟡 Med | 1 day |
| 5.7 | QA loop — preview → detect issues → fix cycle for layout quality | 🟢 Low | 2 days |

### Phase 6: Distribution & Scale (Weeks 25–28)

**Goal:** Professional distribution, code signing, app store presence.

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 6.1 | macOS code signing — Apple Developer cert, notarization | 🔴 High | 1 day |
| 6.2 | Windows EV code signing — eliminate SmartScreen warnings | 🔴 High | 1 day + cert cost |
| 6.3 | Homebrew tap automation — auto-update on release | ✅ Done | — |
| 6.4 | Winget manifest automation — PR to microsoft/winget-pkgs | ✅ Done | — |
| 6.5 | Flatpak / Snap packaging | 🟢 Low | 2 days |
| 6.6 | Chocolatey / Scoop (Windows) | 🟢 Low | 1 day |
| 6.7 | MSIX packaging — Microsoft Store | 🟡 Med | 2 days |
| 6.8 | Crash reporting — Sentry integration, opt-in telemetry | 🟡 Med | 2 days |
| 6.9 | Documentation site — user guide, developer docs, extension authoring guide | 🟡 Med | 3 days |
| 6.10 | Public launch — Product Hunt, HN, dev.to, pi Discord | 🟡 Med | 1 day |

---

## Competitive Positioning

```
                    Desktop AI Agent Landscape

    Coding Focus ◄──────────────────────────────► Workflow Hub
         │                                           │
         │  Cursor / Windsurf                        │
         │  (coding only, no integrations)           │
         │                                           │
         │         pi CLI (terminal)                 │
         │                                           │
         │  Hermes Desktop                           │
         │  (Python gateway, ~250MB, 16 platforms)   │
         │                                           │
         │              ★ Zosma Cowork ★             │
         │  (Tauri native, ~50MB, extensible)        │
         │                                           │
         │                         Slack AI          │
         │                         Notion AI         │
         │                         (SaaS-only)       │
```

**Zosma Cowork occupies:** Native desktop workflow hub — coding + integrations + messaging, all in a lightweight Tauri shell.

**vs Hermes Desktop:** Lighter (50MB vs 250MB), faster (in-process SDK vs HTTP gateway), more extensible (npm packages vs Python plugins). Hermes wins on built-in messaging breadth (16 vs 5 platforms) but the gap is narrowing via `pi-messenger-bridge`.

**vs Cursor/Windsurf:** Not a coding-only tool. Connects to Jira, Notion, Slack, Google Workspace, Office docs. Workflow hub, not just code editor.

**vs Slack AI / Notion AI:** Desktop native, local-first, multi-tool. Not locked to one SaaS vendor.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Zosma Cowork (Tauri v2)                     │
├─────────────────────────────────────────────────────────────┤
│  Rust Backend (src-tauri/src/lib.rs)                        │
│  ├── SidecarState — stdin handle to Node sidecar            │
│  ├── Tauri IPC handlers — invoke("save_settings", ...)     │
│  ├── Channel<Value> — streaming events to renderer          │
│  └── Skills mgmt — walkdir scan of ~/.zosmaai/skills/      │
├─────────────────────────────────────────────────────────────┤
│  Node.js Agent Sidecar (agent-sidecar/, ~4200 lines)        │
│  ├── Protocol: stdin JSON lines → stdout JSON lines         │
│  ├── pi-mono SDK — @earendil-works/pi-coding-agent          │
│  ├── Session mgmt — load/save/list JSONL sessions           │
│  ├── Provider routing — model selection, auth, streaming    │
│  ├── Extensions — npm packages + vendored factories         │
│  ├── OfficeCLI — DOCX/PPTX/XLSX creation                   │
│  ├── Google Workspace — Gmail, Calendar, Drive               │
│  └── Bundled binaries — node, git, gh                        │
├─────────────────────────────────────────────────────────────┤
│  React Frontend (src/, Tailwind CSS)                        │
│  ├── App.tsx — Screen routing, session management           │
│  ├── chat/ChatView — Main chat interface                    │
│  ├── components/ — 40+ components                           │
│  ├── hooks/ — usePiStream, useAuth, useProviders            │
│  └── Tauri API — invoke(), listen(), Channel                │
├─────────────────────────────────────────────────────────────┤
│  Communication: React ↔ Rust (Tauri IPC) ↔ Node (stdin/out)│
│  Agent: pi SDK runs in-process in Node sidecar              │
│  Storage: ~/.zosmaai/cowork/sessions/*.jsonl                │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Decisions (Locked In)

| Decision | Rationale |
|----------|-----------|
| **Tauri over Electron** | Native shell, ~50MB vs ~250MB, lower memory, Rust backend |
| **Pi SDK as agent core** | In-process TypeScript SDK, no HTTP gateway overhead |
| **Don't fork pi extensions** | Pi moves fast (230+ contributors). Pin versions, contribute upstream |
| **Build @zosmaai extensions** | Jira, GitHub, Notion — integrations that don't exist in pi ecosystem |
| **CLI bundling strategy** | Ship gh, kubectl, psql binaries. Zero maintenance, CLI handles auth/versions |
| **Absorb Open Design** | No proprietary engine — absorb skills/DESIGN.md/craft, not the daemon |
| **One React app** | Desktop + mobile from same build. Kill vanilla mobile/index.html fork |
| **JSONL session storage** | Simple, git-reviewable, no SQLite dependency. Sufficient for desktop |

---

## Open Questions

1. **SQLite for sessions?** JSONL works but search is O(n). SQLite would fix that. Tradeoff: adds a native dependency.
2. **Native companion app?** React Native wrapper for iOS/Android? Or is PWA sufficient?
3. **Community extension marketplace?** npm registry as the marketplace, or build a curated store?
4. **Built-in relay server?** For phone access without Tailscale/ngrok. Requires a VPS or Cloudflare Worker.
5. **Rust-native pi SDK?** Would enable Mac App Store. Currently Node.js sidecar blocks MAS due to spawned process.

---

*This document is a living artifact. Update as decisions are made and priorities shift.*
