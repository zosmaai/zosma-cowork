# Zosma Cowork

[English](./README.md) | [中文](./README.zh.md) | [Español](./README.es.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Português](./README.pt.md) | [Русский](./README.ru.md) | [한국어](./README.ko.md) | **हिंदी**

[![CI](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml)
[![Release](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> [pi agent SDK](https://github.com/earendil-works/pi-coding-agent) द्वारा संचालित डेस्कटॉप AI सहकर्मी — स्ट्रीमिंग, सोच की प्रक्रिया, टूल कॉल, मल्टी-टर्न सेशन और स्टीयरिंग, सब कुछ एक सुंदर नेटिव ऐप में।

![zosma-cowork-स्क्रीनशॉट](./assets/screenshot.png)

## विशेषताएँ

- **इन-प्रोसेस एजेंट रनटाइम** — pi agent SDK सीधे ऐप के अंदर चलता है (कोई सबप्रोसेस नहीं, रनटाइम पर CLI निर्भरता नहीं)
- **मल्टी-टर्न सेशन** — लगातार सेशन इतिहास के साथ पूर्ण वार्तालाप निरंतरता
- **स्ट्रीमिंग प्रतिक्रियाएँ** — एजेंट को सोचते, लिखते और टूल कॉल करते हुए रीयल-टाइम में देखें
- **थिंकिंग ब्लॉक** — मॉडल का विस्तार योग्य तर्क
- **टूल कॉल टाइमलाइन** — आर्ग्युमेंट और परिणामों के साथ लाइव bash/edit/write टूल कॉल
- **सेशन मैनेजमेंट** — `~/.zosmaai/cowork/` में सहेजे गए लगातार चैट सेशन
- **लाइट और डार्क मोड** — गर्म क्रीम लाइट मोड और गर्म चारकोल डार्क मोड
- **कीबोर्ड शॉर्टकट** — फोकस के लिए `Cmd/Ctrl+Shift+K`, नए सेशन के लिए `Cmd/Ctrl+N`
- **एबॉर्ट और स्टीयरिंग** — मिड-टर्न में चल रहे एजेंट को रोकें, फॉलो-अप स्टीयरिंग संदेश भेजें
- **Claude-प्रेरित UI** — साइडबार, वर्कस्पेस और इन्फो पैनल के साथ 3-कॉलम लेआउट

## तकनीकी स्टैक

| परत | तकनीक |
|-----|-------|
| फ्रंटएंड | React 19, Tailwind CSS v4, Radix UI |
| डेस्कटॉप शेल | Tauri v2, Rust, Tokio |
| एजेंट इंजन | Node.js sidecar — pi-mono SDK (`@earendil-works/pi-coding-agent`)
| एजेंट SDK | `@earendil-works/pi-coding-agent` — pi-mono TypeScript SDK
| टेस्टिंग | Vitest, Testing Library, jsdom, `cargo test` |
| लिंटर | Biome (फ्रंटएंड), Clippy (Rust) |

## त्वरित शुरुआत

### पूर्वापेक्षाएँ

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+
- [pi coding agent](https://github.com/earendil-works/pi-coding-agent) — प्रारंभिक सेटअप के लिए एक बार इंस्टॉल करें: `npm install -g @mariozechner/pi-coding-agent`, फिर `pi` एक बार चलाएँ ताकि `~/.pi/agent/settings.json` और `~/.pi/agent/models.json` बन सकें

> **नोट:** pi CLI केवल प्रारंभिक सेटअप के लिए आवश्यक है। The app uses the pi-mono TypeScript SDK via a Node.js sidecar process.

### इंस्टॉल और रन

```bash
# निर्भरताएँ इंस्टॉल करें
npm install

# फ्रंटएंड डेवलपमेंट सर्वर चलाएँ
npm run dev:frontend

# पूरी Tauri ऐप चलाएँ (फ्रंटएंड + Rust बैकएंड + Node.js agent sidecar)
npm run dev
```

## कॉन्फ़िग और डेटा

| क्या | स्थान | नोट |
|-----|-------|------|
| LLM प्रदाता और API कुंजियाँ | `~/.pi/agent/settings.json` | पहले `pi` रन पर बनाया गया |
| मॉडल परिभाषाएँ | `~/.pi/agent/models.json` | पहले `pi` रन पर बनाया गया |
| एक्सटेंशन और स्किल | `~/.pi/agent/extensions/` | `pi install` से इंस्टॉल किए गए |
| सेशन इतिहास | `~/.zosmaai/cowork/` | Zosma Cowork द्वारा प्रबंधित |

## लाइसेंस

MIT © [Zosma AI](https://zosma.ai)
