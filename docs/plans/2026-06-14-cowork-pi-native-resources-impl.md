# Cowork pi-native Extensions & Skills — Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Make Cowork's Store/UI layer detect, install, and manage extensions
and skills through pi's own mechanisms (no parallel registry, no `~/.zosmaai`
resource silo), fixing the "installed extensions not detected" bug.

**Architecture:** The runtime loader (`disk-extension-loader.ts`) already uses
pi's `DefaultPackageManager.resolve()`. We make the Store layer
(`extension-manager.ts` + the `list_extensions`/`install_extension`/
`uninstall_extension`/`list_skills` handlers in `index.ts`) a thin adapter over
the *same* pi machinery: resolve for detection, `pi install`/`pi remove`/
`pi config` shell-outs for mutation, pi's native skill dirs for discovery. We
delete `cowork-extensions.json` and the bespoke `npm pack` installer.

**Tech Stack:** TypeScript (Node ESM), `@earendil-works/pi-coding-agent`
(`DefaultPackageManager`, `SettingsManager`), vitest, the `pi` CLI on PATH.

**Design doc:** `docs/plans/2026-06-14-cowork-pi-native-extensions-skills-design.md`

**Worktree:** `.worktrees/pi-native-resources` (branch `feat/pi-native-resources`).

---

## Execution status (2026-06-14)

**DONE & verified** (commit `5b3fd6aab` sidecar, `1c02ea968` UI):
- ✅ Phase 1 — `extension-manager.ts` rewritten as a pi-native adapter over
  `DefaultPackageManager.resolve()` (user + project scope, real metadata,
  `installed:true`, `scope`). Deletes the stale `cowork-extensions.json`
  install registry. **Empirically confirmed** real `resolve()` now returns
  `pi-messenger-bridge installed=true v0.4.0` with a clean `npm:` id → fixes
  both "extensions not detected" AND the missing Discord setup screen
  (`getExtensionSetup` now matches).
- ✅ Phase 2 — install/uninstall via `pm.installAndPersist` / `removeAndPersist`
  (no `npm pack`); handlers async + workspace-cwd scoped.
- ✅ Install scope surfaced in the Extensions detail UI (Global ~/.pi vs project .pi).
- ✅ Enable/disable kept as a thin Cowork preference overlay (pi has no simple
  per-resource toggle); install truth always from pi.
- ✅ Verification: 3 new tests + full sidecar suite (155) green; `tsc` clean
  (sidecar + frontend); biome clean on changed frontend files.

**REMAINING** (follow-ups):
- Phase 3 Task 7 — `list_skills` already returns pi-native scope from
  `~/.pi/agent/skills` + `~/.agents/skills` + project `.agents/skills`, but does
  NOT yet walk project `.pi/skills` or ancestor dirs to the repo root.
- `.zosmaai` resource-path sweep (Task 8) + dead-code/`pi config` enable-disable
  hardening (Tasks 6/9).
- Project-scope install toggle in the UI (currently installs global by default).
- Optional: a Discord "app" tile in `settings/Apps.tsx` reading install status
  from `list_extensions` (pi source of truth).

The tasks below remain the reference for the unfinished items.

**Before starting:** the worktree has no `node_modules`. Run the repo's install
(`pnpm install` / `npm install` per root lockfile) so `agent-sidecar` can build
and `vitest` can run.

---

## Key facts (verified)

- `~/.pi/agent/settings.json` `packages` array is pi's source of truth. On this
  machine `pi list` shows all 12 packages (npm + local paths like
  `../../pi-extensions/pi-chat`); `~/.pi/agent/cowork-extensions.json` is empty.
- `disk-extension-loader.ts` exports `readPiPackages(agentDir)` and
  `resolveEnabledExtensionPaths({cwd, agentDir, settingsManager})` which calls
  `new DefaultPackageManager({cwd, agentDir, settingsManager}).resolve(async () => "skip")`
  and reads `resolved.extensions[].{path, enabled}`. We reuse this exact pattern.
