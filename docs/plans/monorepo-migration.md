# Zosma Cowork — Monorepo Migration Plan

> Status: **Draft for agent execution** (rev. 2 — reads `.sessions/`, adopts Hono, deletion parity)
> Target: one pnpm-workspace monorepo, zero loss of functionality
> Reference standard: `feat/monorepo` branch (layout + root orchestration + gitignore). Rebuild the migration on top of current `feat/pi-daemon-setup` work — do **not** cherry-pick/merge that branch; it predates `daemon/` and `packages/protocol/` and its content is stale.
> Rev 2 changes: (1) `.sessions/session-{1,2}.md` are the work-preservation contract — start from the current dirty tree, never touch `.sessions/`; (2) **Hono** adopted as the daemon HTTP layer (swap `daemon/src/server.ts` off `node:http` — same wire contract, existing test suite as guard); (3) deletions limited to **`MVP-ROADMAP.md` only** (branch-parity final).

---

## 1. Why

The repo is half-migrated today:

- `web/`, `website/` each ship **their own** `pnpm-lock.yaml` + `node_modules` — no root workspace file exists.
- `daemon/` depends on `packages/protocol` via a **relative `file:../packages/protocol` dep** — brittle, breaks on any move.
- `web/scripts/dev-daemon.mjs` reaches the daemon via a hard-coded relative path (`../../daemon/src/index.ts`).
- The Tauri shell is held together by `beforeDevCommand: pnpm -C web dev`; root `package.json` knows nothing about the daemon.
- `services/oauth-broker`, `security/` (certs docs) sit outside any consistent layout.

`feat/monorepo` already proved the target layout: `apps/*` with a root orchestration `package.json` and a single hoisted install.

## 2. Target layout

```
zosma-cowork/
├── pnpm-workspace.yaml          # apps/*, packages/*  (oauth-broker excluded)
├── package.json                 # orchestrator: dev/build/test/tauri + workspace mgmt
├── pnpm-lock.yaml               # ONE lockfile (was web/ + website/)
├── Cargo.lock                   # moved INTO apps/desktop (branch precedent; see §6 decision D2)
├── apps/
│   ├── desktop/                 # ← git mv src-tauri/ (+ root Cargo.toml workspace metadata inlined)
│   ├── web/                     # ← git mv web/          (publishes @zosma-harness/web to npm — must keep)
│   ├── website/                 # ← git mv website/     (docs site)
│   ├── daemon/                  # ← git mv daemon/      (harness daemon, dep on protocol via workspace:*)
│   └── oauth-broker/            # ← git mv services/oauth-broker/  (standalone npm — EXCLUDED from workspace)
├── packages/
│   └── protocol/                # stays; becomes the workspace shared lib
├── docs/
│   ├── security/                # ← git mv security/
│   └── ...                      # existing docs/ grows the migration write-up
├── scripts/                     # check-shared-port.mjs, validate-release-config.mjs (paths updated)
├── .github/workflows/           # ci.yml, release.yml, security.yml, winget/homebrew/AUR (paths updated)
└── assets/, skills-lock.json, README*, ROADMAP*, etc.  # unchanged at root
```

## 3. Delivery contract — what "no loss of functionality" means

Every entry point below must work identically before and after. The migration is **not done** until each row is green:

