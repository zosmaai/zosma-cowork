# Cowork pi-native extensions & skills

**Date:** 2026-06-14
**Status:** Design (validated, pre-implementation)
**Related:** issue #147 (skills/extensions shared with pi), PR #189 (Discord config screen)

## 1. Principle

Zosma Cowork is a **thin GUI helper on top of the pi coding agent**. For every
resource pi already understands — extensions, skills, prompts, themes, models,
settings — Cowork **defers entirely to pi's mechanisms and pi's directories**.
It does not maintain a parallel registry or a private resource silo.

`~/.zosmaai/cowork/` is reserved **only** for zosma-specific custom data that pi
has no concept of (cowork sessions, cowork UI/app settings, non-pi features such
as the office-docs binary). It must never hold pi-managed resources.

> Rule of thumb: if pi has a concept for it, pi owns it. Cowork reads/writes
> through pi. Otherwise it lives under `~/.zosmaai/cowork/`.

## 2. Problem / root cause

The sidecar has **two parallel mechanisms that disagree**:

| Layer | File | Behaviour | pi-correct? |
|---|---|---|---|
| Runtime loader | `agent-sidecar/src/disk-extension-loader.ts` | Loads extensions for the agent via pi's own `DefaultPackageManager.resolve()` against `~/.pi/agent/settings.json` (+ loose `extensions/`) | ✅ |
| Store / UI | `agent-sidecar/src/extension-manager.ts` | Powers the Extensions page (`list_extensions`, install, uninstall, config) with its **own** `cowork-extensions.json` registry and an `npm pack`/extract reimplementation | ❌ diverges |

Consequences observed:

- **"Installed extensions not detected"** — `discoverExtensions()` reads
  `settings.json.packages` naively: each entry is listed as a bare string with
  `version: "—"`, no metadata and no capabilities, instead of being resolved to
  its install path and described from `package.json`.
- **Local-path packages mis-typed** — entries like `../../pi-extensions/pi-chat`
  and `../../code/pi-packages/pi-htn` are reported as `npm` with broken names.
- **Duplicate drop-in hazard** — the `npm pack` path can extract a second copy
  into `extensions/`, so pi refuses to load the duplicate (the historical
  pi-web-access "Tool X conflicts" startup failure), requiring the
  `piManagesPackage()` guard.

Ground truth check (this machine): `pi list` cleanly reports all 12 packages
(npm + local), while `~/.pi/agent/cowork-extensions.json` is empty. pi is
already the source of truth on disk; only the Store layer fails to ask it.

## 3. Design

### 3.1 Extensions

**Detection** — replace the bespoke `discoverExtensions()` with the *same*
resolver the runtime loader uses: `DefaultPackageManager.resolve()`, run against
both scopes for the active workspace `cwd`:

- User/global: `~/.pi/agent/settings.json`
- Project-local: `<cwd>/.pi/settings.json` (loaded only after the project is
  trusted; project entry wins on dedupe — npm by name, git by repo URL, local by
  resolved absolute path)

For each resolved package, read its `package.json` for real
name/version/description/capabilities. This handles npm/git/local uniformly and
matches exactly what loads at runtime.

**Mutation** — shell out to the real CLI instead of reimplementing it:

- `pi install <source>` (user/global) or `pi install -l <source>` (project, when
  a workspace folder is active)
- `pi remove <source>` (+ `-l`)

pi owns placement under `~/.pi/agent/npm/` (or `.pi/npm/`), eliminating the
duplicate-drop-in bug entirely.

**Enable/disable** — write pi's native enable/disable in settings
(packages.md §"Enable and Disable Resources"), not a cowork registry.

**Delete** — `cowork-extensions.json` registry and the `npm pack`/git-clone/
local-symlink install code in `extension-manager.ts`.

### 3.2 Skills

Discover via pi's native skill locations, scoped to the active `cwd`
(skills.md §Locations):

- Global: `~/.pi/agent/skills/` and `~/.agents/skills/`
- Project (after trust): `.pi/skills/` and `.agents/skills/` in `cwd` and
  ancestors up to the git/repo root

pi already scans `~/.agents/skills/` (the cross-harness shared standard used by
Claude Code etc.), so **no symlink-to-pi is required** — individual skills may be
symlinked *into* `~/.agents/skills/` (e.g. the existing `omarchy` skill). Cowork
installs skills into the shared `~/.agents/skills/` (global) or the project
`.agents/skills/`. The `skills.sh` search/browse UI stays; only the install
destination and discovery source change to pi-native. No `.zosmaai` tracking.

### 3.3 What stays under `~/.zosmaai/cowork/`

- Cowork session store (`sessions/`)
- Cowork app/UI settings (`settings.json`)
- Genuinely non-pi features (e.g. office-docs `bin/officecli`)

Nothing pi-managed (extensions, skills, prompts, themes, models).

## 4. Files touched (implementation surface)

- `agent-sidecar/src/extension-manager.ts` — gut the registry + npm-pack code;
  reduce to a thin adapter (resolve for detect, `pi install`/`pi remove` for
  mutate). May fold into / reuse helpers from `disk-extension-loader.ts`.
- `agent-sidecar/src/index.ts` — `list_extensions`, install, uninstall and
  `set_extension_config` command handlers; pass the active workspace `cwd` so
  detection is project-scoped.
- Skills discovery path (the `list_skills` handler region in `index.ts`).
- Frontend Extensions/Skills pages — consume richer resolved metadata; surface
  project vs global scope.

## 5. Migration / cleanup

- Retire `~/.pi/agent/cowork-extensions.json` (read-once migration is
  unnecessary — pi's `settings.json` already holds the truth; just stop writing
  it and delete on next install/uninstall).
- Remove any remaining `~/.zosmaai/cowork` resource paths for extensions/skills.
- Closes issue #147 properly (shared-with-pi, no cowork silo).

## 6. Out of scope

- The pi-messenger-bridge vs pi-chat (Gondolin VM) chat-bridge phasing — tracked
  separately.
- The "enable VM with one click" auto-installer for pi-chat's Gondolin sandbox.

## 7. Next step

Turn this into a step-by-step implementation plan (`/skill:writing-plans`),
TDD-first against `extension-manager.test.ts` and the sidecar command handlers.