- pi enable/disable = `pi config` (packages.md). Install scope: `pi install`
  (global) vs `pi install -l` (project). Remove: `pi remove` (+ `-l`).
- pi skill locations (skills.md): global `~/.pi/agent/skills/` + `~/.agents/skills/`;
  project `.pi/skills/` + `.agents/skills/` (cwd + ancestors to repo root).
  `~/.agents/skills/` is the shared cross-harness dir pi reads natively.
- `list_skills` (index.ts ~2937) already scans those dirs but flat (no project
  ancestors, no scope precedence). `list_extensions` (index.ts ~2816) calls the
  divergent `discoverExtensions(zosmaDir)`.
- Tests: `extension-manager.test.ts` mocks `node:os.homedir()` to a temp HOME.
  Run with `cd agent-sidecar && npx vitest run src/extension-manager.test.ts`.
  Full check: `npm run check` (biome + tsc) at repo root.

---

# Phase 1 — Extensions detection (fixes the bug)

### Task 1: pi-native package metadata resolver

**TDD scenario:** New feature — full TDD cycle.

**Files:**
- Modify: `agent-sidecar/src/disk-extension-loader.ts` (add export)
- Test: `agent-sidecar/src/disk-extension-loader.test.ts` (create)

**Step 1: Write the failing test**

```ts
// disk-extension-loader.test.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInstalledPackages } from "./disk-extension-loader.js";

let HOME = "";
const piAgent = () => join(HOME, ".pi", "agent");

beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "dl-home-"));
  mkdirSync(piAgent(), { recursive: true });
});
afterEach(() => { if (HOME && existsSync(HOME)) rmSync(HOME, { recursive: true, force: true }); });

it("reports an npm package installed under ~/.pi/agent/npm with real metadata", async () => {
  writeFileSync(join(piAgent(), "settings.json"), JSON.stringify({ packages: ["npm:demo-ext"] }));
  const mod = join(piAgent(), "npm", "node_modules", "demo-ext");
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, "package.json"), JSON.stringify({
    name: "demo-ext", version: "1.2.3", description: "Demo",
    pi: { extensions: ["./index.js"] },
  }));
  writeFileSync(join(mod, "index.js"), "export default () => {};");

  const list = await resolveInstalledPackages({ cwd: HOME, agentDir: piAgent() });
  const ext = list.find((e) => e.id === "npm:demo-ext" || e.name === "demo-ext");
  expect(ext).toBeDefined();
  expect(ext?.version).toBe("1.2.3");
  expect(ext?.description).toBe("Demo");
});
```

**Step 2: Run test to verify it fails**

Run: `cd agent-sidecar && npx vitest run src/disk-extension-loader.test.ts -t "real metadata"`
Expected: FAIL — `resolveInstalledPackages` is not exported.

**Step 3: Write minimal implementation**

Add to `disk-extension-loader.ts`. Reuse the existing `DefaultPackageManager`
pattern from `resolveEnabledExtensionPaths`; build an internal `SettingsManager`
from `readPiPackages(agentDir)` (+ project settings, handled in Task 2 via cwd).
Map each `resolved.extensions[]` entry to a `ZemExtension`-compatible record by
reading the nearest `package.json` (walk up from `res.path`).