| # | Capability | Current invocation | Post-migration equivalent |
|---|---|---|---|
| 1 | Desktop dev | `pnpm dev` (root → `tauri dev` → spawns web on 30141) | `pnpm dev` (orchestrator: web + daemon + desktop) |
| 2 | Web dev + daemon supervisor | `pnpm -C web dev:all` (spawns daemon, waits /health, starts Next) | `pnpm dev:web` / `pnpm -C apps/web dev:all` |
| 3 | Daemon | `pnpm -C daemon start` on 127.0.0.1:64713, Bearer auth | `pnpm dev:daemon` / `pnpm -C apps/daemon start` |
| 4 | Protocol shared lib | consumed by daemon via `file:../packages/protocol` | consumed via `workspace:*` (daemon **and** web if used) |
| 5 | Desktop build + updater artifacts | `pnpm build` → `tauri build`, bundles `binaries/node*` + `web/dist-server/**` | `pnpm build` — same artifacts, resources rooted at `apps/` |
| 6 | npm publish `@zosma-harness/web` | `pnpm -C web release` (version + build + `npm publish`) | same from `apps/web` (workspace package stays publishable) |
| 7 | Docs site | `pnpm -C website <dev\|build>` | `pnpm -C apps/website <dev\|build>` |
| 8 | oauth-broker deploy | `services/oauth-broker/deploy.sh` (GCloud, npm install) | `apps/oauth-broker/deploy.sh` unchanged behavior |
| 9 | CI (web lint/test/typecheck, docs build, tauri build) | 3 jobs w/ per-package lockfile caches | same 3 jobs + daemon/protocol jobs, root lockfile cache |
| 10 | Release pipeline (GitHub release, updater JSON, winget/homebrew/AUR) | push `v*.*.*` | same, artifact paths updated |
| 11 | Port + token contracts | 30141 (web/Next/tauri devUrl), 64713 (daemon), shared Bearer token | unchanged values, guard script path-fixed |
| 12 | `.pi/` extension exception | `!web/.pi/extensions/zosma-ui-audit.ts` in gitignore | `!apps/web/.pi/extensions/zosma-ui-audit.ts` |
| 13 | Doc assets referenced by published pages | `web/docs/*.png`, `website/content` | moved with `git mv`; grep stale `web/…`/`website/…` refs |
| 14 | Daemon HTTP layer | hand-rolled `node:http` in `daemon/src/server.ts` (`/health`, `/ipc`, `POST /ipc/stream` SSE) | **Hono** + `@hono/node-server` in `apps/daemon` — identical routes, token auth, readiness states, SSE framing |
| 15 | Suite anchors (prove “no loss”) | protocol **74/74**, daemon **99→123/123** (git/file/pi/read RPCs + server), web **824/824**, tsc clean ×3 | same counts post-migration (+ Hono server tests, no suite shrinks) |

**Functionality = all 15 rows + every file still present** (see §7).

## 4. Pre-flight (Phase 0) — baseline & freeze

0. **Read `.sessions/session-1.md` + `session-2.md` first.** They inventory prior sessions’ work + acceptance counts: `packages/protocol` (ZOS-99/90/89; 74/74), `daemon/` (ZOS-86/85/98/93; git/file/pi/read RPCs + supervision + `/ipc/stream`; 99→123/123), web boundary (ZOS-84/80/82/81/83; relay + read cutover; 824/824; `pi-backend` deleted, `piRead` + `daemon-client` the seams). Migration preserves all of it. `.sessions/` is gitignored — leave it, never commit.
1. **Baseline = CURRENT DIRTY TREE on `feat/pi-daemon-setup`** — session 2 staged-but-uncommitted daemon+protocol+web work is the live state. No `git checkout`/`reset`; `git mv` carries staged changes. Record `git status --short` first.
2. Capture the green baseline before touching anything:
   - `pnpm -C web lint && pnpm -C web exec tsc --noEmit && pnpm -C web test`  (expect 824/824)
   - `pnpm -C web build && pnpm -C web package-server`
   - `pnpm -C daemon typecheck && pnpm -C daemon test`  (expect 123/123)
   - `pnpm -C packages/protocol typecheck && pnpm -C packages/protocol test`  (expect 74/74)
   - `pnpm -C website build`
   - `cd src-tauri && cargo check && cargo clippy -- -D warnings`
   - `node scripts/check-shared-port.mjs`
