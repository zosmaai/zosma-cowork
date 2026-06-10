<div align="center">

# Zosma Cowork 🇮🇳

<img src="./assets/zosma-cowork-logo.png" alt="Zosma Cowork" width="200" />

<a href="./README.md">English</a> | **中文** | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml)
[![Release](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml)
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

> 基于 [pi](https://github.com/earendil-works/pi-coding-agent) 构建的桌面智能体工作平台 — 轻量、语言无关的编码代理框架。流式传输、思维过程、工具调用、多轮会话 — 全部免费、开源、本地运行。
>
> 由 [Zosma AI](https://zosma.ai) 开发。

## Gallery

<img src="./assets/demo.gif" width="100%" alt="Zosma Cowork demo" />

<img src="./assets/screenshot.png" width="100%" alt="Zosma Cowork screenshot" />

*Invoice processing with natural language agents. See more demos at [zosma.ai/zosma-cowork/gallery](https://www.zosma.ai/zosma-cowork/gallery)*

## 为什么选择 Zosma Cowork？

### 🌟 基于 pi 构建

Zosma Cowork 是一个基于 [pi](https://github.com/earendil-works/pi-coding-agent) 构建的桌面应用 — 轻量、语言无关的编码智能体平台。每个 pi 扩展都可以直接使用，无需包装器或适配器。

### 🆓 免费开源

Zosma Cowork **100% 免费开源** (MIT)。带上你的 API 密钥或使用本地模型 — 完全由你掌控。

### 🧩 完整的 pi 扩展生态

[pi 生态](https://github.com/earendil-works/pi-coding-agent) 包含数百个扩展、技能、工具、提示和主题 — 全部与 Zosma Cowork 兼容。放入 `~/.zosmaai/cowork/` 目录即可直接使用。

## 功能特性
- **Node.js 代理侧车** — pi-mono TypeScript SDK 在托管侧车进程中运行，提供完整的代理能力（扩展、工具、提供商）
- **轻量 Tauri 中继** — Rust 层是 React 与侧车之间的最小 IPC 桥接，保持原生桌面壳的轻量化
- **pi 扩展生态** — 通过 `DefaultResourceLoader` 兼容 pi 扩展 — 技能、工具和提示自动从 `~/.zosmaai/cowork/` 发现
- **多轮会话** — 持久的会话历史确保对话连续性
- **流式响应** — 实时查看代理思考、写作和调用工具
- **思维块** — 可展开的模型推理过程
- **工具调用时间线** — 实时显示 bash/edit/write 工具调用及其参数和结果
- **会话管理** — 持久化聊天会话保存到 `~/.zosmaai/cowork/`
- **亮色与暗色模式** — 温暖的奶油色亮色模式和温暖的炭灰色暗色模式
- **键盘快捷键** — `Cmd/Ctrl+Shift+K` 聚焦，`Cmd/Ctrl+N` 新建会话
- **中止与引导** — 中途停止运行中的代理，发送后续引导消息
- **Claude 风格 UI** — 侧边栏、工作区和信息面板的三栏布局

## 架构

<img src="./assets/architecture.png" width="100%" alt="Zosma Cowork architecture diagram" />

<details>
<summary>编辑此图表</summary>

此图表由 <code>assets/architecture.mmd</code> 生成。更新方法：

```bash
# Edit assets/architecture.mmd, then re-render:
mmdc -i assets/architecture.mmd -o assets/architecture.png -b white -w 900 -H 700
```
</details>

## 技术栈

| Layer | Technology |
|-------|-----------|
| 前端 | React 19, Tailwind CSS v4, Radix UI |
| 桌面壳 | Tauri v2, Rust, Tokio |
| 代理引擎 | Node.js 侧车 — `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| 测试 | Vitest, Testing Library, jsdom |
| 代码检查 | Biome (前端), Clippy (Rust) |

## 开发

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (用于 Tauri 桌面壳)

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

## 配置与数据

| 项目 | 位置 | 说明 |
|------|----------|-------|
| LLM 提供商和 API 密钥 | `~/.zosmaai/cowork/auth.json` | 由应用管理 |
| 模型定义 | `~/.zosmaai/cowork/models.json` | 由应用管理 |
| 扩展和技能 | `~/.zosmaai/cowork/extensions/` | Pi 兼容扩展 |
| 会话历史 | `~/.zosmaai/cowork/` | 由 Zosma Cowork 管理 |

## IPC 协议

Tauri 中继通过 stdin/stdout JSON 行与 Node.js 侧车通信：

**命令（→ 侧车）：**

| Command | Description |
|---------|-------------|
| `init` | 使用 zosmaDir 配置初始化代理 |
| `get_models` | 列出所有可用模型 |
| `prompt` | 发送用户消息，流式传输事件 |
| `abort` | 取消正在运行的提示 |
| `set_model` | 切换活动模型 |
| `save_auth` | 保存提供商 API 密钥 |
| `reload` | 使用新的扩展/认证重新初始化 |

**事件（← 侧车）：**

| Event | UI Effect |
|-------|-----------|
| `ready` | 模型加载完成，启用 UI |
| `event` | 代理会话事件（思考、文本、工具调用） |
| `done` | 提示已完成 |
| `result` | 请求命令的响应 |
| `error` | 带消息的错误 |

## 项目结构

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

## 🇮🇳 印度制造

**Zosma Cowork** — 由 **ZOSMAAI SOLUTIONS PRIVATE LIMITED** 在 **印度** 开发。

## 许可证

MIT © [Zosma AI](https://zosma.ai)