```ts
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import type { ZemExtension } from "./extension-manager.js"; // move the type here if it creates a cycle

export interface ResolvedPkgMeta {
  id: string;            // the package source string ("npm:foo", "../local")
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  installPath: string;   // resolved entry dir
  source: { type: "npm" | "git" | "local"; value: string };
}

function nearestPackageJson(entryPath: string): Record<string, unknown> | null {
  let dir = existsSync(entryPath) && entryPath.endsWith(".json") ? dirname(entryPath) : entryPath;
  for (let i = 0; i < 6; i++) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) { try { return JSON.parse(readFileSync(pj, "utf-8")); } catch { return null; } }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function sourceOf(spec: string): ResolvedPkgMeta["source"] {
  if (spec.startsWith("npm:")) return { type: "npm", value: spec.slice(4) };
  if (spec.startsWith("git:") || spec.startsWith("http") || spec.startsWith("ssh") || spec.startsWith("git@"))
    return { type: "git", value: spec };
  return { type: "local", value: spec };
}

export async function resolveInstalledPackages(opts: {
  cwd: string;
  agentDir: string;
}): Promise<ResolvedPkgMeta[]> {
  const sm = SettingsManager.inMemory({});
  const pkgs = readPiPackages(opts.agentDir);
  if (pkgs.length) sm.setPackages(pkgs);
  const pm = new DefaultPackageManager({ cwd: opts.cwd, agentDir: opts.agentDir, settingsManager: sm });
  const resolved = await pm.resolve(async () => "skip");
  const out: ResolvedPkgMeta[] = [];
  const seen = new Set<string>();
  for (const res of resolved.extensions) {
    const dir = res.path.endsWith(".ts") || res.path.endsWith(".js") ? dirname(res.path) : res.path;
    if (seen.has(dir)) continue;
    seen.add(dir);
    const meta = nearestPackageJson(res.path);
    const spec = (res as { source?: string }).source ?? dir;
    out.push({
      id: spec,
      name: (meta?.name as string) ?? spec,
      version: (meta?.version as string) ?? "0.0.0",
      description: (meta?.description as string) ?? "",
      enabled: res.enabled,
      installPath: dir,
      source: sourceOf(spec),
    });
  }
  return out;
}
```

> **Implementer note:** verify the real field names on `resolved.extensions[]`
> (`.path`, `.enabled`, and whether a `.source`/spec field exists) against the
> installed `@earendil-works/pi-coding-agent` typings — `resolveEnabledExtensionPaths`
> already relies on `.path` and `.enabled`. Adjust `spec` extraction if needed.

**Step 4: Run test to verify it passes**

Run: `cd agent-sidecar && npx vitest run src/disk-extension-loader.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add agent-sidecar/src/disk-extension-loader.ts agent-sidecar/src/disk-extension-loader.test.ts
git commit -m "feat(sidecar): pi-native resolveInstalledPackages for extension detection"
```

---

### Task 2: Rewrite `discoverExtensions` to use the resolver (user + project scope)

**TDD scenario:** Modifying tested code — run existing tests first.

**Files:**
- Modify: `agent-sidecar/src/extension-manager.ts` (`discoverExtensions`)
- Modify: `agent-sidecar/src/extension-manager.test.ts`

**Step 1: Run existing tests first**

Run: `cd agent-sidecar && npx vitest run src/extension-manager.test.ts`
Expected: PASS (baseline before change).

**Step 2: Write the new failing test**

Replace the `discoverExtensions dedupe` test with a pi-native one (no cowork
registry). `discoverExtensions` gains an optional `cwd` for project scope.

```ts
it("lists pi packages with real metadata, deduped, no cowork registry", async () => {
  writeFileSync(join(piAgent(), "settings.json"), JSON.stringify({ packages: ["npm:demo-ext"] }));
  const mod = join(piAgent(), "npm", "node_modules", "demo-ext");
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, "package.json"), JSON.stringify({ name: "demo-ext", version: "9.9.9" }));
  writeFileSync(join(mod, "index.js"), "export default () => {};");

  const found = (await discoverExtensions(HOME)).filter((e) => e.name === "demo-ext");
  expect(found).toHaveLength(1);
  expect(found[0].version).toBe("9.9.9");
});
```

> `discoverExtensions` becomes `async`. Update its signature to
> `discoverExtensions(zosmaDir: string, cwd?: string): Promise<ZemExtension[]>`.

**Step 3: Run test to verify it fails**

Run: `cd agent-sidecar && npx vitest run src/extension-manager.test.ts -t "real metadata, deduped"`
Expected: FAIL (sync function / wrong shape).

