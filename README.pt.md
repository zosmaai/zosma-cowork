# Zosma Cowork

[English](./README.md) | [中文](./README.zh.md) | [Español](./README.es.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | **Português** | [Русский](./README.ru.md) | [한국어](./README.ko.md) | [हिंदी](./README.hi.md)

[![CI](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml)
[![Release](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Um coworker de IA para desktop powered by [pi agent SDK](https://github.com/earendil-works/pi-coding-agent) — streaming, processos de pensamento, chamadas de ferramentas, sessões multi-turno e direcionamento, tudo em um belo aplicativo nativo.

![zosma-cowork-captura](./assets/screenshot.png)

## Funcionalidades

- **Runtime do agente em processo** — O SDK pi agent roda diretamente dentro do app (sem subprocesso, sem dependência de CLI em tempo de execução)
- **Sessões multi-turno** — Continuidade completa de conversa com histórico de sessão persistente
- **Respostas em streaming** — Veja o agente pensar, escrever e chamar ferramentas em tempo real
- **Blocos de pensamento** — Raciocínio expansível do modelo
- **Linha do tempo de chamadas de ferramentas** — Chamadas bash/edit/write em tempo real com argumentos e resultados
- **Gerenciamento de sessões** — Sessões de chat persistentes salvas em `~/.zosmaai/cowork/`
- **Modo claro e escuro** — Modo claro creme quente e modo escuro carvão quente
- **Atalhos de teclado** — `Cmd/Ctrl+Shift+K` para focar, `Cmd/Ctrl+N` para nova sessão
- **Abortar e direcionar** — Parar um agente em execução mid-turn, enviar mensagens de direcionamento de acompanhamento
- **UI inspirada no Claude** — Layout de 3 colunas com barra lateral, espaço de trabalho e painel de informações

## Stack Tecnológico

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 19, Tailwind CSS v4, Radix UI |
| Shell desktop | Tauri v2, Rust, Tokio |
| Motor do agente | Node.js sidecar — pi-mono SDK |
| SDK do agente | `@earendil-works/pi-coding-agent` — pi-mono TypeScript SDK
| Testes | Vitest, Testing Library, jsdom, `cargo test` |
| Linter | Biome (frontend), Clippy (Rust) |

## Início Rápido

### Pré-requisitos

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+

### Instalar e Executar

```bash
# Instalar dependências
npm install

# Executar servidor de desenvolvimento frontend
npm run dev:frontend

# Executar aplicativo Tauri completo (frontend + backend Rust + Node.js agent sidecar)
npm run dev
```

## Configuração e dados

| O quê | Localização | Notas |
|-------|-------------|-------|
| Provedores LLM e chaves API | `~/.zosmaai/agent/settings.json` | Gerenciado pelo app |
| Definições de modelos | `~/.zosmaai/agent/models.json` | Gerenciado pelo app |
| Extensões e habilidades | `~/.zosmaai/agent/extensions/` | Diretório local de extensões |
| Histórico de sessões | `~/.zosmaai/cowork/` | Gerenciado por Zosma Cowork |

## Licença

MIT © [Zosma AI](https://zosma.ai)
