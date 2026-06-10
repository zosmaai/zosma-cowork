<div align="center">

# Zosma Cowork 🇮🇳

<img src="./assets/zosma-cowork-logo.png" alt="Zosma Cowork" width="200" />

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | **Русский** | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

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

> Рабочая среда для ИИ-агентов на рабочем столе, построенная на [pi](https://github.com/earendil-works/pi-coding-agent) — минимальной, языконезависимой среде для кодинга. Стриминг, размышления, вызовы инструментов, многопоточные сессии — всё бесплатно, с открытым исходным кодом, локально.
>
> Создано [Zosma AI](https://zosma.ai).

## Gallery

<img src="./assets/demo.gif" width="100%" alt="Zosma Cowork demo" />

<img src="./assets/screenshot.png" width="100%" alt="Zosma Cowork screenshot" />

*Invoice processing with natural language agents. See more demos at [zosma.ai/zosma-cowork/gallery](https://www.zosma.ai/zosma-cowork/gallery)*

## Почему Zosma Cowork?

### 🌟 Построено на pi

Zosma Cowork — это десктопное приложение, построенное на [pi](https://github.com/earendil-works/pi-coding-agent) — минимальной, языконезависимой среде для кодинга. Каждое расширение pi работает напрямую, без обёрток или адаптеров.

### 🆓 Бесплатно и с открытым исходным кодом

Zosma Cowork — **100% бесплатно и с открытым исходным кодом** (MIT). Используйте свой API-ключ или локальные модели — вы всё контролируете.

### 🧩 Полная экосистема расширений pi

[Экосистема pi](https://github.com/earendil-works/pi-coding-agent) включает сотни расширений, навыков, инструментов, промптов и тем — все совместимы с Zosma Cowork. Поместите их в каталог `~/.zosmaai/cowork/` и они заработают.

## Возможности
- **Node.js сайдкар агента** — SDK pi-mono TypeScript работает в управляемом процессе сайдкара для полных агентских возможностей
- **Лёгкое реле Tauri** — Слой Rust — минимальный IPC-мост между React и сайдкаром
- **Экосистема расширений pi** — Совместимость с расширениями pi через `DefaultResourceLoader` — навыки, инструменты и промпты自动обнаруживаются
- **Многопоточные сессии** — Полная непрерывность диалога с постоянной историей
- **Стриминг ответов** — Наблюдайте за агентом в реальном времени: размышления, написание, вызовы инструментов
- **Блоки размышлений** — Разворачиваемые рассуждения модели
- **Хронология вызовов инструментов** — Живые вызовы bash/edit/write с аргументами и результатами
- **Управление сессиями** — Постоянные чат-сессии, сохранённые в `~/.zosmaai/cowork/`
- **Светлый и тёмный режимы** — Тёплый кремовый светлый и тёплый угольный тёмный режимы
- **Горячие клавиши** — `Cmd/Ctrl+Shift+K` для фокуса, `Cmd/Ctrl+N` для новой сессии
- **Прерывание и управление** — Остановите работающего агента, отправьте уточняющие сообщения
- **UI в стиле Claude** — 3-колоночный макет с боковой панелью, рабочей областью и информационной панелью

## Архитектура

<img src="./assets/architecture.png" width="100%" alt="Zosma Cowork architecture diagram" />

<details>
<summary>Редактировать диаграмму</summary>

Диаграмма создаётся из <code>assets/architecture.mmd</code>. Чтобы обновить:

```bash
# Edit assets/architecture.mmd, then re-render:
mmdc -i assets/architecture.mmd -o assets/architecture.png -b white -w 900 -H 700
```
</details>

## Технологический стек

| Layer | Technology |
|-------|-----------|
| Фронтенд | React 19, Tailwind CSS v4, Radix UI |
| Десктопная оболочка | Tauri v2, Rust, Tokio |
| Движок агента | Node.js сайдкар — `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| Тестирование | Vitest, Testing Library, jsdom |
| Линтинг | Biome (фронтенд), Clippy (Rust) |

## Разработка

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (для десктопной оболочки Tauri)

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

## Конфигурация и данные

| Что | Расположение | Примечания |
|------|----------|-------|
| LLM-провайдеры и API-ключи | `~/.zosmaai/cowork/auth.json` | Управляется приложением |
| Определения моделей | `~/.zosmaai/cowork/models.json` | Управляется приложением |
| Расширения и навыки | `~/.zosmaai/cowork/extensions/` | Pi-совместимые расширения |
| История сессий | `~/.zosmaai/cowork/` | Управляется Zosma Cowork |

## IPC-протокол

Реле Tauri общается с Node.js сайдкаром через строки JSON в stdin/stdout:

**Команды (→ сайдкар):**

| Command | Description |
|---------|-------------|
| `init` | Инициализация агента с конфигурацией zosmaDir |
| `get_models` | Список доступных моделей |
| `prompt` | Отправка сообщения пользователя, стриминг событий |
| `abort` | Отмена выполняемого промпта |
| `set_model` | Переключение активной модели |
| `save_auth` | Сохранение API-ключа для провайдера |
| `reload` | Переинициализация с новыми расширениями/авторизацией |

**События (← сайдкар):**

| Event | UI Effect |
|-------|-----------|
| `ready` | Модели загружены, UI активен |
| `event` | События сессии агента (размышления, текст, вызовы инструментов) |
| `done` | Промпт завершён |
| `result` | Ответ на команду запроса |
| `error` | Ошибка с сообщением |

## Структура проекта

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

## 🇮🇳 Сделано в Индии

**Zosma Cowork** — создано **в Индии** компанией **ZOSMAAI SOLUTIONS PRIVATE LIMITED**.

## Лицензия

MIT © [Zosma AI](https://zosma.ai)