**Step 4: Implement**

Rewrite `discoverExtensions` to delegate to `resolveInstalledPackages({ cwd: cwd ?? homedir(), agentDir: piAgentDir() })`,
mapping `ResolvedPkgMeta` → `ZemExtension` (runtime `"pi"`, `installed: true`,
`enabled: meta.enabled`). Read `configSchema`/capabilities from the package.json
via the existing `readExtensionMeta(installPath)`. Delete the three-source
logic (registry, loose-dir scan, naive packages list) and the `seenNorm`
plumbing — `resolveInstalledPackages` already dedupes and includes loose files.

**Step 5: Run tests**

Run: `cd agent-sidecar && npx vitest run src/extension-manager.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add agent-sidecar/src/extension-manager.ts agent-sidecar/src/extension-manager.test.ts
git commit -m "refactor(sidecar): discoverExtensions delegates to pi resolver (user+project scope)"
```

---

### Task 3: Pass workspace cwd into `list_extensions`

**TDD scenario:** Trivial change — use judgment.

**Files:**
- Modify: `agent-sidecar/src/index.ts` (`case "list_extensions"`, ~2816)

**Step 1: Implement**

```ts
case "list_extensions": {
  const extensions = await discoverExtensions(zosmaDir, workspaceCwd);
  send({ type: "result", id: cmd.id, data: { extensions } });
  break;
}
```

`workspaceCwd` is already in scope in this handler block (used by `list_skills`,
`new_session`, etc.).

**Step 2: Typecheck**

Run: `cd agent-sidecar && npx tsc --noEmit` (or repo `npm run check`).
Expected: no errors.

**Step 3: Commit**

```bash
git add agent-sidecar/src/index.ts
git commit -m "feat(sidecar): list_extensions resolves project-scoped via workspace cwd"
```

---

### ✅ Checkpoint 1

Run `npm run check` and the sidecar tests. Manually confirm the Cowork
Extensions page now lists all `pi list` packages with real names/versions,
including local-path entries (`pi-chat`, `pi-htn`). Detection bug fixed.

---

# Phase 2 — Extensions install/uninstall/enable via pi CLI

### Task 4: Install via `pi install` (global) / `pi install -l` (project)

**TDD scenario:** Modifying tested code — run existing tests first.

**Files:**
- Modify: `agent-sidecar/src/extension-manager.ts` (`installExtension` + helpers)
- Modify: `agent-sidecar/src/extension-manager.test.ts`

**Step 1: Write the failing test** (mock `child_process.execSync`)

```ts
import * as cp from "node:child_process";
vi.spyOn(cp, "execSync").mockImplementation(() => Buffer.from(""));

it("shells out to `pi install` for a global npm source", async () => {
  await installExtension(HOME, "npm:demo-ext"); // now async
  const calls = (cp.execSync as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const cmd = String(calls.at(-1)?.[0]);
  expect(cmd).toMatch(/\bpi install\b/);
  expect(cmd).toContain("npm:demo-ext");
  expect(cmd).not.toContain("npm pack");
});

it("uses `pi install -l` when a project cwd is given", async () => {
  await installExtension(HOME, "npm:demo-ext", undefined, "/tmp/proj");
  const cmd = String((cp.execSync as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]);
  expect(cmd).toMatch(/pi install -l/);
});
```

**Step 2: Run to verify it fails**

Run: `cd agent-sidecar && npx vitest run src/extension-manager.test.ts -t "pi install"`
Expected: FAIL.

**Step 3: Implement**

Replace `installExtension` body. New signature:
`installExtension(zosmaDir, source, ref?, cwd?): Promise<ZemExtension>`.

