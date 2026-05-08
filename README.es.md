# Zosma Cowork

[English](./README.md) | [中文](./README.zh.md) | **Español** | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Português](./README.pt.md) | [Русский](./README.ru.md) | [한국어](./README.ko.md) | [हिंदी](./README.hi.md)

[![CI](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml)
[![Release](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Un compañero de escritorio impulsado por el [SDK de pi agent](https://github.com/earendil-works/pi-coding-agent) — transmisión en tiempo real, procesos de pensamiento, llamadas a herramientas, sesiones multi-turno y dirección, todo en una hermosa aplicación nativa.

![zosma-cowork-captura](./assets/screenshot.png)

## Características

- **Tiempo de ejecución del agente en proceso** — El SDK de pi agent se ejecuta directamente dentro de la aplicación (sin subprocesos, sin dependencia de CLI en tiempo de ejecución)
- **Sesiones multi-turno** — Continuidad completa de conversación con historial de sesión persistente
- **Respuestas en streaming** — Observa al agente pensar, escribir y llamar herramientas en tiempo real
- **Bloques de pensamiento** — Razonamiento expandible del modelo
- **Línea de tiempo de llamadas a herramientas** — Llamadas bash/edit/write en tiempo real con argumentos y resultados
- **Gestión de sesiones** — Sesiones de chat persistentes guardadas en `~/.zosmaai/cowork/`
- **Modo claro y oscuro** — Modo claro crema cálido y modo oscuro carbón cálido
- **Atajos de teclado** — `Cmd/Ctrl+Shift+K` para enfocar, `Cmd/Ctrl+N` para nueva sesión
- **Abortar y dirigir** — Detener un agente en ejecución a mitad de turno, enviar mensajes de dirección de seguimiento
- **UI inspirada en Claude** — Diseño de tres columnas con barra lateral, espacio de trabajo y panel de información

## Tecnologías

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19, Tailwind CSS v4, Radix UI |
| Shell de escritorio | Tauri v2, Rust, Tokio |
| Motor del agente | Node.js sidecar — pi-mono SDK |
| SDK del agente | `@earendil-works/pi-coding-agent` — pi-mono TypeScript SDK
| Pruebas | Vitest, Testing Library, jsdom, `cargo test` |
| Linter | Biome (frontend), Clippy (Rust) |

## Inicio rápido

### Prerrequisitos

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+

### Instalar y ejecutar

```bash
# Instalar dependencias
npm install

# Ejecutar servidor de desarrollo frontend
npm run dev:frontend

# Ejecutar aplicación Tauri completa (frontend + backend Rust + Node.js agent sidecar)
npm run dev
```

## Configuración y datos

| Qué | Ubicación | Notas |
|-----|-----------|-------|
| Proveedores LLM y claves API | `~/.zosmaai/agent/settings.json` | Gestionado por la app |
| Definiciones de modelos | `~/.zosmaai/agent/models.json` | Gestionado por la app |
| Extensiones y habilidades | `~/.zosmaai/agent/extensions/` | Directorio local de extensiones |
| Historial de sesiones | `~/.zosmaai/cowork/` | Gestionado por Zosma Cowork |

## Licencia

MIT © [Zosma AI](https://zosma.ai)
