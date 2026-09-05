# Zosma Cowork → Web UI + Thin Tauri Shell Migration Plan

> Status: **PLAN** (branch `feat/web-ui-shell`, cut from fresh `origin/main` at `19404c663`).
>
> This document is the source of truth for replacing the current zosma-cowork
> desktop app (Vite + React frontend + `agent-sidecar`) with the
> **zosma-harness** Next.js web UI, wrapped in a minimal Tauri shell that
> behaves like a browser pinned to a local URL.
>
> A working copy of this document also lives in the zosma-harness repo at
> `docs/web-ui-shell-migration.md`.

---

## 1. Goal

One product, two run modes:

| Mode | Launch | Requirements on machine |
|------|--------|-------------------------|
| **Web** | `cd web && npm ci && npm run build && pi-web` → http://127.0.0.1:30141 | Node ≥ 22.19 |
| **App (self-contained)** | `Zosma Cowork.app` / `ZosmaCowork.exe` (msi) / `.AppImage` / `.deb` | Nothing — Node binary and the built web server ship inside the bundle |

The Tauri app is deliberately **a browser, not an app**: a single window whose
URL is `http://127.0.0.1:30141`, with no local frontend assets of its own.
All UI, API, and agent logic lives in the Next.js server (which already runs
the pi SDK in-process). The Rust side does exactly three things:

1. Check whether a server is already listening on `127.0.0.1:30141`.
2. If not, spawn the bundled Node running the web server's launcher.
3. Kill that child process when the app quits.

Everything else — sessions, chat, file explorer, models config, notifications —
is the web UI's job, unchanged.

### Explicitly out of scope

- Replacing individual features of the old desktop app (sidecar RPC, Sentry,
  deep links, mobile.html) — they are removed, not ported.
- Shipping a voice/`mobile` client.
- Multi-window / multi-server support. One port, one server.

---

## 2. Decisions already made (2026-08-26)

| # | Decision | Detail |
|---|----------|--------|
| D1 | **Copy, don't delete (yet)** | `web/` is added to zosma-cowork on the feat branch. Old frontend files stay until the shell is verified end-to-end. Deletion is Phase 5, a separate commit. |
| D2 | **Fresh main** | `feat/web-ui-shell` was cut from `origin/main` after `git fetch` (local `main` was 0 commits behind). |
| D3 | **Single repo, plain copy** | zosma-harness files are copied into `zosma-cowork/web/` by value. No git submodule. |
| D4 | **Reuse existing machinery** | Bundled-Node download (`fetch-node.mjs`, Node v24.15.0), per-platform sidecar-path resolution (`find_sidecar_path` in `src-tauri/src/lib.rs`), release CI matrix, icons, updater config — all reused, not re-invented. |
| D5 | **Self-contained app (recommended default)** | The desktop app spawns the server itself. A bare "shell only, I start the server" variant is kept as a documented fallback (see §6.2) for tiny-bundle builds. |

Open questions remain in §14.

---

## 3. What exists today

### 3.1 zosma-harness (source of the new web UI)

Location: `/home/arjun/code/zosmaai/zosma-harness` (own local `.git`, **no
remote**, package name still `@agegr/pi-web` v0.8.9, cloned from agegr/pi-web).

- Next.js 16 (`--webpack` build), React 19, runs the pi SDK
  (`@earendil-works/pi-*` 0.84.2) in-process.
- Fixed protocol: **`127.0.0.1:30141`** (hardcoded in `package.json` scripts;
  `start:lan` binds `0.0.0.0`).
- `engines.node >= 22.19.0`.
- Ship-ready launcher: `bin/pi-web.js` (npm `bin: pi-web`) — validates Node
  version, resolves `next/dist/bin/next` without relying on `.bin` symlinks,
  supports `--port/--host/--open`, refuses non-loopback hosts without a
  password. This is the entrypoint the Tauri shell will spawn.
- Server list is already loopback-only by default; no auth needed for the
  local app mode.
- Test suite: `node --test` across `app|components|hooks|lib|public` `.mjs`
  tests. Typecheck: `tsc --noEmit`. Lint: eslint.
- **Repo rule (from its AGENTS.md): never run `next build` while `next dev`
  is running** — it pollutes `.next/` and breaks dev. The dev server PID must
  be stopped before any build in this migration.

### 3.2 zosma-cowork (target repo, current state)

- Tauri 2 app, product `zosma-cowork`, identifier `ai.zosma.cowork`, version
  series v0.18.x on `main`.