```ts
export async function installExtension(
  _zosmaDir: string, source: string, ref?: string, cwd?: string,
): Promise<ZemExtension> {
  const spec = ref && source.startsWith("npm:") ? `${source}@${ref}` : source;
  const scope = cwd ? " -l" : "";
  execSync(`pi install${scope} ${shellQuote(spec)}`, {
    cwd: cwd ?? homedir(), stdio: "pipe", timeout: 300_000,
  });
  const list = await resolveInstalledPackages({ cwd: cwd ?? homedir(), agentDir: piAgentDir() });
  const match = list.find((e) => e.id === source || e.source.value === source.replace(/^npm:/, ""));
  if (!match) throw new Error(`pi install reported success but ${source} did not resolve`);
  return toZemExtension(match); // shared mapper extracted in Task 2
}
```

Add a small `shellQuote(s)` helper (wrap in single quotes, escape embedded
quotes). Delete `installFromNpm`/`installFromGit`/`installFromLocal`,
`piManagesPackage`, `addPiPackage`, the `npm pack`/tar/`mv` code, and
`copyRecursiveSync`. The old pi-first guard tests
(`installFromNpm pi-first guard`) are obsolete — replace them with the two
`pi install` tests above (pi now owns placement, so the duplicate-drop-in class
of bug cannot occur).

**Step 4: Run tests**

Run: `cd agent-sidecar && npx vitest run src/extension-manager.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add agent-sidecar/src/extension-manager.ts agent-sidecar/src/extension-manager.test.ts
git commit -m "refactor(sidecar): install extensions via `pi install` (project-scoped with -l)"
```

---

### Task 5: Uninstall via `pi remove`; update `install`/`uninstall` handlers

**TDD scenario:** Modifying tested code.

**Files:**
- Modify: `agent-sidecar/src/extension-manager.ts` (`uninstallExtension`)
- Modify: `agent-sidecar/src/index.ts` (`install_extension`, `uninstall_extension` handlers, ~2823/2830)

**Step 1: Test**

```ts
it("shells out to `pi remove`", () => {
  uninstallExtension(HOME, "npm:demo-ext");
  const cmd = String((cp.execSync as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]);
  expect(cmd).toMatch(/\bpi remove\b/);
  expect(cmd).toContain("npm:demo-ext");
});
```

**Step 2: Implement** `uninstallExtension(zosmaDir, extensionId, cwd?)`:

```ts
export function uninstallExtension(_zosmaDir: string, extensionId: string, cwd?: string): void {
  const scope = cwd ? " -l" : "";
  execSync(`pi remove${scope} ${shellQuote(extensionId)}`, { cwd: cwd ?? homedir(), stdio: "pipe", timeout: 120_000 });
}
```

Update handlers to be async / pass `workspaceCwd`:

```ts
case "install_extension": {
  const ext = await installExtension(zosmaDir, cmd.source, cmd.ref, workspaceCwd);
  send({ type: "result", id: cmd.id, data: { extension: ext } });
  break;
}
case "uninstall_extension": {
  uninstallExtension(zosmaDir, cmd.extensionId, workspaceCwd);
  send({ type: "result", id: cmd.id, data: { success: true } });
  break;
}
```

> Decide scope policy: pass `workspaceCwd` only when the active workspace has a
> `.pi/` (project install) else omit for global. Simplest first cut: always
> global (omit cwd) unless the UI explicitly requests project scope. Document
> the choice in the handler.

**Step 3: Run tests + typecheck.** Expected: PASS / clean.

**Step 4: Commit**

```bash
git add agent-sidecar/src/extension-manager.ts agent-sidecar/src/index.ts
git commit -m "refactor(sidecar): uninstall via `pi remove`; wire handlers to pi CLI"
```

---

### Task 6: Enable/disable via `pi config`; delete the cowork registry

**TDD scenario:** Modifying tested code.

**Files:**
- Modify: `agent-sidecar/src/extension-manager.ts` (`setExtensionEnabled`,
  remove `loadRegistry`/`saveRegistry`/`registryFile`/`setExtensionConfig`)
- Modify: `agent-sidecar/src/index.ts` (`set_extension_enabled`,
  `set_extension_config` handlers)

**Step 1: Test**

