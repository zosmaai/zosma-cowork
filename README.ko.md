<div align="center">

# Zosma Cowork 🇮🇳

<img src="./assets/zosma-cowork-logo.png" alt="Zosma Cowork" width="200" />

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | **한국어** | <a href="./README.hi.md">हिंदी</a>

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

> 최소한의 언어에 구애받지 않는 코딩 에이전트 하니스인 [pi](https://github.com/earendil-works/pi-coding-agent) 위에 구축된 데스크톱 에이전틱 워크 하니스입니다. 스트리밍, 사고, 도구 호출, 다중 턴 세션 — 모두 무료, 오픈소스, 로컬에서 작동합니다.
>
> [Zosma AI](https://zosma.ai) 제공.

## Gallery

<img src="./assets/demo.gif" width="100%" alt="Zosma Cowork demo" />

<img src="./assets/screenshot.png" width="100%" alt="Zosma Cowork screenshot" />

*Invoice processing with natural language agents. See more demos at [zosma.ai/zosma-cowork/gallery](https://www.zosma.ai/zosma-cowork/gallery)*

## Zosma Cowork를 선택해야 하는 이유

### 🌟 pi 기반으로 구축

Zosma Cowork는 [pi](https://github.com/earendil-works/pi-coding-agent) 위에 구축된 데스크톱 애플리케이션입니다 — 최소한의 언어에 구애받지 않는 코딩 에이전트 하니스입니다. 모든 pi 확장 기능이 래퍼나 어댑터 없이 바로 작동합니다.

### 🆓 무료 및 오픈소스

Zosma Cowork는 **100% 무료이며 오픈소스** (MIT)입니다. 자체 API 키를 사용하거나 로컬 모델을 실행하세요 — 사용자가 제어합니다.

### 🧩 완전한 pi 확장 생태계

[pi 생태계](https://github.com/earendil-works/pi-coding-agent)에는 수백 개의 확장 기능, 스킬, 도구, 프롬프트 및 테마가 포함되어 있습니다 — 모두 Zosma Cowork와 호환됩니다. `~/.zosmaai/cowork/` 디렉토리에 넣으면 바로 작동합니다.

## 기능
- **Node.js 에이전트 사이드카** — pi-mono TypeScript SDK가 관리형 사이드카 프로세스에서 실행되어 완전한 에이전트 기능 제공
- **경량 Tauri 릴레이** — Rust 레이어는 React와 사이드카 간의 최소 IPC 브리지
- **pi 확장 생태계** — `DefaultResourceLoader`를 통해 pi 확장과 호환 — 스킬, 도구, 프롬프트 자동 검색
- **다중 턴 세션** — 영구 세션 기록으로 완전한 대화 연속성
- **스트리밍 응답** — 에이전트가 생각하고, 작성하고, 도구를 호출하는 것을 실시간으로 확인
- **사고 블록** — 모델의 확장 가능한 추론
- **도구 호출 타임라인** — 인수 및 결과와 함께 실시간 bash/edit/write 도구 호출
- **세션 관리** — `~/.zosmaai/cowork/`에 저장된 영구 채팅 세션
- **라이트 & 다크 모드** — 따뜻한 크림 라이트 모드, 따뜻한 차콜 다크 모드
- **키보드 단축키** — 포커스 `Cmd/Ctrl+Shift+K`, 새 세션 `Cmd/Ctrl+N`
- **중단 및 조종** — 실행 중인 에이전트 중단, 후속 조종 메시지 전송
- **Claude 영감 UI** — 사이드바, 작업 공간, 정보 패널이 있는 3열 레이아웃

## 아키텍처

<img src="./assets/architecture.png" width="100%" alt="Zosma Cowork architecture diagram" />

<details>
<summary>이 다이어그램 편집</summary>

이 다이어그램은 <code>assets/architecture.mmd</code>에서 생성됩니다. 업데이트 방법:

```bash
# Edit assets/architecture.mmd, then re-render:
mmdc -i assets/architecture.mmd -o assets/architecture.png -b white -w 900 -H 700
```
</details>

## 기술 스택

| Layer | Technology |
|-------|-----------|
| 프론트엔드 | React 19, Tailwind CSS v4, Radix UI |
| 데스크톱 셸 | Tauri v2, Rust, Tokio |
| 에이전트 엔진 | Node.js 사이드카 — `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| 테스트 | Vitest, Testing Library, jsdom |
| 린팅 | Biome (프론트엔드), Clippy (Rust) |

## 개발

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (Tauri 데스크톱 셸용)

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

## 구성 및 데이터

| 항목 | 위치 | 참고 |
|------|----------|-------|
| LLM 제공자 및 API 키 | `~/.zosmaai/cowork/auth.json` | 앱에서 관리 |
| 모델 정의 | `~/.zosmaai/cowork/models.json` | 앱에서 관리 |
| 확장 기능 및 스킬 | `~/.zosmaai/cowork/extensions/` | Pi 호환 확장 |
| 세션 기록 | `~/.zosmaai/cowork/` | Zosma Cowork에서 관리 |

## IPC 프로토콜

Tauri 릴레이는 stdin/stdout JSON 라인을 통해 Node.js 사이드카와 통신합니다:

**명령 (→ 사이드카):**

| Command | Description |
|---------|-------------|
| `init` | zosmaDir 설정으로 에이전트 초기화 |
| `get_models` | 사용 가능한 모든 모델 나열 |
| `prompt` | 사용자 메시지 전송, 이벤트 스트리밍 |
| `abort` | 실행 중인 프롬프트 취소 |
| `set_model` | 활성 모델 전환 |
| `save_auth` | 제공자용 API 키 저장 |
| `reload` | 새로운 확장/인증으로 다시 초기화 |

**이벤트 (← 사이드카):**

| Event | UI Effect |
|-------|-----------|
| `ready` | 모델 로드됨, UI 활성화 |
| `event` | 에이전트 세션 이벤트 (사고, 텍스트, 도구 호출) |
| `done` | 프롬프트 완료 |
| `result` | 요청 명령에 대한 응답 |
| `error` | 메시지와 함께 오류 |

## 프로젝트 구조

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

## 🇮🇳 인도 제작

**Zosma Cowork** — **ZOSMAAI SOLUTIONS PRIVATE LIMITED**에서 **인도에서** 개발.

## 라이선스

MIT © [Zosma AI](https://zosma.ai)
