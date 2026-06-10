<div align="center">

# Zosma Cowork 🇮🇳

<img src="./assets/zosma-cowork-logo.png" alt="Zosma Cowork" width="200" />

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | **日本語** | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

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

> 最小限の言語非依存型コーディングエージェントハーネスである [pi](https://github.com/earendil-works/pi-coding-agent) 上に構築されたデスクトップエージェンティックワークハーネス。ストリーミング、思考、ツール呼び出し、マルチターンセッション — すべて無料、オープンソース、ローカル。
>
> [Zosma AI](https://zosma.ai) によって開発。

## Gallery

<img src="./assets/demo.gif" width="100%" alt="Zosma Cowork demo" />

<img src="./assets/screenshot.png" width="100%" alt="Zosma Cowork screenshot" />

*Invoice processing with natural language agents. See more demos at [zosma.ai/zosma-cowork/gallery](https://www.zosma.ai/zosma-cowork/gallery)*

## Zosma Cowork を選ぶ理由

### 🌟 pi 上に構築

Zosma Cowork は [pi](https://github.com/earendil-works/pi-coding-agent) 上に構築されたデスクトップアプリケーションです — 最小限の言語非依存型コーディングエージェントハーネス。すべての pi 拡張機能がラッパーやアダプターなしでそのまま動作します。

### 🆓 無料＆オープンソース

Zosma Cowork は **100% 無料でオープンソース** (MIT) です。独自の API キーを使用するか、ローカルモデルを実行 — あなたがコントロールします。

### 🧩 完全な pi 拡張エコシステム

[pi エコシステム](https://github.com/earendil-works/pi-coding-agent) には数百の拡張機能、スキル、ツール、プロンプト、テーマが含まれています — すべて Zosma Cowork と互換性があります。`~/.zosmaai/cowork/` ディレクトリに配置するだけで動作します。

## 機能
- **Node.js エージェントサイドカー** — pi-mono TypeScript SDK が管理対象のサイドカープロセスで実行され、完全なエージェント機能を提供
- **軽量 Tauri リレー** — Rust レイヤーは React とサイドカー間の最小限の IPC ブリッジ
- **pi 拡張エコシステム** — `DefaultResourceLoader` 経由で pi 拡張と互換性あり — スキル、ツール、プロンプトが自動検出
- **マルチターンセッション** — 永続的なセッション履歴による完全な会話の継続性
- **ストリーミング応答** — エージェントの思考、執筆、ツール呼び出しをリアルタイムで確認
- **思考ブロック** — モデルの展開可能な推論
- **ツール呼び出しタイムライン** — 引数と結果付きのライブ bash/edit/write ツール呼び出し
- **セッション管理** — `~/.zosmaai/cowork/` に保存された永続的なチャットセッション
- **ライト＆ダークモード** — 温かみのあるクリームのライトモードとチャコールのダークモード
- **キーボードショートカット** — フォーカスは `Cmd/Ctrl+Shift+K`、新規セッションは `Cmd/Ctrl+N`
- **中断と誘導** — 実行中のエージェントを途中で停止、フォローアップメッセージを送信
- **Claude 風 UI** — サイドバー、ワークスペース、情報パネルの3カラムレイアウト

## アーキテクチャ

<img src="./assets/architecture.png" width="100%" alt="Zosma Cowork architecture diagram" />

<details>
<summary>この図を編集</summary>

この図は <code>assets/architecture.mmd</code> から生成されています。更新方法：

```bash
# Edit assets/architecture.mmd, then re-render:
mmdc -i assets/architecture.mmd -o assets/architecture.png -b white -w 900 -H 700
```
</details>

## 技術スタック

| Layer | Technology |
|-------|-----------|
| フロントエンド | React 19, Tailwind CSS v4, Radix UI |
| デスクトップシェル | Tauri v2, Rust, Tokio |
| エージェントエンジン | Node.js サイドカー — `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| テスト | Vitest, Testing Library, jsdom |
| リンター | Biome (フロントエンド), Clippy (Rust) |

## 開発

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (Tauri デスクトップシェル用)

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

## 設定とデータ

| 項目 | 場所 | 備考 |
|------|----------|-------|
| LLM プロバイダーと API キー | `~/.zosmaai/cowork/auth.json` | アプリが管理 |
| モデル定義 | `~/.zosmaai/cowork/models.json` | アプリが管理 |
| 拡張機能とスキル | `~/.zosmaai/cowork/extensions/` | Pi 互換拡張機能 |
| セッション履歴 | `~/.zosmaai/cowork/` | Zosma Cowork が管理 |

## IPC プロトコル

Tauri リレーは stdin/stdout JSON 行を介して Node.js サイドカーと通信します：

**コマンド（→ サイドカー）：**

| Command | Description |
|---------|-------------|
| `init` | zosmaDir 設定でエージェントを初期化 |
| `get_models` | 利用可能なモデルを一覧表示 |
| `prompt` | ユーザーメッセージを送信、イベントをストリーミング |
| `abort` | 実行中のプロンプトをキャンセル |
| `set_model` | アクティブなモデルを切り替え |
| `save_auth` | プロバイダーの API キーを保存 |
| `reload` | 新しい拡張機能/認証で再初期化 |

**イベント（← サイドカー）：**

| Event | UI Effect |
|-------|-----------|
| `ready` | モデル読み込み完了、UI 有効化 |
| `event` | エージェントセッションイベント（思考、テキスト、ツール呼び出し） |
| `done` | プロンプト完了 |
| `result` | リクエストコマンドへの応答 |
| `error` | エラーメッセージ |

## プロジェクト構造

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

## 🇮🇳 インド製

**Zosma Cowork** — **インド**で **ZOSMAAI SOLUTIONS PRIVATE LIMITED** によって開発。

## ライセンス

MIT © [Zosma AI](https://zosma.ai)
