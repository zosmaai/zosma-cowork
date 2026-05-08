# Zosma Cowork

[English](./README.md) | [中文](./README.zh.md) | [Español](./README.es.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Português](./README.pt.md) | **Русский** | [한국어](./README.ko.md) | [हिंदी](./README.hi.md)

[![CI](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml)
[![Release](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Десктопный ИИ-коллега на базе [SDK pi agent](https://github.com/earendil-works/pi-coding-agent) — потоковая передача, процессы мышления, вызовы инструментов, мультитурновые сессии и управление, всё в красивом нативном приложении.

![zosma-cowork-скриншот](./assets/screenshot.png)

## Возможности

- **Внутрипроцессная среда агента** — SDK pi agent работает прямо внутри приложения (без подпроцессов, без зависимости от CLI во время выполнения)
- **Мультитурновые сессии** — Полная преемственность разговоров с постоянной историей сессий
- **Потоковые ответы** — Наблюдайте, как агент думает, пишет и вызывает инструменты в реальном времени
- **Блоки мышления** — Раскрываемый процесс рассуждения модели
- **Шкала вызовов инструментов** — Живые bash/edit/write вызовы с аргументами и результатами
- **Управление сессиями** — Постоянные чат-сессии сохраняются в `~/.zosmaai/cowork/`
- **Светлый и тёмный режим** — Тёплый кремовый светлый и тёплый угольный тёмный режим
- **Горячие клавиши** — `Cmd/Ctrl+Shift+K` для фокуса, `Cmd/Ctrl+N` для новой сессии
- **Прервать и управлять** — Остановить запущенный агент в середине хода, отправить последующие управляющие сообщения
- **UI вдохновлённый Claude** — 3-колоночный макет с боковой панелью, рабочей областью и информационной панелью

## Технологический стек

| Слой | Технология |
|------|-----------|
| Frontend | React 19, Tailwind CSS v4, Radix UI |
| Десктопная оболочка | Tauri v2, Rust, Tokio |
| Движок агента | Node.js sidecar — pi-mono SDK |
| SDK агента | `@earendil-works/pi-coding-agent` — pi-mono TypeScript SDK
| Тестирование | Vitest, Testing Library, jsdom, `cargo test` |
| Линтер | Biome (frontend), Clippy (Rust) |

## Быстрый старт

### Требования

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+

### Установка и запуск

```bash
# Установить зависимости
npm install

# Запустить frontend сервер разработки
npm run dev:frontend

# Запустить полное Tauri приложение (frontend + Rust backend + Node.js agent sidecar)
npm run dev
```

## Конфигурация и данные

| Что | Расположение | Примечания |
|-----|-------------|-----------|
| LLM-провайдеры и API-ключи | `~/.zosmaai/agent/settings.json` | Управляется приложением |
| Определения моделей | `~/.zosmaai/agent/models.json` | Управляется приложением |
| Расширения и навыки | `~/.zosmaai/agent/extensions/` | Локальная папка расширений |
| История сессий | `~/.zosmaai/cowork/` | Управляется Zosma Cowork |

## Лицензия

MIT © [Zosma AI](https://zosma.ai)