- Heavy frontend: `src/` (React + Vite, port 1420), `index.html`,
  `mobile.html`, `agent-sidecar/` (Node sidecar that today runs the pi agent
  for the React UI), `vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`,
  biome configs, Sentry, motion, lucide, etc.
- **Reuse candidates (confirmed present):**
  - `src-tauri/scripts/fetch-node.mjs` — downloads per-OS Node
    `v24.15.0` into `src-tauri/binaries/node*` at build time.
  - `bundle.resources` already lists `binaries/node*`.
  - `src-tauri/src/lib.rs`:
    - `find_sidecar_path()` — per-platform resolution of a bundled JS entry
      (app resource dir on macOS, `/usr/lib/zosma-cowork/…` on Linux
      AppImage/deb, `%PROGRAMFILES%\ZosmaAI\ZosmaCoWork\…` on Windows).
    - Sidecar `Child` storage + exit-watcher task + drain of pending requests
      on spawn failure — the exact lifecycle the shell needs.
    - Windows `CreateProcessW` guardrail notes (never spawn a `.bat`).
  - `.github/workflows/release.yml` — matrix release build
    (macOS aarch64+x86_64, ubuntu, windows), draft release, updater
    `latest.json`, plus homebrew/AUR/winget notify flows.
  - `entitlements.plist`, `assets/icons/`, updater pubkey + endpoints.

## 4. Target layout (end state)

```
zosma-cowork/
├── web/                        # = zosma-harness, copied by value
│   ├── app/ components/ hooks/ lib/ bin/ public/ docs/ ...
│   ├── package.json            # renamed (see §7.3)
│   ├── next.config.ts          # + output: "standalone" (see §9.3)
│   └── package-lock.json       # lockfile kept: npm
├── src-tauri/                  # THIN shell (rewritten, kept)
│   ├── src/main.rs             # ~10 lines
│   ├── src/lib.rs              # ~200 lines: window + port + spawn + lifecycle
│   ├── tauri.conf.json         # window url → http://127.0.0.1:30141
│   ├── capabilities/default.json
│   ├── scripts/fetch-node.mjs  # unchanged
│   └── icons/ ...
├── assets/                     # logo/icons (kept)
├── entitlements.plist          # kept (macOS signing)
├── .github/workflows/release.yml  # simplified (Phase 4)
└── docs/                       # this doc, DESIGN.md, ... (kept)

# Removed in Phase 5 only, after green smoke:
src/ index.html mobile.html agent-sidecar/ vite.config.ts
tsconfig.json tsconfig.node.json vitest.config.ts biome.json biome.jsonc
package.json(pnpm) pnpm-lock.yaml lockfile.bun  (top-level frontend bits)
```

The repository name, product name, updater endpoint, homebrew tap, AUR and
winget entries are **unchanged** unless §14 Q1 says otherwise — that is the
cheap path; a rename cost ≈5 release-plumbing touchpoints.

## 5. How each run mode works

### 5.1 Web mode (no Tauri)

```bash
git clone <repo>
cd zosma-cowork/web
npm ci
npm run build        # never while `npm run dev` on 30141 is running
npm start            # or: pi-web   (bin entry, same effect)
# → http://127.0.0.1:30141
```

`pi-web` is also usable when the package is published — the npm-publish path
stays intact (`npm run release` script, `files` allowlist).

### 5.2 App mode (self-contained, recommended)