```ts
it("enables/disables via `pi config`", () => {
  setExtensionEnabled(HOME, "npm:demo-ext", false);
  const cmd = String((cp.execSync as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0]);
  expect(cmd).toMatch(/\bpi config\b/);
});
```

**Step 2: Implement** `setExtensionEnabled` as a `pi config` shell-out (confirm
the exact subcommand/flags via `pi config --help`; packages.md says `pi config`
toggles resources for global and project scope). Delete `cowork-extensions.json`
read/write entirely (`registryFile`, `loadRegistry`, `saveRegistry`,
`ExtensionRegistry*` types). Keep the whitelisted file-config commands
(`get/save_extension_config_file`, PR #189) — those are unrelated to the
registry. Drop the registry-backed `setExtensionConfig`; if the UI still calls
`set_extension_config`, make it a no-op that returns success or route it to the
whitelisted-file path.

**Step 3: Run full check.**

Run: `cd /home/arjun/code/zosmaai/zosma-cowork/.worktrees/pi-native-resources && npm run check`
Expected: clean (no references to deleted symbols remain).

**Step 4: Commit**

```bash
git add agent-sidecar/src/extension-manager.ts agent-sidecar/src/index.ts
git commit -m "refactor(sidecar): enable/disable via `pi config`; remove cowork-extensions.json registry"
```

---

### ✅ Checkpoint 2

`npm run check` green. Manually: install, uninstall, enable/disable an
extension from the Cowork UI; confirm `~/.pi/agent/settings.json` `packages`
changes and `~/.pi/agent/cowork-extensions.json` is no longer created.

---

# Phase 3 — Skills pi-native + `.zosmaai` cleanup

### Task 7: `list_skills` — project ancestors + scope precedence via pi dirs

**TDD scenario:** Modifying tested code — extract logic to test it.

**Files:**
- Create: `agent-sidecar/src/skills-discovery.ts` (extract pure function)
- Create: `agent-sidecar/src/skills-discovery.test.ts`
- Modify: `agent-sidecar/src/index.ts` (`case "list_skills"`, ~2937)

**Step 1: Test** — a pure `discoverSkills({ home, cwd })` returning
`{ name, path, scope }[]`, scanning, in precedence order:
`~/.pi/agent/skills`, `~/.agents/skills` (global), then `.pi/skills` and
`.agents/skills` in `cwd` **and each ancestor up to the git/repo root**
(project). First occurrence of a name wins; later duplicates are dropped.

```ts
it("project skill in an ancestor .agents/skills is discovered as project scope", () => {
  // home global skill "a"; project ancestor skill "b"
  mkdirSync(join(home, ".agents", "skills", "a"), { recursive: true });
  writeFileSync(join(home, ".agents", "skills", "a", "SKILL.md"), "---\nname: a\n---");
  const proj = join(home, "repo", "pkg");
  mkdirSync(join(home, "repo", ".agents", "skills", "b"), { recursive: true });
  writeFileSync(join(home, "repo", ".agents", "skills", "b", "SKILL.md"), "---\nname: b\n---");
  mkdirSync(join(home, "repo", ".git"), { recursive: true }); // repo root boundary

  const skills = discoverSkills({ home, cwd: proj });
  expect(skills.find((s) => s.name === "a")?.scope).toBe("global");
  expect(skills.find((s) => s.name === "b")?.scope).toBe("project");
});
```

**Step 2: Run to verify it fails.** Expected: FAIL (module missing).

**Step 3: Implement** `discoverSkills` in `skills-discovery.ts`. Walk ancestors
from `cwd` upward, stopping after the directory that contains `.git` (or
filesystem root). Apply the skills.md rule: in `*/skills/` directories,
sub-directories with `SKILL.md` are skills; root `.md` files are ignored under
`.agents/skills` but counted under `~/.pi/agent/skills` / `.pi/skills`. Keep it
minimal but correct for the test.

**Step 4: Rewire the handler** to call `discoverSkills({ home: homedir(), cwd: workspaceCwd })`
and emit the same payload shape the frontend expects (`{ name, path, scope, agents }`).

**Step 5: Run tests + check.** Expected: PASS / clean.

**Step 6: Commit**

```bash
git add agent-sidecar/src/skills-discovery.ts agent-sidecar/src/skills-discovery.test.ts agent-sidecar/src/index.ts
git commit -m "feat(sidecar): pi-native skill discovery (project ancestors + scope precedence)"
```

---

### Task 8: Skill install lands in pi's shared dir; no `.zosmaai` resource paths

**TDD scenario:** Modifying tested code / cleanup.

**Files:**
- Modify: skill-install code path (search for where `search_skills` results get
  installed — `grep -rn "skills" agent-sidecar/src/index.ts` and the frontend
  install command; if install currently writes under `~/.zosmaai`, retarget).
- Modify: `agent-sidecar/src/office-docs/officecli-resolver.ts` is *allowed* to
  keep `~/.zosmaai` (non-pi binary) — leave it.

**Step 1:** Identify every write to `~/.zosmaai` for extensions/skills:

```bash
grep -rn "zosmaai" agent-sidecar/src | grep -viE "officecli|sessions|settings\.json|cowork/bin"
```

Expected after the refactor: **no** extension/skill resource writes to
`~/.zosmaai`. If any remain, retarget skill installs to `~/.agents/skills/`
(global) or `<cwd>/.agents/skills/` (project).

**Step 2:** Add a guard test asserting the resolved skill-install destination is
under `~/.agents/skills` or the project `.agents/skills`, never `~/.zosmaai`.

**Step 3: Run check + tests.** Expected: clean / PASS.

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(sidecar): skills install into pi's ~/.agents/skills; drop .zosmaai resource paths"
```

---

### Task 9: Remove dead code + final sweep

**TDD scenario:** Trivial — guided by the compiler.

**Files:**
- Modify: `agent-sidecar/src/extension-manager.ts` (delete now-unused
  `normalizePkgId`, `detectRuntime` if unused, `readExtensionMeta` if subsumed,
  `parseSource`, `buildExtensionEntry`, etc. — whatever `tsc`/biome flags)
- Modify: `agent-sidecar/src/extension-manager.test.ts` (remove obsolete tests)

**Step 1:** Run `npm run check`; delete every symbol it reports as unused.
**Step 2:** `grep -rn "cowork-extensions.json"` → expect **no** matches.
**Step 3:** Run the full sidecar test suite: `cd agent-sidecar && npx vitest run`.
Expected: all green.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(sidecar): remove dead extension-manager registry/install code"
```

---

### ✅ Checkpoint 3 (final)

- `npm run check` green; `agent-sidecar` vitest green.
- Manual: Extensions page lists all `pi list` packages w/ metadata; install/
  uninstall/enable mutate `~/.pi/agent/settings.json`; Skills page shows global +
  project skills with correct scope; no new `~/.zosmaai` resource files; the
  whitelisted Discord config screen (PR #189) still works.
- Update the design doc's "Migration / cleanup" section to "done" and note
  issue #147 can close.

---

## Risks / notes

- **`pi` on PATH in the shipped app:** the sidecar shells out to `pi`. Confirm
  the packaged Tauri app resolves the `pi` binary (it already depends on pi at
  runtime); if not, resolve its absolute path the same way the loader locates
  pi's agent dir. **Verify before shipping Phase 2.**
- **`resolve()` field names:** confirm `resolved.extensions[]` shape against the
  installed typings (Task 1 note). `resolveEnabledExtensionPaths` is the proof it
  exposes `.path` + `.enabled`.
- **`pi config` flags:** confirm exact enable/disable subcommand via
  `pi config --help` before Task 6.
- **Async ripple:** `discoverExtensions`/`installExtension` become async — update
  every caller (handlers in `index.ts`, `remote-server.ts` if it calls them).
```
