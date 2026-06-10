<div align="center">

# Zosma Cowork 🇮🇳

<img src="./assets/zosma-cowork-logo.png" alt="Zosma Cowork" width="200" />

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | **Français** | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

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

> Un harnais de travail agentique de bureau construit sur [pi](https://github.com/earendil-works/pi-coding-agent), le harnais d'agent de codage minimal et indépendant du langage. Streaming, réflexion, appels d'outils, sessions multi-tours — tout gratuit, tout open-source, tout local.
>
> Construit par [Zosma AI](https://zosma.ai).

## Gallery

<img src="./assets/demo.gif" width="100%" alt="Zosma Cowork demo" />

<img src="./assets/screenshot.png" width="100%" alt="Zosma Cowork screenshot" />

*Invoice processing with natural language agents. See more demos at [zosma.ai/zosma-cowork/gallery](https://www.zosma.ai/zosma-cowork/gallery)*

## Pourquoi Zosma Cowork ?

### 🌟 Construit sur pi

Zosma Cowork est une application de bureau construite sur [pi](https://github.com/earendil-works/pi-coding-agent) — le harnais d'agent de codage minimal et indépendant du langage. Chaque extension pi fonctionne directement, sans wrapper ni adaptateur.

### 🆓 Gratuit & Open Source

Zosma Cowork est **100% gratuit et open-source** (MIT). Apportez votre propre clé API ou utilisez des modèles locaux — vous gardez le contrôle.

### 🧩 Écosystème complet d'extensions pi

L'[écosystème pi](https://github.com/earendil-works/pi-coding-agent) comprend des centaines d'extensions, compétences, outils, prompts et thèmes — tous compatibles avec Zosma Cowork. Placez-les dans votre répertoire `~/.zosmaai/cowork/` et ils fonctionnent immédiatement.

## Fonctionnalités
- **Sidecar agent Node.js** — Le SDK pi-mono TypeScript s'exécute dans un processus sidecar géré pour des capacités d'agent complètes
- **Relais Tauri léger** — La couche Rust est un pont IPC minimal entre React et le sidecar
- **Écosystème d'extensions pi** — Compatible avec les extensions pi via `DefaultResourceLoader` — compétences, outils et prompts auto-découverts
- **Sessions multi-tours** — Continuité de conversation complète avec historique persistant
- **Réponses en streaming** — Voyez l'agent penser, écrire et appeler des outils en temps réel
- **Blocs de réflexion** — Raisonnement dépliable du modèle
- **Chronologie des appels d'outils** — Appels d'outils bash/edit/write en direct avec arguments et résultats
- **Gestion des sessions** — Sessions de chat persistantes sauvegardées dans `~/.zosmaai/cowork/`
- **Mode clair & sombre** — Mode clair crème chaud, mode sombre charbon chaud
- **Raccourcis clavier** — `Cmd/Ctrl+Shift+K` pour focus, `Cmd/Ctrl+N` pour nouvelle session
- **Annulation & direction** — Arrêtez un agent en cours, envoyez des messages de suivi
- **UI inspirée de Claude** — Disposition 3 colonnes avec barre latérale, espace de travail et panneau d'information

## Architecture

<img src="./assets/architecture.png" width="100%" alt="Zosma Cowork architecture diagram" />

<details>
<summary>Modifier ce diagramme</summary>

Le diagramme est généré à partir de <code>assets/architecture.mmd</code>. Pour mettre à jour :

```bash
# Edit assets/architecture.mmd, then re-render:
mmdc -i assets/architecture.mmd -o assets/architecture.png -b white -w 900 -H 700
```
</details>

## Stack Technique

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4, Radix UI |
| Shell Bureau | Tauri v2, Rust, Tokio |
| Moteur Agent | Sidecar Node.js — `@earendil-works/pi-coding-agent` (pi-mono SDK) |
| Tests | Vitest, Testing Library, jsdom |
| Linting | Biome (frontend), Clippy (Rust) |

## Développement

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+ (pour le shell Tauri)

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

## Configuration & Données

| Quoi | Emplacement | Notes |
|------|----------|-------|
| Fournisseurs LLM & clés API | `~/.zosmaai/cowork/auth.json` | Géré par l'app |
| Définitions de modèles | `~/.zosmaai/cowork/models.json` | Géré par l'app |
| Extensions & compétences | `~/.zosmaai/cowork/extensions/` | Extensions compatibles Pi |
| Historique des sessions | `~/.zosmaai/cowork/` | Géré par Zosma Cowork |

## Protocole IPC

Le relais Tauri communique avec le sidecar Node.js via des lignes JSON stdin/stdout :

**Commandes (→ sidecar) :**

| Command | Description |
|---------|-------------|
| `init` | Initialiser l'agent avec la configuration zosmaDir |
| `get_models` | Lister les modèles disponibles |
| `prompt` | Envoyer un message utilisateur, diffuser des événements |
| `abort` | Annuler le prompt en cours |
| `set_model` | Changer de modèle actif |
| `save_auth` | Sauvegarder la clé API pour un fournisseur |
| `reload` | Réinitialiser avec des extensions/auth fraîches |

**Événements (← sidecar) :**

| Event | UI Effect |
|-------|-----------|
| `ready` | Modèles chargés, activer l'UI |
| `event` | Événements de session agent (réflexion, texte, appels d'outils) |
| `done` | Prompt terminé |
| `result` | Réponse à une commande de requête |
| `error` | Erreur avec message |

## Structure du Projet

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

## 🇮🇳 Fabriqué en Inde

**Zosma Cowork** — construit **depuis l'Inde** par **ZOSMAAI SOLUTIONS PRIVATE LIMITED**.

## Licence

MIT © [Zosma AI](https://zosma.ai)