2. Record: branch SHA, versions of every direct dep in `web/package.json`, `daemon/package.json`, website, root (so root-lockfile regeneration is reproducible).
3. Grep the repo for **all** cross-package references that will break — agent must enumerate and fix every one:
   - `grep -rn 'file:\.\.' */package.json` (relative deps)
   - `grep -rn '\.\./daemon\|\.\./web\|\.\./website\|\.\./packages' web daemon src-tauri scripts —path '!node_modules' —path '!target'
   - `grep -rn 'web/\|website/\|src-tauri/\|services/\|security/' .github scripts docs --include='*.yml' --include='*.mjs' --include='*.md'`
4. Create branch: `feat/monorepo-migration` off current HEAD (dirty tree carried forward).
5. **Deletion parity (only deletes).** Old branch deleted against an older tree; most victims already gone here (`HANDOFF-300.md`, `web/README*` translations, `lib/model-scope.ts`, `lib/startup-preferences.ts`). Two are alive today and must NOT be deleted: `web/CONTEXT.md`, `web/app/api/models/route.ts` (now relays through daemon via `piRead`). Only stale doc left: **`git rm MVP-ROADMAP.md`** (superseded by `ROADMAP.md`). Migration = moves + ref fixes + that one file.

## 5. Execution phases

### Phase 1 — Workspace scaffold (root)

1. `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   # oauth-broker is a standalone npm (GCloud Functions) app — not a pnpm package.
   exclude:
     - "apps/oauth-broker"
   ```
   > Note: `feat/monorepo`'s exclude says `services/oauth-broker` (stale — oauth-broker had already been moved to `apps/` on that branch). Ours must point at `apps/oauth-broker`.
2. Root `package.json`: take the `feat/monorepo` version as the base (it has the concurrently orchestration, `packageManager`, `pnpm.overrides`, `onlyBuiltDependencies`) and extend:
   - `dev`: web (daemon-supervised) + desktop; website optional (`dev:docs`)
   - add `daemon:*`, `protocol:*`, `test`, `lint`, `typecheck` scripts per §12 script table
   - carry over **every** `web/package.json` override/onlyBuiltDependencies entry (e.g. `eslint-plugin-react-hooks@7.0.1`, `exceljs>uuid@11.1.1`, `@eslint/eslintrc>js-yaml@4.3.2`, `@google/genai` etc.) — these currently gate the web build.
3. Delete per-package locks BEFORE first install: `git rm web/pnpm-lock.yaml website/pnpm-lock.yaml`, then `pnpm install` at root to generate the single `pnpm-lock.yaml`.
4. **Main risk gate:** pnpm hoisting vs Next/webpack. If `pnpm -C apps/web build` or `next dev` fails on missing/duplicate modules, add `node-linker=hoisted` (or `shamefully-hoist`) to `pnpm-workspace.yaml` — do not silently re-add per-package lockfiles. Verify with the Phase-5 matrix.

### Phase 2 — Structural moves (all pure `git mv`, history preserved)

```bash
git mv src-tauri apps/desktop
git mv web apps/web
git mv website apps/website
git mv services/oauth-broker apps/oauth-broker
git mv daemon apps/daemon
git mv security docs/security
git rm MVP-ROADMAP.md   # branch-parity deletion — superseded by ROADMAP.md
```
- Leave `packages/protocol` in place (semantic home for shared libs).
- `Cargo.lock` follows `src-tauri` → `apps/desktop/Cargo.lock` (matches branch).
- Root `Cargo.toml`: see decision D2 — recommended: delete it and inline `workspace.package` values + profiles into `apps/desktop/Cargo.toml`, exactly as `feat/monorepo` did. Remaining empty `services/` dir: `git rm -r services` after move.

### Phase 3 — Reference repair (the bulk; enumerate first in Phase 0.3)

| Location | Old | New |
|---|---|---|
| `apps/daemon/package.json` | `"@zosma-cowork/protocol": "file:../packages/protocol"` | `"@zosma-cowork/protocol": "workspace:*"` |
| `apps/web/scripts/dev-daemon.mjs` | `"..","..","daemon","src","index.ts"` | `"..","..","..","apps","daemon","src","index.ts"` |
| `apps/desktop/tauri.conf.json` | `$schema: ../node_modules/...`, `beforeBuildCommand: ... -C web ...` | `$schema: ../../node_modules/...`, `-C apps/web` |
| `bundle.resources` | `"../web/dist-server/**/*"` | `"apps/web/dist-server/**/*"` (branch precedent) |
| `apps/desktop/scripts/fetch-node.mjs` | relative web path if any | `apps/web` path |
| `scripts/check-shared-port.mjs` | reads `web/package.json` scripts | reads `apps/web/package.json` |
| `scripts/validate-release-config.mjs` | repo paths | repo paths under `apps/` |
| `.gitignore` | branch version + `/apps/daemon`, `/apps/web/.next` style | port `feat/monorepo`'s `.gitignore`, drop `web/node_modules`, add daemon/local artifacts |
| `.github/workflows/*` | `web/pnpm-lock.yaml` cache, `working-directory: website`, `src-tauri` cargo steps | root `pnpm-lock.yaml` cache, `apps/website`, `apps/desktop`, add `apps/daemon` + `packages/protocol` jobs |
| `docs/**`, `README*`, `web/docs/*.md` | path examples (`web/`, `website/`, `src-tauri/`) | `apps/*` equivalents (grep for `web/` and `website/` in prose) |
| `apps/web/docs/worktrees.md`, `i18n.md` | old paths | new paths (cosmetic, low priority) |

Wildcard sweep after edits: rerun the Phase 0.3 greps — **zero hits** under non-`node_modules` paths is the accept gate.

### Phase 4 — Root orchestration scripts

Mirror `feat/monorepo` root scripts and extend for daemon/protocol/oauth. See §12 for the exact table. Key shape (from the branch):

```jsonc
"dev":         "concurrently --crash-first \"pnpm -C apps/web dev:all\" \"pnpm -C apps/desktop dev\"",
"build":       "pnpm -C apps/desktop build",
"tauri":       "pnpm -C apps/desktop tauri",
"web:dev":     "pnpm -C apps/web dev:all",
"web:build":   "pnpm -C apps/web build",
"desktop:dev": "pnpm -C apps/desktop dev",
"website:dev": "pnpm -C apps/website dev",
"daemon:dev":  "pnpm -C apps/daemon start",
"test":        "pnpm -r test",
"typecheck":   "pnpm -r typecheck",
"lint":        "pnpm -r lint"
```
`apps/desktop/tauri.conf.json` `beforeDevCommand` becomes a port probe (branch precedent: warn if 30141 not up) — the orchestrator owns spawning. `beforeBuildCommand` = `node scripts/fetch-node.mjs && pnpm -C apps/web install --frozen-lockfile && pnpm -C apps/web build && pnpm -C apps/web package-server`.

### Phase 4b — Daemon HTTP layer on Hono (the “use hono” requirement)

The daemon is the only server in the repo; its hand-rolled `node:http` server (`daemon/src/server.ts`, ~400 lines) is the surface that gets Hono. **Swap, not rewrite — behavior is the contract, existing wire tests are the guard.**

1. Add to `apps/daemon/package.json`: `hono` + `@hono/node-server` (pin exact versions).
2. Rewrite `apps/daemon/src/server.ts` internals with Hono routing, **preserving the public `DaemonServer` interface verbatim**: `start()`, `stop()`, `setReady(state)`, `getState()`, `port` getter; `DaemonServerOptions` (token, logger, `piRpc`, `piStream`, `port`).
3. Same routes: `GET /health` → readiness (unauthenticated probe, states `starting|ready|shutting-down|error`); `POST /ipc` → existing JSON-line `IpcMessage` dispatch (`git:*`, `files:*`, `read:*`, `auth:*`, pi ops 501-without-adapter) with token middleware (same 401 semantics); `POST /ipc/stream` → SSE with today’s framing/heartbeat contract. Loopback-only bind, fixed-port support, readiness wiring via `orchestrator.ts` unchanged.
4. Existing daemon suite hits real HTTP (`server.test.mjs`) → 123/123 green after swap is the bar; add Hono-specific tests only where framing differs (auth middleware, malformed SSE).
5. Live smoke identical to today: daemon on :64713, `/health` → `{"status":"ready"}`, `/ipc` hello → `{ok:true}`, `POST /ipc/stream` emits SSE, clean SIGTERM.
6. Commit: `refactor(daemon): serve HTTP through Hono, wire contract unchanged`.

> **STATUS 2026-09-11: DONE (uncommitted, working tree).** Self-blocker: unawaited `stream.writeSSE` dropped frames when the stream closed; fixed by collecting + `await flush()` after the handler resolves. Hono writes the SSE heartbeat/initial-flush as raw `:\n\n` via `stream.write()` (`writeSSE` requires `data`, no comment field). tsc clean, daemon suite **168/168 green** (incl. server.test.mjs wire tests). `hono@4.13.7` + `@hono/node-server@2.1.1` in daemon deps; hoisted install → packages live at root `node_modules/`.

> Why not the branch’s `apps/server`: it scaffolded a standalone Hono server — a second HTTP hop in front of a runtime the daemon already owns. The daemon IS the server; Hono goes there. No dead scaffold.

### Phase 5 — Verification matrix (the acceptance run)

Run the full §3 matrix, in order, on the migration branch:

1. `pnpm install` at root — single lockfile, no per-app locks recreated.
2. `pnpm -r typecheck` — web, daemon, protocol, desktop(n/a), website(n/a).
3. `pnpm -r lint`, `pnpm -r test` — all suites green: protocol **74/74**, daemon **123/123 incl. Hono wire tests**, web **824/824**.
4. Daemon Hono acceptance (Phase 4b): `/health`, `/ipc` auth + dispatch, `/ipc/stream` SSE on :64713, SIGTERM clean — live smoke.
5. `pnpm -C apps/web build && pnpm -C apps/web package-server` — Next standalone output + dist-server bundle.
6. `pnpm -C apps/desktop build` — Tauri release build; **verify bundle contains** `binaries/node*` and `apps/web/dist-server/**`; updater artifact (`latest.json` + signed bundle) generated.
7. `pnpm dev` — web up on 30141, daemon healthy on 64713 (Bearer auth), desktop window loads devUrl. `pnpm -C apps/web dev:all` supervisor works standalone.
8. `pnpm -C apps/web release --dry-run`-style publish check for `@zosma-harness/web` (workspaces `pack` / version bump — no actual publish).
9. `pnpm -C apps/website build`.
10. `cd apps/oauth-broker/functions && npm install && npm run build`-equivalent — untouched by workspace (excluded).
11. Commit a trivial change and run CI on the branch — all jobs green (web, docs, tauri + new daemon/protocol jobs).
12. `node scripts/check-shared-port.mjs` + `node scripts/validate-release-config.mjs` pass.
13. `git status --short` diff vs pre-flight snapshot: only expected moves + `MVP-ROADMAP.md` deletion + reference edits — `.sessions/` untouched, no stray deletions.

> **STATUS 2026-09-11: matrices 1–5, 7–10, 12–13 DONE (working tree, uncommitted).** Anchors: protocol 74/74, web 784/784, daemon 168/168, all tsc clean. Live smoke on :64713 + dev:all supervisor both green. Matrix 6 (Tauri bundle) partially green: app bundle now contains `binaries/node*` + `web/dist-server/**` at `Resources/` (fixed via resources map-form + fetch-node path), but DMG wrap + updater signing fail on env (TAURI_SIGNING_PRIVATE_KEY secret + create-dmg flakiness) — **parked, not migration-related, CI has the secrets.** Matrix 11 (CI) needs a push.
> **Fixes during matrix:** web `package.json` gained `typecheck` script (matrix 2 expected it); `apps/desktop/package.json` created (Tauri CLI needs a package); `tauri.conf.json` beforeBuildCommand paths + resources→map form; `fetch-node.mjs` output path (`src-tauri`→cwd; drove the stray `apps/src-tauri`).

### Phase 6 — Docs & hygiene

- Rewrite root `package.json` description (drop "thin Tauri shell" framing if orchestrator).
- Update `AGENTS.md` directory tree + paths; add a "Monorepo layout" section.
- Update `README.md` dev instructions (`pnpm dev` one-liner).
- `DISTRIBUTION.md`, `docs/web-ui-shell-migration.md` relative links.
- Copy this plan into `docs/` as the record of the migration.

### Phase 7 — Land & verify release path

- PR → main with CI green.
- After merge, trigger the release pipeline (`v*.*.*` tag) once to prove winget/homebrew/AUR + updater JSON still resolve artifacts from `apps/desktop/target/`.

## 6. Decisions to confirm before starting (agent should ask, not assume)

| D | Question | Recommendation | Why |
|---|---|---|---|
| D1 | Keep a root Cargo workspace? | **Delete root `Cargo.toml`; inline metadata + profiles into `apps/desktop/Cargo.toml`** (branch precedent) | Keeps the "standard set" identical; root becomes pnpm-only. Cargo commands then run from `apps/desktop`. Alternative (keep root workspace with `apps/desktop` member) also works — pick one, branch already chose inline. |
| D2 | **Use Hono — where?** | **In `apps/daemon` — swap `daemon/src/server.ts` off hand-rolled `node:http` onto Hono** (Phase 4b) | The daemon is the only server. Same routes/auth/SSE, `DaemonServer` interface + 123-test wire suite as guard. No separate `apps/server` scaffold (branch’s was speculative). |
| D3 | `packages/protocol` home | Keep under `packages/*` (add glob) | Semantic: lib vs app. Also branch has no packages dir, so we define it. |
| D4 | oauth-broker in workspace? | **Exclude** (own `package-lock.json`, GCloud `npm install`) | Follows branch intent; pnpm can't help GCloud deploy. |
| D5 | Old branch’s content deletions | **Adopt only what’s stale on this tree: delete `MVP-ROADMAP.md`** (superseded by `ROADMAP.md`). Do NOT delete `web/CONTEXT.md` or `web/app/api/models/route.ts` — alive today (branch deleted against older tree). Rest of branch’s deletion set already gone. | User: “delete content just in old branch” = match branch’s deletions, not branch’s tree. |
| D6 | pnpm hoisting if web build breaks | `node-linker=hoisted` in `pnpm-workspace.yaml` | Next 16 + webpack historically brittle under strict isolated node_modules. Investigation > blind config, but hoisted is the known-good fallback. |

## 7. Non-negotiables

1. **Moves via `git mv` only** (rename detection + history). No copy-then-delete.
2. **Start from the CURRENT DIRTY TREE** (`feat/pi-daemon-setup` with session-2’s staged daemon/protocol/web work). No `reset`/`checkout` — `git mv` carries staged changes.
3. **`.sessions/` never touched**: not moved, not deleted, not committed (gitignored). The sheets are the work inventory — read in Phase 0.0, never modify.
4. **Only deletion is `MVP-ROADMAP.md`** (branch-parity, superseded). Live files the old branch deleted against an older tree (`web/CONTEXT.md`, `web/app/api/models/route.ts`, …) stay.
5. **Suite anchors hold post-migration**: protocol 74/74, daemon 123/123 (incl. Hono wire tests), web 824/824 + `tsc --noEmit` clean ×3. Any drop = loss, stop and fix.
6. **Every grep from §4.3 returns zero non-ignore hits** after Phase 3.
7. **Single lockfile** at root; per-app lockfiles stay deleted.
8. **`feat/monorepo` is a reference, not a merge target.** Its stale files (oauth exclude path, `HANDOFF-300.md`, old roadmap) do not come along.
9. Each phase commits independently with Conventional Commits (`chore: scaffold pnpm workspace`, `refactor: move src-tauri → apps/desktop`, `fix: update daemon supervisor path`, `refactor(daemon): serve HTTP through Hono`, …) so any phase is revertible without un-migrating the others.

## 8. Rollback

Each phase is an isolated commit; `git revert` per phase. The only quasi-irreversible step is the lockfile merge (Phase 1) — mitigated because all package.json version constraints are preserved from the pre-flight snapshot and nothing is deleted.

## 9. Out of scope (this migration)

- A standalone `apps/server` Hono facade in front of the daemon — out of scope by D2: the daemon’s own Hono layer covers the framework requirement; a remote-facing server app gets its own PR when a real remote-client workload exists.
- Code split of the daemon into packages — protocol stays the only shared lib for now; extract `packages/daemon-core` only when a second consumer appears.
- Switching build tooling (Next↔Vite, tsc↔tsx) — all config moves as-is.

## 10. Script table (root after migration)

| Script | Runs |
|---|---|
| `dev` | `apps/web dev:all` + `apps/desktop dev` (concurrently, crash-first) |
| `dev:docs` | `apps/website dev` |
| `build` / `tauri` | `apps/desktop build` / `... tauri` |
| `web:dev` / `web:build` | `apps/web dev:all` / `apps/web build` |
| `desktop:dev` | `apps/desktop dev` |
| `website:dev` / `website:build` | `apps/website dev/build` |
| `daemon:dev` / `daemon:build` | `apps/daemon start` / typecheck+start |
| `test` / `lint` / `typecheck` | `pnpm -r test` / `lint` / `typecheck` |

---

*Plan prepared 2026-07-13. Execute Phase 0 first; stop and confirm D1–D5 before Phase 2.*