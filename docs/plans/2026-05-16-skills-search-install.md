# Phase 2: Skills Search & Install

## Overview
Add a Skills Browser panel that lets users search the skills.sh ecosystem, view installed skills, and install/remove skills — all from within Zosma Cowork.

## Architecture

### Sidecar commands (agent-sidecar/src/index.ts)
| Type | Args | Returns | Implementation |
|------|------|---------|---------------|
| `search_skills` | `query: string` | `{results: SkillResult[]}` | `npx skills find <query>`, strip ANSI, parse lines |
| `list_skills` | none | `{skills: InstalledSkill[]}` | `npx skills list --json`, parse JSON |
| `install_skill` | `source: string` | `{success: true}` | `npx skills add <source> -y -g` |
| `remove_skill` | `name: string` | `{success: true}` | `npx skills remove <name> -y` |

### SkillResult interface
```ts
interface SkillResult {
  id: string;        // "owner/repo@skill-name"
  installCount: number;
  url: string;       // "https://skills.sh/owner/repo/skill-name"
}
```

### InstalledSkill interface (from `skills list --json`)
```ts
interface InstalledSkill {
  name: string;
  path: string;
  scope: "project" | "global";
  agents: string[];
}
```

### Rust IPC (src-tauri/src/lib.rs)
Relay commands similar to existing `search_discover` pattern:
- `search_skills(query)` → sidecar `search_skills`
- `list_skills()` → sidecar `list_skills`
- `install_skill(source)` → sidecar `install_skill`
- `remove_skill(name)` → sidecar `remove_skill`

### Frontend
- `SkillsPanel.tsx` — search bar, results grid, installed list, install/remove buttons
- `SkillsPanel.test.tsx` — component tests
- Sidebar integration — Skills tab with Puzzle icon

## TDD Tasks

1. Write failing tests for SkillsPanel component
2. Implement SkillsPanel component
3. Add sidecar command handlers
4. Add Rust IPC relay commands
5. Wire into Sidebar
6. Full validation (lint + typecheck + tests)
