<div align="center">

# Zosma Cowork 🇮🇳

<img src="./assets/zosma-cowork-logo.png" alt="Zosma Cowork" width="200" />

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | **Deutsch** | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/zosmaai/zosma-cowork?label=release&color=success)](https://github.com/zosmaai/zosma-cowork/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white)](https://discord.gg/c5vadsv9)
[![GitHub Repo Stars](https://img.shields.io/github/stars/zosmaai/zosma-cowork?style=social)](https://github.com/zosmaai/zosma-cowork/stargazers)

</div>

<br/>

<div align="center">
  <a href="https://github.com/zosmaai/zosma-cowork/stargazers">
    <img src="./assets/thank-you-for-the-star.png" alt="Thank you for starring Zosma Cowork!" width="100%" />
  </a>
  <br/>
  <sub>
    If you find Zosma Cowork useful,
    <a href="https://github.com/zosmaai/zosma-cowork">⭐ star the repo</a> —
    it lets us know we're building something that matters.
  </sub>
</div>

<br/>

> Ein Desktop-Agentic-Work-Harness basierend auf [pi](https://github.com/earendil-works/pi-coding-agent), dem minimalen, sprachunabhängigen Coding-Agent-Harness. Streaming, Denkprozesse, Tool-Aufrufe, Multi-Turn-Sitzungen — alles kostenlos, Open-Source und lokal.
>
> Entwickelt von [Zosma AI](https://zosma.ai).

## Gallery

<img src="./assets/demo.gif" width="100%" alt="Zosma Cowork demo" />

<img src="./assets/screenshot.png" width="100%" alt="Zosma Cowork screenshot" />

*Invoice processing with natural language agents. See more demos at [zosma.ai/zosma-cowork/gallery](https://www.zosma.ai/zosma-cowork/gallery)*

## Warum Zosma Cowork?

### 🌟 Basierend auf pi

Zosma Cowork ist eine Desktop-Anwendung, die auf [pi](https://github.com/earendil-works/pi-coding-agent) basiert — dem minimalen, sprachunabhängigen Coding-Agent-Harness. Jede pi-Erweiterung funktioniert direkt ohne Wrapper oder Adapter.

### 🆓 Kostenlos & Open Source

Zosma Cowork ist **100% kostenlos und Open Source** (MIT). Bring deinen eigenen API-Schlüssel mit oder verwende lokale Modelle — du behältst die Kontrolle.

### 🧩 Vollständiges pi-Erweiterungs-Ökosystem

Das [pi-Ökosystem](https://github.com/earendil-works/pi-coding-agent) umfasst hunderte Erweiterungen, Fähigkeiten, Tools, Prompts und Themes — alle kompatibel mit Zosma Cowork. Einfach in `~/.zosmaai/cowork/` ablegen und sie funktionieren sofort.

## Funktionen
- **Node.js Agent Sidecar** — Das pi-mono TypeScript SDK läuft in einem verwalteten Sidecar-Prozess für vollständige Agentenfähigkeiten
- **Schlanker Tauri Relay** — Die Rust-Ebene ist eine minimale IPC-Brücke zwischen React und dem Sidecar
- **pi-Erweiterungs-Ökosystem** — Kompatibel mit pi-Erweiterungen über `DefaultResourceLoader` — Fähigkeiten, Tools und Prompts werden automatisch erkannt
- **Multi-Turn-Sitzungen** — Vollständige Gesprächskontinuität mit persistentem Sitzungsverlauf
- **Streaming-Antworten** — Sieh dem Agenten in Echtzeit beim Denken, Schreiben und Tool-Aufrufen zu
- **Denkblöcke** — Erweiterbare Überlegungen des Modells
- **Tool-Aufruf-Zeitleiste** — Live bash/edit/write Tool-Aufrufe mit Argumenten und Ergebnissen
- **Sitzungsverwaltung** — Persistente Chat-Sitzungen gespeichert in `~/.zosmaai/cowork/`
- **Helles & dunkles Design** — Warmes Cremeweiß und warmer Holzkohle-Dunkelmodus
- **Tastaturkürzel** — `Cmd/Ctrl+Shift+K` zum Fokussieren, `Cmd/Ctrl+N` für neue Sitzung
- **Abbrechen & Steuern** — Stoppe einen laufenden Agenten, sende Follow-Up-Steuerungsnachrichten
- **Claude-inspiriertes UI** — 3-Spalten-Layout mit Seitenleiste, Arbeitsbereich und Infopanel

## Architektur

<img src="./assets/architecture.png" width="100%" alt="Zosma Cowork architecture diagram" />

<details>
<summary>Dieses Diagramm bearbeiten</summary>

Das Diagramm wird aus <code>assets/architecture.mmd</code> generiert. Zum Aktualisieren:

```bash
# Edit assets/architecture.mmd, then re-render:
mmdc -i assets/architecture.mmd -o assets/architecture.png -b white -w 900 -H 700
```
</details>

## Technologie-Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4, Radix UI |
| Desktop-Shell | Tauri v2, Rust, Tokio |
| Agenten-Engine | Node.js Sidecar — `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| Tests | Vitest, Testing Library, jsdom |
| Linting | Biome (Frontend), Clippy (Rust) |

## Entwicklung

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (für Tauri Desktop-Shell)

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

## Konfiguration & Daten

| Was | Ort | Hinweise |
|------|----------|-------|
| LLM-Anbieter & API-Schlüssel | `~/.zosmaai/cowork/auth.json` | Von der App verwaltet |
| Modelldefinitionen | `~/.zosmaai/cowork/models.json` | Von der App verwaltet |
| Erweiterungen & Skills | `~/.zosmaai/cowork/extensions/` | Pi-kompatible Erweiterungen |
| Sitzungsverlauf | `~/.zosmaai/cowork/` | Von Zosma Cowork verwaltet |

## IPC-Protokoll

Der Tauri-Relay kommuniziert mit dem Node.js-Sidecar über stdin/stdout JSON-Zeilen:

**Befehle (→ Sidecar):**

| Command | Description |
|---------|-------------|
| `init` | Agent mit zosmaDir-Konfiguration initialisieren |
| `get_models` | Verfügbare Modelle auflisten |
| `prompt` | Benutzernachricht senden, Ereignisse streamen |
| `abort` | Laufenden Prompt abbrechen |
| `set_model` | Aktives Modell wechseln |
| `save_auth` | API-Schlüssel für Anbieter speichern |
| `reload` | Mit neuen Erweiterungen/Authentifizierung neu initialisieren |

**Ereignisse (← Sidecar):**

| Event | UI Effect |
|-------|-----------|
| `ready` | Modelle geladen, UI aktivieren |
| `event` | Agenten-Sitzungsereignisse (Denken, Text, Tool-Aufrufe) |
| `done` | Prompt abgeschlossen |
| `result` | Antwort auf einen Befehl |
| `error` | Fehler mit Nachricht |

## Projektstruktur

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

---

## Star History

<a href="https://star-history.com/#zosmaai/zosma-cowork&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=zosmaai/zosma-cowork&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=zosmaai/zosma-cowork&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=zosmaai/zosma-cowork&type=Date" width="100%" />
  </picture>
</a>

## Contributors

<a href="https://github.com/zosmaai/zosma-cowork/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=zosmaai/zosma-cowork" alt="Contributors" />
</a>

---

## 🇮🇳 Hergestellt in Indien

**Zosma Cowork** — entwickelt **in Indien** von **ZOSMAAI SOLUTIONS PRIVATE LIMITED**.

## Lizenz

MIT © [Zosma AI](https://zosma.ai)
