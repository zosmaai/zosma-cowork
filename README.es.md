<div align="center">

# Zosma Cowork 🇮🇳

<img src="./assets/zosma-cowork-logo.png" alt="Zosma Cowork" width="200" />

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | **Español** | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

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

> Un arnés de trabajo agéntico de escritorio construido sobre [pi](https://github.com/earendil-works/pi-coding-agent), el arnés de agente de codificación mínimo y agnóstico al lenguaje. Streaming, pensamiento, llamadas a herramientas, sesiones multi-turno — todo gratuito, todo código abierto, todo local.
>
> Construido por [Zosma AI](https://zosma.ai).

## Gallery

<img src="./assets/demo.gif" width="100%" alt="Zosma Cowork demo" />

<img src="./assets/screenshot.png" width="100%" alt="Zosma Cowork screenshot" />

*Invoice processing with natural language agents. See more demos at [zosma.ai/zosma-cowork/gallery](https://www.zosma.ai/zosma-cowork/gallery)*

## ¿Por qué Zosma Cowork?

### 🌟 Construido sobre pi

Zosma Cowork es una aplicación de escritorio construida sobre [pi](https://github.com/earendil-works/pi-coding-agent) — el arnés de agente de codificación mínimo y agnóstico al lenguaje. Cada extensión de pi funciona directamente, sin envoltorios ni adaptadores.

### 🆓 Gratuito y Código Abierto

Zosma Cowork es **100% gratuito y de código abierto** (MIT). Trae tu propia clave API o usa modelos locales — tú mantienes el control.

### 🧩 Ecosistema Completo de Extensiones pi

El [ecosistema pi](https://github.com/earendil-works/pi-coding-agent) incluye cientos de extensiones, habilidades, herramientas, prompts y temas — todos compatibles con Zosma Cowork. Colócalos en tu directorio `~/.zosmaai/cowork/` y funcionan al instante.

## Características
- **Sidecar de agente Node.js** — El SDK pi-mono TypeScript se ejecuta en un proceso sidecar gestionado para capacidades completas de agente
- **Relé Tauri ligero** — La capa Rust es un puente IPC mínimo entre React y el sidecar
- **Ecosistema de extensiones pi** — Compatible con extensiones pi a través de `DefaultResourceLoader` — habilidades, herramientas y prompts auto-descubiertos
- **Sesiones multi-turno** — Continuidad completa de conversación con historial persistente
- **Respuestas en streaming** — Ve al agente pensar, escribir y llamar herramientas en tiempo real
- **Bloques de pensamiento** — Razonamiento expandible del modelo
- **Línea de tiempo de llamadas a herramientas** — Llamadas en vivo bash/edit/write con argumentos y resultados
- **Gestión de sesiones** — Sesiones de chat persistentes guardadas en `~/.zosmaai/cowork/`
- **Modo claro y oscuro** — Modo claro crema cálido, modo oscuro carbón cálido
- **Atajos de teclado** — `Cmd/Ctrl+Shift+K` para enfocar, `Cmd/Ctrl+N` para nueva sesión
- **Abortar y dirigir** — Detén un agente en ejecución, envía mensajes de seguimiento
- **UI inspirada en Claude** — Diseño de 3 columnas con barra lateral, espacio de trabajo y panel de información

## Arquitectura

<img src="./assets/architecture.png" width="100%" alt="Zosma Cowork architecture diagram" />

<details>
<summary>Editar este diagrama</summary>

El diagrama se genera desde <code>assets/architecture.mmd</code>. Para actualizar:

```bash
# Edit assets/architecture.mmd, then re-render:
mmdc -i assets/architecture.mmd -o assets/architecture.png -b white -w 900 -H 700
```
</details>

## Stack Tecnológico

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4, Radix UI |
| Shell de escritorio | Tauri v2, Rust, Tokio |
| Motor de agente | Sidecar Node.js — `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| Pruebas | Vitest, Testing Library, jsdom |
| Linting | Biome (frontend), Clippy (Rust) |

## Desarrollo

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (para el shell Tauri)

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

## Configuración y Datos

| Qué | Ubicación | Notas |
|------|----------|-------|
| Proveedores LLM y claves API | `~/.zosmaai/cowork/auth.json` | Gestionado por la app |
| Definiciones de modelo | `~/.zosmaai/cowork/models.json` | Gestionado por la app |
| Extensiones y habilidades | `~/.zosmaai/cowork/extensions/` | Extensiones compatibles con Pi |
| Historial de sesiones | `~/.zosmaai/cowork/` | Gestionado por Zosma Cowork |

## Protocolo IPC

El relé Tauri se comunica con el sidecar Node.js a través de líneas JSON stdin/stdout:

**Comandos (→ sidecar):**

| Command | Description |
|---------|-------------|
| `init` | Inicializar agente con configuración zosmaDir |
| `get_models` | Listar modelos disponibles de todos los proveedores |
| `prompt` | Enviar mensaje de usuario, transmitir eventos |
| `abort` | Cancelar prompt en ejecución |
| `set_model` | Cambiar modelo activo |
| `save_auth` | Guardar clave API para un proveedor |
| `reload` | Reinicializar con extensiones/auth frescas |

**Eventos (← sidecar):**

| Event | UI Effect |
|-------|-----------|
| `ready` | Modelos cargados, habilitar UI |
| `event` | Eventos de sesión del agente (pensamiento, texto, llamadas a herramientas) |
| `done` | Prompt completado |
| `result` | Respuesta a un comando de solicitud |
| `error` | Error con mensaje |

## Estructura del Proyecto

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

## 🇮🇳 Hecho en India

**Zosma Cowork** — construido **desde India** por **ZOSMAAI SOLUTIONS PRIVATE LIMITED**.

## Licencia

MIT © [Zosma AI](https://zosma.ai)