1. Tauri `setup` hook: TCP-connect probe to `127.0.0.1:30141` (250 ms
   timeout).
   - **Reachable** → assume user already ran the server; attach (do not kill
     on quit — we don't own it).Mark state `borrowed`.
   - **Not reachable** → resolve bundled Node from resources
     (wildcard `node*` → platform binary name, same table as
     `fetch-node.mjs`), resolve web server entry from the resource path
     (logic copied from `find_sidecar_path`), spawn:
     `<node> <resource>/web/bin/pi-web.js --port 30141`
     with stdout/stderr piped into the Tauri log. Wait for the port to become
     reachable (≤ 30 s) before showing the window; on timeout, show an error
     dialog with the captured server log tail.
2. Window (already configured with `url: http://127.0.0.1:30141`) loads the
   app.
3. `RunEvent::Exit`/`ExitRequested`: if state is `owned`, kill the child, then
   wait for clean exit (5 s) before final quit.

### 5.3 Bare-shell variant (fallback, tiny bundle)

Same shell, but step 1 when the port is unreachable shows a status page
("server not running — start it with `pi-web`") instead of spawning. No
`web/` or `binaries/node*` resources → bundle shrinks to a few MB. Chosen by
a build flag (`ZOSMA_SHELL_BARE=1`), not a second repo.

## 6. Phase plan

> Every phase ends on the feat branch with a green typecheck/lint/test and a
> smoke entry in §12. No phase merges to `main` alone; the branch merges as
> one PR at the end of Phase 4 (or per-phase if review prefers — §14 Q3).

### Phase 0 — Prep (done / trivial)

- [x] `feat/web-ui-shell` cut from fresh `origin/main` (`19404c663`).
- [ ] Stop the local `next dev` (port 30141) before any `next build`
      (AGENTS.md rule). The PID is discoverable via
      `ss -ltnp | grep 30141`.

### Phase 1 — Import `web/` (copy, no deletes — D1)

1. Compile the copy from the working tree, excluding: `.git`, `.next`,
   `node_modules`, `tsconfig.tsbuildinfo`, `bun.lock`, `pnpm-lock.yaml`.
   Keep exactly one lockfile: `package-lock.json` (web/ scripts are npm).

   ```bash
   rsync -a \
     --exclude .git --exclude .next --exclude node_modules \
     --exclude tsconfig.tsbuildinfo --exclude bun.lock --exclude pnpm-lock.yaml \
     /home/arjun/code/zosmaai/zosma-harness/ ./web/
   ```

2. **Do not** build in-place on the first pass; just copy, then commit.
   Building is Phase 3.
3. Keep `.pi/` and `docs/` from the harness — project knowledge travels with
   the code.

**Commit 1:** `feat(web): import zosma-harness web UI into web/`

### Phase 2 — Thin Tauri shell

Rewrite `src-tauri/src/lib.rs` (keep only the parts called out below) and
`tauri.conf.json`:

```jsonc
{
  "productName": "zosma-cowork",           // unchanged
  "identifier": "ai.zosma.cowork",         // unchanged
  "build": {
    // No local frontend. devUrl == prod URL.
    "devUrl": "http://127.0.0.1:30141",
    "frontendDist": null                    // see §11 R1 if Tauri rejects null
  },
  "app": {
    "windows": [
      {
        "title": "Zosma",
        "url": "http://127.0.0.1:30141",
        "width": 1440, "height": 900,
        "minWidth": 800, "minHeight": 600,
        "center": true
      }
    ],
    "security": { "csp": null }             // unchanged (required: we load a remote (loopback) origin)
  },
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": true,
    "targets": "all",
    "resources": [
      "binaries/node*",                     // unchanged
      "web/dist-server/**/*"                // standalone output, see §9.3
    ],
    "icon": [ /* unchanged */ ]
  }
}
```

#### Rust sketch (≈ the whole shell)

```rust
// main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { zosma_cowork_lib::run() }
```

```rust
// lib.rs (shape, not final)
pub const SHARED_PORT: u16 = 30141;

#[derive(Default)]
struct ServerState { child: Option<std::process::Child>, owned: bool }

#[tauri::command]
fn server_status(state: tauri::State<ServerState>) -> serde_json::Value { /* ... */ }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if port_open(&handle) {
                    // borrowed: user's server. Do not kill on quit.
                    return;
                }
                let (node, entry) = resolve_server_paths(&handle); // copied from find_sidecar_path
                let child = std::process::Command::new(&node)
                    .arg(&entry)
                    .args(["--port", &SHARED_PORT.to_string()])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .expect("spawn bundled node");
                // pipe logs → tauri log::info (keep a bounded tail for error dialog)
                // wait port_open ≤ 30 s, else emit error + show dialog
                handle.state::<ServerState>().child = Some(child); owned = true;
            });
            Ok(())
        })
        .on_window_event(|_, tauri::WindowEvent::CloseRequested { api, .. }| {
            // kill owned child, wait ≤5 s, then api.prevent() cancel
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Reused verbatim from today's `lib.rs`: the platform-path table in
`find_sidecar_path` (repointed at `web/dist-server`), the `Child`-owned
exit-watcher, and the Windows "never spawn a text file" guard.

**Commit 2:** `feat(shell): Tauri window pinned to 127.0.0.1:30141 with owned/borrowed server lifecycle`

### Phase 3 — Build & package locally

1. `cd web && npm ci && npm run build` (dev server stopped).
2. Add `output: "standalone"` to `next.config.ts`; copy
   `.next/standalone/**` → `web/dist-server/` (plus `web/public` and
   `.next/static` per Next's standalone docs) as the **resource layout** the
   shell resolves.
3. `npm run tauri dev` → manual smoke (§12 A1–A4).
4. `npm run tauri build` (Linux, on this machine) → install the `.deb`,
   smoke (§12 B1–B3).

**Commit 3:** `build(web): standalone server output + shell resources`

### Phase 4 — CI (simplify `release.yml`)

- Keep: matrix runners, Node setup, `fetch-node.mjs`, tauri-action, draft
  release + `latest.json` gating, homebrew/AUR/winget notify jobs.
- Delete: `fetch-gh.mjs` / `fetch-git.mjs` / `ensure-dev-resources.mjs` /
  `prebuild.mjs` steps (no more sidecar git/gh binaries, no Vite build).
  *Re-check each script's remaining consumers before deleting — only remove
  what the shell doesn't import.*
- `beforeBuildCommand` becomes:
  `npm ci --prefix web && npm run build --prefix web` (standalone layout step
  folded into a small `web/scripts/package-server.mjs`).
- `beforeDevCommand`: `npm run dev --prefix web` (the shell's devUrl already
  points at the same port; dev server is owned by the developer unless the
  probe finds one).
- **Commit 4:** `ci(release): build web/ and thin shell, drop Vite-era steps`

### Phase 5 — Removal (only after §12 B5 green on ≥2 platforms)

```bash
git rm -r src index.html mobile.html agent-sidecar vite.config.ts \
  tsconfig.json tsconfig.node.json vitest.config.ts biome.json biome.jsonc \
  pnpm-lock.yaml lockfile.bun package.json
# rewrite: top-level README.md (run modes), AGENTS.md (web/ + shell notes),
# package.json (tauri CLI scripts only: dev/build/tauri)
```

**Commit 5:** `chore: remove Vite/React frontend and agent-sidecar`

## 7. `web/` package identity

| Field | From | To |
|-------|------|----|
| `name` | `@agegr/pi-web` | `@zosma-harness/web` (internal; npm-published name only if/when publishing) |
| `version` | 0.8.9 | keep (independent versioning vs. app release; app version stays Tauri's) |
| `repository` / `homepage` / `bugs` | agegr URLs | zosma-cowork URLs (`web/` path) |
| `bin` | `pi-web` | unchanged |
| `files` | unchanged | unchanged (`.next`, `bin`, `public`, …) |

## 8. Port & config contract

- Single port constant **30141**, defined once in `src-tauri/src/lib.rs`
  (`SHARED_PORT`) and referenced from `web/package.json` scripts.
  A CI `grep` guard (small script in Phase 4) fails the build if the two
  disagree.
- Loopback-only by default. LAN mode (`-H 0.0.0.0`, `start:lan`) remains a
  pure web-mode feature; the shell never enables it.

## 9. Web build specifics

1. **Never `next build` while dev runs** on 30141 (pollutes `.next/`, breaks
   dev server) — scripted in `package-server.mjs`: refuses to run if
   127.0.0.1:30141 answers.
2. `next build --webpack` unchanged (AGENTS.md).
3. `output: "standalone"` produces a minimal server (`server.js` + reduced
   `node_modules`). `serverExternalPackages` in `next.config.ts` already
   lifts the pi SDK packages out of the bundle — the standalone output keeps
   them external, so `dist-server` also needs the real
   `node_modules/@earendil-works/*` + `undici`. `package-server.mjs` copies
   exactly the packages from that list (read from the config, no hardcoding).
4. `pi-web.js` currently resolves the built app as `pkgDir/.next` — it works
   unchanged from `dist-server` because the layout (`server.js`, `package.json`,
   `.next/`) is preserved.

## 10. Updater / distribution notes

- Updater endpoint, pubkey, `identifier`, product name unchanged → in-place
  updates from v0.18.x continue. **Bundle size will change a lot** (old:
  React+sidecar; new: node+web). Document in release notes; first release on
  the new shell cuts a minor bump suggestion (v0.19.0) so support can
  distinguish builds.
- macOS: continue signing with existing entitlements + certs flow
  (apple-certs repo). No new entitlements needed (we only child-process a
  local binary — same as today's sidecar).
- Windows: never wrap the node invocation in a `.bat` (existing
  `CreateProcessW` lesson).
- Linux: keep both `appimage` and `deb`; the path table already covers
  `/usr/lib/zosma-cowork/`.

## 11. Risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Tauri 2 may require a non-null `frontendDist` at `generate_context!` even with an explicit window `url` | Fallback (5 lines): `frontendDist: "../shell-dist"` containing only `index.html` with `<meta http-equiv="refresh" content="0;url=http://127.0.0.1:30141">`. Verify on **first** `tauri build` of Phase 2, before any packaging work. |
| R2 | A stale/lingering server on 30141 (from web mode) gets "borrowed" and the app shows another user's working session | Probe + identical port is by design; error dialog offers "open in browser" & "quit". Documented in the status surface. |
| R3 | `standalone` output missing an external package at runtime on another OS | Phase 3 smoke on the second platform (CI linux job) before Phase 5; the package list is derived from `serverExternalPackages`, not typed. |
| R4 | Node v24.15.0 vs web `engines >= 22.19` | Already satisfied; `pi-web.js` re-checks at runtime and exits with a clear message. Keep both values reviewed on Node bumps (one-line note in `fetch-node.mjs`). |
| R5 | Dev-server kill on app quit kills a user's manually started server | `owned` flag: children we spawned are killed; pre-existing listeners are never touched. |
| R6 | Copy divergence: zosma-harness keeps evolving outside the copy | For the lifetime of this branch, zosma-harness is frozen at "adopt-as-of" state; after Phase 5 it is deleted. (If adoption slips, re-sync with the same rsync command before Phase 5.) |
| R7 | Old frontend deletion (Phase 5) breaks something we didn't audit | Gate: §12 B5 must pass on macOS **and** Linux **and** Windows CI artifacts; Phase 5 is a separate squashed commit, trivially revertible. |

## 12. Smoke checklist

**A — local dev (Phase 2):**
1. `npm run dev --prefix web` + `npm run tauri dev` → window shows the web UI at 30141.
2. Kill dev server, relaunch `tauri dev` → shell spawns its own server; UI loads.
3. Quit app → child node process is gone (`ss -ltnp | grep 30141` empty).
4. Start `npm start` manually, launch app → app borrows, quit leaves server running.

**B — packaged (Phase 3/4):**
1. Fresh user VM/ Forge runner: install artifact → launch → UI loads with zero
   command line.
2. First launch with `~/.pi` absent → app creates it (existing pi behavior;
   confirm welcome flow works from the shell).
3. Kill the app from task manager / force-quit → no orphan `node` process.
4. Update from a pre-migration build via shipped `latest.json` (or note the
   first-release cutoff).
5. **Deletion gate:** full checklist A+B green on macOS (arm64), Linux (deb),
   Windows (msi) before Phase 5 lands.

## 13. Observability

- Shell logs: `tauri` + piped server stdout/stderr, tagged `[web-server]`,
  bounded ring (last ~200 lines) surfaced in the error dialog.
- Web server already exposes `/api/...` health implicitly (HTTP 200 on `/`).
- No new Sentry dependency in the shell (the old frontend's Sentry is removed
  with it). Revisit only if a real error rate appears.

## 14. Open questions (need answer before Phase 5 / merge)

| # | Question | Cheap default |
|---|----------|---------------|
| Q1 | Keep name/identifier `zosma-cowork` / `ai.zosma.cowork`? | **Keep.** Rename = updater endpoint + homebrew + AUR + winget + README rework. |
| Q2 | Self-contained (D5) vs bare shell default for releases? | **Self-contained**; bare via build flag. |
| Q3 | One PR at the end vs per-phase PRs? | One PR (branch is additive until Phase 5; history stays readable with 5 commits). |
| Q4 | First release on new shell: v0.19.0 minor bump? | Yes. |
| Q5 | Is zosma-harness's `@agegr/pi-web` npm publish path still wanted? | Keep scripts, don't publish during migration. |

## 15. Rollback

- Phases 1–4 are additive. `git reset --hard main` on the branch discards
  everything; nothing in `main` or users' machines is affected until merge.
- After merge, `git revert -m 1 <merge>` restores the old app (old files were
  only deleted in Phase 5, so reverts of the *whole* branch are clean only
  pre-Phase-5; post-Phase-5 rollback = revert commit 5 + commit 4).
- Running users are unaffected at all times: the machine's current install
  keeps working regardless of branch state.

## 16. Doc sync

This file must be kept in two places, byte-identical:

- `zosma-cowork/docs/web-ui-shell-migration.md` (this one, on
  `feat/web-ui-shell`)
- `zosma-harness/docs/web-ui-shell-migration.md` (copy)

Sync manually with `cp` when both change; a CI grep guard is not worth it at
this stage.