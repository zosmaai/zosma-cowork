# Zosma Cowork

[English](./README.md) | [中文](./README.zh.md) | [Español](./README.es.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [Português](./README.pt.md) | [Русский](./README.ru.md) | **한국어** | [हिंदी](./README.hi.md)

[![CI](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/ci.yml)
[![Release](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml/badge.svg)](https://github.com/zosmaai/zosma-cowork/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> [pi agent SDK](https://github.com/earendil-works/pi-coding-agent)로 구동되는 데스크톱 AI 동료 — 스트리밍, 사고 과정, 도구 호출, 멀티턴 세션 및 스티어링을 모두 아름다운 네이티브 앱에 통합했습니다.

![zosma-cowork-스크린샷](./assets/screenshot.png)

## 기능

- **인프로세스 에이전트 런타임** — pi agent SDK가 앱 내에서 직접 실행 (서브프로세스 없음, 런타임 시 CLI 의존성 없음)
- **멀티턴 세션** — 영구 세션 기록으로 완전한 대화 연속성
- **스트리밍 응답** — 에이전트가 생각하고, 쓰고, 도구를 호출하는 것을 실시간으로 확인
- **사고 블록** — 확장 가능한 모델의 추론 과정
- **도구 호출 타임라인** — 인수와 결과가 포함된 실시간 bash/edit/write 도구 호출
- **세션 관리** — `~/.zosmaai/cowork/`에 저장되는 지속적인 채팅 세션
- **라이트 & 다크 모드** — 따뜻한 크림 라이트 모드와 따뜻한 차콜 다크 모드
- **키보드 단축키** — `Cmd/Ctrl+Shift+K`로 포커스, `Cmd/Ctrl+N`으로 새 세션
- **중단 및 스티어링** — 턴 중간에 실행 중인 에이전트 중지, 후속 스티어링 메시지 전송
- **Claude 스타일 UI** — 사이드바, 작업 공간, 정보 패널이 있는 3열 레이아웃

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프론트엔드 | React 19, Tailwind CSS v4, Radix UI |
| 데스크톱 셸 | Tauri v2, Rust, Tokio |
| 에이전트 엔진 | Node.js sidecar — pi-mono SDK (`@earendil-works/pi-coding-agent`)
| 에이전트 SDK | `@earendil-works/pi-coding-agent` — pi-mono TypeScript SDK
| 테스트 | Vitest, Testing Library, jsdom, `cargo test` |
| 린터 | Biome (프론트엔드), Clippy (Rust) |

## 빠른 시작

### 전제 조건

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://rustup.rs/) 1.85+

### 설치 및 실행

```bash
# 의존성 설치
npm install

# 프론트엔드 개발 서버 실행
npm run dev:frontend

# 전체 Tauri 앱 실행 (프론트엔드 + Rust 백엔드 + Node.js agent sidecar)
npm run dev
```

## 설정 및 데이터

| 항목 | 위치 | 참고 |
|------|------|------|
| LLM 제공자 및 API 키 | `~/.zosmaai/agent/settings.json` | 앱에서 관리 |
| 모델 정의 | `~/.zosmaai/agent/models.json` | 앱에서 관리 |
| 확장 및 스킬 | `~/.zosmaai/agent/extensions/` | 로컬 확장 디렉토리 |
| 세션 기록 | `~/.zosmaai/cowork/` | Zosma Cowork에서 관리 |

## 라이선스

MIT © [Zosma AI](https://zosma.ai)
