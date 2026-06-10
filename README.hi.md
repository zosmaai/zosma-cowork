<div align="center">

# Zosma Cowork 🇮🇳

<img src="./assets/zosma-cowork-logo.png" alt="Zosma Cowork" width="200" />

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | **हिंदी**

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

> एक डेस्कटॉप एजेंटिक वर्क हार्नेस जो [pi](https://github.com/earendil-works/pi-coding-agent) पर बनाया गया है — न्यूनतम, भाषा-अज्ञेय कोडिंग एजेंट हार्नेस। स्ट्रीमिंग, सोच, टूल कॉल, मल्टी-टर्न सेशन — सब मुफ्त, ओपन-सोर्स, लोकल।
>
> [Zosma AI](https://zosma.ai) द्वारा निर्मित।

## Gallery

<img src="./assets/demo.gif" width="100%" alt="Zosma Cowork demo" />

<img src="./assets/screenshot.png" width="100%" alt="Zosma Cowork screenshot" />

*Invoice processing with natural language agents. See more demos at [zosma.ai/zosma-cowork/gallery](https://www.zosma.ai/zosma-cowork/gallery)*

## क्यों Zosma Cowork?

### 🌟 pi पर निर्मित

Zosma Cowork एक डेस्कटॉप एप्लिकेशन है जो [pi](https://github.com/earendil-works/pi-coding-agent) पर बनाया गया है — न्यूनतम, भाषा-अज्ञेय कोडिंग एजेंट हार्नेस। हर pi एक्सटेंशन बिना किसी रैपर या एडॉप्टर के काम करता है।

### 🆓 मुफ्त और ओपन-सोर्स

Zosma Cowork **100% मुफ्त और ओपन-सोर्स** (MIT) है। अपनी API कुंजी लाएँ या लोकल मॉडल का उपयोग करें — आप नियंत्रण में हैं।

### 🧩 पूरा pi एक्सटेंशन इकोसिस्टम

[pi इकोसिस्टम](https://github.com/earendil-works/pi-coding-agent) में सैकड़ों एक्सटेंशन, स्किल, टूल, प्रॉम्प्ट और थीम शामिल हैं — सभी Zosma Cowork के साथ संगत। उन्हें अपने `~/.zosmaai/cowork/` डायरेक्टरी में रखें और वे काम करने लगते हैं।

## विशेषताएँ
- **Node.js एजेंट साइडकार** — pi-mono TypeScript SDK एक प्रबंधित साइडकार प्रक्रिया में चलता है, पूर्ण एजेंट क्षमताओं के लिए
- **थिन Tauri रिले** — Rust लेयर React और साइडकार के बीच एक न्यूनतम IPC ब्रिज है
- **pi एक्सटेंशन इकोसिस्टम** — `DefaultResourceLoader` के माध्यम से pi एक्सटेंशन के साथ संगत — स्किल, टूल और प्रॉम्प्ट स्वतः खोजे जाते हैं
- **मल्टी-टर्न सेशन** — लगातार सेशन इतिहास के साथ पूर्ण वार्तालाप निरंतरता
- **स्ट्रीमिंग प्रतिक्रियाएँ** — एजेंट को सोचते, लिखते और टूल कॉल करते हुए रीयल-टाइम में देखें
- **थिंकिंग ब्लॉक** — मॉडल का विस्तार योग्य तर्क
- **टूल कॉल टाइमलाइन** — आर्ग्युमेंट और परिणामों के साथ लाइव bash/edit/write टूल कॉल
- **सेशन मैनेजमेंट** — `~/.zosmaai/cowork/` में सहेजे गए लगातार चैट सेशन
- **लाइट और डार्क मोड** — गर्म क्रीम लाइट मोड और गर्म चारकोल डार्क मोड
- **कीबोर्ड शॉर्टकट** — फोकस के लिए `Cmd/Ctrl+Shift+K`, नए सेशन के लिए `Cmd/Ctrl+N`
- **एबॉर्ट और स्टीयरिंग** — मिड-टर्न में चल रहे एजेंट को रोकें, फॉलो-अप स्टीयरिंग संदेश भेजें
- **Claude-प्रेरित UI** — साइडबार, वर्कस्पेस और इन्फो पैनल के साथ 3-कॉलम लेआउट

## आर्किटेक्चर

<img src="./assets/architecture.png" width="100%" alt="Zosma Cowork architecture diagram" />

<details>
<summary>इस डायग्राम को संपादित करें</summary>

यह डायग्राम <code>assets/architecture.mmd</code> से जनरेट किया गया है। अपडेट करने का तरीका:

```bash
# Edit assets/architecture.mmd, then re-render:
mmdc -i assets/architecture.mmd -o assets/architecture.png -b white -w 900 -H 700
```
</details>

## तकनीकी स्टैक

| Layer | Technology |
|-------|-----------|
| फ्रंटएंड | React 19, Tailwind CSS v4, Radix UI |
| डेस्कटॉप शेल | Tauri v2, Rust, Tokio |
| एजेंट इंजन | Node.js साइडकार — `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| टेस्टिंग | Vitest, Testing Library, jsdom |
| लिंटर | Biome (फ्रंटएंड), Clippy (Rust) |

## डेवलपमेंट

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (Tauri डेस्कटॉप शेल के लिए)

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

## कॉन्फ़िग और डेटा

| क्या | स्थान | नोट |
|------|----------|-------|
| LLM प्रदाता और API कुंजियाँ | `~/.zosmaai/cowork/auth.json` | ऐप द्वारा प्रबंधित |
| मॉडल परिभाषाएँ | `~/.zosmaai/cowork/models.json` | ऐप द्वारा प्रबंधित |
| एक्सटेंशन और स्किल | `~/.zosmaai/cowork/extensions/` | Pi-संगत एक्सटेंशन |
| सेशन इतिहास | `~/.zosmaai/cowork/` | Zosma Cowork द्वारा प्रबंधित |

## IPC प्रोटोकॉल

Tauri रिले stdin/stdout JSON लाइनों के माध्यम से Node.js साइडकार के साथ संचार करता है:

**कमांड (→ साइडकार):**

| Command | Description |
|---------|-------------|
| `init` | zosmaDir कॉन्फ़िग के साथ एजेंट को इनिशियलाइज़ करें |
| `get_models` | सभी प्रदाताओं से उपलब्ध मॉडलों की सूची |
| `prompt` | उपयोगकर्ता संदेश भेजें, ईवेंट स्ट्रीम करें |
| `abort` | चल रहे प्रॉम्प्ट को रद्द करें |
| `set_model` | सक्रिय मॉडल बदलें |
| `save_auth` | प्रदाता के लिए API कुंजी सहेजें |
| `reload` | नए एक्सटेंशन/प्रमाणीकरण के साथ पुनः आरंभ करें |

**ईवेंट (← साइडकार):**

| Event | UI Effect |
|-------|-----------|
| `ready` | मॉडल लोड हुए, UI सक्षम करें |
| `event` | एजेंट सेशन ईवेंट (सोच, टेक्स्ट, टूल कॉल) |
| `done` | प्रॉम्प्ट पूरा हुआ |
| `result` | अनुरोध कमांड का उत्तर |
| `error` | संदेश के साथ त्रुटि |

## प्रोजेक्ट संरचना

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

## 🇮🇳 भारत में निर्मित

**Zosma Cowork** — **ZOSMAAI SOLUTIONS PRIVATE LIMITED** द्वारा **भारत में** निर्मित।

## लाइसेंस

MIT © [Zosma AI](https://zosma.ai)
