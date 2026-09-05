# Zosma Router Auth (web/ stack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the Zosma Router sign-in journey (PKCE device flow → router key → models written into pi's registry) on the new `web/` Next.js stack, usable from the Tauri desktop shell and from a plain browser.

**Architecture:** The old journey lived in the deleted Node sidecar (`agent-sidecar/src/zosma-auth/`) plus the deleted Vite frontend. This plan re-ports the sidecar core into `web/lib/zosma-auth/` as pure Node modules, exposes it through `web/app/api/auth/zosma/*` route handlers, and adds a UI card inside the existing `ModelsConfig` panel. Three callback paths converge on one server-side `completeZosmaAuth(code, state)`: (1) loopback HTTP redirect to `/api/auth/zosma/callback` (works in browser + desktop, if the auth server honors `redirect_uri` — verified in Task 0), (2) Tauri deep link `ai.zosma.cowork://oauth/callback` (desktop, same scheme the old app registered), (3) manual code paste (universal fallback). The `zosma-router` provider is written to `~/.pi/agent/models.json` through the existing `models-config-store.ts` (atomic write + cache invalidation already built in), with snapshot/rollback and post-reload registry verification — the same atomicity guarantees the old sidecar had.

**Tech Stack:** Next.js 16 route handlers (Node runtime), Node `crypto`/`fs` (no new npm deps for the core), `@earendil-works/pi-coding-agent` `ModelRuntime` for registry verification, `node:test` + `jiti` (`.test.mjs` co-located convention), React function components, Tauri v2 (`tauri-plugin-deep-link`, custom `open_url` command) for desktop wiring.

**Roadmap:** None (follow-up to `docs/web-ui-shell-migration.md` cutover, PR #355).

**Phase:** Single-plan implementation.

---

## Background: the old flow (reference, deleted code)

The old sidecar flow, recoverable via `git show main:agent-sidecar/src/zosma-auth/index.ts`:

1. `startZosmaAuth(piDir)` — generate PKCE `state` + `code_verifier` + S256 challenge, load/generate device id (`~/.pi/agent/zosma-device-id.txt`), persist pending tx (`~/.pi/agent/zosma-auth-pending.json`, 10 min TTL, 0600, atomic rename), `POST {authBaseUrl}/v1/cowork/authorizations` with `{ client_id: "zosma-cowork", state, code_challenge, code_challenge_method: "S256", device_id }` → returns `{ authorization_url }`.
2. User signs in at the authorization URL (Google). Auth server redirects back with `?code=...&state=...` — old app via Tauri deep link `ai.zosma.cowork://oauth/callback`.
3. `completeZosmaAuth(code, state, piDir, deps)` — verify pending tx + state match, `POST {authBaseUrl}/v1/cowork/token` with `{ client_id, code, code_verifier, device_id }` → `{ access_token }` (the router key), `GET {authBaseUrl}/v1/models` with `Authorization: Bearer <key>` → `{ data: [rows] }` catalog, map rows to pi model shape, snapshot existing provider, atomic save provider, reload pi registry, verify all expected models visible, rollback+re-init on failure, delete pending tx.
4. `disconnectZosmaAuth` — best-effort `POST {authBaseUrl}/v1/cowork/revoke` (Bearer), delete local provider entry, reload.

Frozen server contract: `client_id` is `zosma-cowork`; all four endpoints live under the **auth** base URL (default `https://router.zosma.ai`); inference stays on the **router** base URL (`https://router.zosma.ai/v1`), which is what gets written into `models.json` as the provider `baseUrl`.

**Deliberate changes from the old implementation:**

| Item | Old | New | Why |
|---|---|---|---|
| Provider id | `zosmaai-router` | `zosma-router` | This machine's live `~/.pi/agent/models.json` already contains a working `zosma-router` provider; writing the same id means re-login upgrades it in place instead of creating a duplicate. |
| Config defaults | fail-closed (baked URL or env only) | built-in defaults `https://router.zosma.ai` / `https://router.zosma.ai/v1`, overridable by env `ZOSMA_AUTH_BASE_URL`/`ZOSMA_ROUTER_BASE_URL` or persisted `~/.pi/agent/zosma-router-config.json` | The journey should just work out of the box; self-hosted routers still get overrides (old `RouterSetupScreen` feature). |
| models.json writes | own `custom-providers.ts` (578 lines) | reuse existing `web/lib/models-config-store.ts` (`readModelsConfig`/`writeModelsConfig` — atomic private write + `invalidateModelsCache()` already baked in) | DRY; the web app already owns that file. |
| Registry reload | sidecar `initAgent` + sync `modelRegistry.getAvailable()` | `invalidateModelsCache()` + fresh `ModelRuntime.create()` + `getProvider("zosma-router")` | Web-server equivalent; `ModelRuntime` is the web app's live registry. |
| Callback delivery | Tauri deep link only | loopback redirect + deep link + manual paste | Browser-only mode must work; all paths funnel into one server function. |

**Working branch:** create `feat/zosma-router-auth-web` from the current HEAD of `feat/web-ui-shell` (PR #355, unmerged — this feature depends on the new `web/` stack).

**Conventions used throughout:**

- All new code lives in `web/` unless a task says otherwise.
- Tests: `web/**/*.test.mjs`, run from the `web/` directory: `node --experimental-strip-types --test <file>`. Full suite: `pnpm test` (globs `app|components|hooks|lib|public`).
- Test bootstrap (copy this header into every new `.test.mjs` that imports TS):

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
```

- **Test-wrapper pitfall (learned in TDD):** a helper like `withXDir(run)` must be a PLAIN function that RETURNS the test function (`return async () => { ... }`). If it is `async function withXDir(run) { await ... }`, the call produces a Promise, node:test just resolves it, and the test body silently never runs (hollow green).
- Tests that hit the real agent dir point `process.env.PI_CODING_AGENT_DIR` at a fresh temp dir **before** invoking the code under test (`getAgentDir()` from `@earendil-works/pi-coding-agent` reads `PI_CODING_AGENT_DIR` at call time — verified in its `dist/config.js`: `ENV_AGENT_DIR = PI_CODING_AGENT_DIR`).
- Conventional commit per task: `feat(zosma-auth): ...` / `test(zosma-auth): ...` / `chore(tauri): ...`.
- TDD iron law: failing test first, watch it fail, minimal implementation, watch it pass, commit.

---

## File Structure

**Create (web/):**

| File | Responsibility |
|---|---|
| `web/lib/zosma-auth/crypto.ts` | PKCE helpers: `generateState`, `generateCodeVerifier`, `sha256Base64url`. Pure, no I/O. |
| `web/lib/zosma-auth/state.ts` | Pending auth transaction store: save/load/delete `zosma-auth-pending.json` (0600, atomic rename, 10 min TTL). |
| `web/lib/zosma-auth/router-config.ts` | Base-URL config: defaults, env/persisted-file precedence, strict validation (HTTPS or loopback HTTP, exact paths, same protocol). |
| `web/lib/zosma-auth/models-json.ts` | `zosma-router` provider entry ops on `models.json` via `models-config-store.ts`: `snapshotProvider`, `upsertProvider`, `restoreProvider`, `deleteProvider`, `readProviderEntry`. |
| `web/lib/zosma-auth/index.ts` | Orchestration: `startZosmaAuth`, `completeZosmaAuth`, `disconnectZosmaAuth`, `cancelZosmaAuth`, `refreshZosmaModels`, `getZosmaStatus`, `productionDeps`, `resolveDeps`. |
| `web/app/api/auth/zosma/start/route.ts` | `POST` → `{ authorizationUrl }` |
| `web/app/api/auth/zosma/complete/route.ts` | `POST { code, state }` → result (deep-link + manual-paste path) |
| `web/app/api/auth/zosma/callback/route.ts` | `GET ?code&state` → complete + redirect to UI (loopback path) |
| `web/app/api/auth/zosma/status/route.ts` | `GET` → `{ configured, pending, modelCount, baseUrl, authBaseUrl, routerBaseUrl }` |
| `web/app/api/auth/zosma/disconnect/route.ts` | `POST` → revoke + remove provider |
| `web/app/api/auth/zosma/cancel/route.ts` | `POST` → delete pending tx only |
| `web/app/api/auth/zosma/refresh/route.ts` | `POST` → re-fetch catalog with existing key |
| `web/app/api/auth/zosma/api-key/route.ts` | `POST` → degraded sign-in: save pasted router key + verify (Task 0 finding) |
| `web/app/api/auth/zosma/config/route.ts` | `PUT` → persist custom base URLs |
| `web/app/api/auth/zosma/test-helper.mjs` | Shared `withAgentDir` test wrapper (temp `PI_CODING_AGENT_DIR` + `t.after` cleanup). |
| `web/hooks/useZosmaAuth.ts` | Client state machine (`idle|starting|waiting_browser|completing|done|error`), browser open, Tauri deep-link listener, manual code parse. |
| `web/components/ZosmaAuthCard.tsx` | UI card rendered in the Models panel. |
| Tests | `web/lib/zosma-auth/{crypto,state,router-config,models-json,index}.test.mjs`, `web/app/api/auth/zosma/{start,complete,callback,status,disconnect,config}/route.test.mjs`, `web/hooks/useZosmaAuth.test.mjs`, `web/components/ZosmaAuthCard.test.mjs` |

**Modify:**

| File | Change |
|---|---|
| `web/components/ModelsConfig.tsx` | Render `<ZosmaAuthCard>` above the custom-providers section (~line 2163, anchor: `{/* Divider before custom providers` comment); accept `zosmaNotice` prop (Task 11B). |
| `web/lib/initial-navigation.ts` (+ `.test.mjs`) | Parse the `?zosma=success\|error` landing param (Task 11B); update the 4 whole-object `deepEqual` expectations for the new field. |
| `web/components/AppShell.tsx` | One-shot opener: landing with a notice opens the Models settings panel (Task 11B). |
| `web/components/SettingsShell.tsx`, `web/components/SettingsContent.tsx` | Forward `zosmaNotice` into the Models panel (Task 11B). |
| `web/package.json` | Add `@tauri-apps/plugin-deep-link` (no-op in plain browser; Tauri deep-link listener). |
| `src-tauri/tauri.conf.json` | Add `plugins.deep-link.desktop.schemes: ["ai.zosma.cowork"]`. |
| `src-tauri/capabilities/default.json` | Add `"deep-link:default"`. |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-deep-link`. |
| `src-tauri/src/lib.rs` | Register deep-link plugin; add `open_url` command (ported from `main:src-tauri/src/lib.rs:2116-2158` — battle-tested Windows URL quoting); register in `generate_handler`. |

**Not touched:** `scripts/check-shared-port.mjs`, CI files (new code runs under the existing `web` job), `provider-credential-store.ts` (router key lives in `models.json`, same as the live provider today — not in `auth.json`).

---

### Task 0: Probe the live auth server (callback design spike)

**Files:** none (discovery only — record findings in a comment block at the top of `web/lib/zosma-auth/index.ts` when it is created in Task 5).

This decides which callback path is the primary UX. All three paths are implemented regardless (they're cheap), but the UX copy in the card depends on the answer.

- [ ] **Step 1: Generate throwaway PKCE values and call the authorizations endpoint**

```bash
cd /tmp && cat > zosma-probe.mjs << 'EOF'
import { createHash, randomBytes } from "node:crypto";
const state = randomBytes(32).toString("hex");
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const res = await fetch("https://router.zosma.ai/v1/cowork/authorizations", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_id: "zosma-cowork",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    device_id: `probe-${Date.now()}`,
    redirect_uri: "http://127.0.0.1:30141/api/auth/zosma/callback",
  }),
  redirect: "error",
});
console.log("status:", res.status);
console.log("body:", JSON.stringify(await res.json(), null, 1));
EOF
node zosma-probe.mjs
```

- [ ] **Step 2: Record findings**

Answer these three questions from the response:
1. Is there an `authorization_url`? What host/path does it point to?
2. If you open the `authorization_url` in a browser and sign in, where does it redirect? (a) `ai.zosma.cowork://oauth/callback?...` deep link, (b) the `redirect_uri` we sent, (c) a code-display page, (d) something else.
3. Does the server reject or ignore the `redirect_uri` field (compare a second request without it)?

- [ ] **Step 3: Set the callback priority**

| Finding | Primary UX in ZosmaAuthCard |
|---|---|
| Server honors `redirect_uri` | "Sign in in your browser" — loopback callback, no manual step |
| Server deep-links only | Desktop: "Complete sign-in in your browser" (deep link). Browser: show the manual-paste field up front |
| Server shows a code page | Manual paste is the universal path; deep link is a bonus |

**Findings (probed 2026-08-26 against production):**

1. `POST https://router.zosma.ai/v1/cowork/authorizations` → **404** `{"detail": "Not Found"}`.
2. Production is a **LiteLLM proxy** (OpenAPI: 507 paths, standard LiteLLM route set). It has **no** `/v1/cowork/*`, device, or authorization routes. The PKCE endpoints exist on the **dev router** only — this machine's `~/.pi/agent/zosma-router-config.json` points at `http://localhost:3000` (dev server, not currently running).
3. `GET https://router.zosma.ai/v1/models` → **200** (catalog path is live in production; the existing `sk-…` key in `models.json` still resolves 27 models). The `/v1/cowork/*` endpoints are expected to land in production eventually — when they do, no code change is needed (base URLs are config-driven).

**Revised decision:** loopback callback remains the primary PKCE UX (it works against the dev router, and against production once the endpoints ship). Because production 404s today, the card **also** offers the degraded path that works now: **"Paste your router key"** — saves the key, fetches the catalog with it, verifies, rolls back on failure (Task 7 adds `authenticateWithKey`, Task 9 adds `POST /api/auth/zosma/api-key`, Task 11 adds the card field). A 404/5xx from the auth server in the PKCE `start` path surfaces the key-paste field instead of a dead end.

Cleanup: `rm /tmp/zosma-probe.mjs`. (The probe created a server-side transaction that simply expires; no local files are touched.)

**Commit:** none (no code).

---

### Task 1: PKCE crypto helpers

**Files:**
- Create: `web/lib/zosma-auth/crypto.ts`
- Test: `web/lib/zosma-auth/crypto.test.mjs`

- [ ] **Step 1: Write the failing tests**

`web/lib/zosma-auth/crypto.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { generateState, generateCodeVerifier, sha256Base64url } =
  await jiti.import("./crypto.ts");

test("generateState returns 64 hex chars", () => {
  const s = generateState();
  assert.equal(s.length, 64);
  assert.match(s, /^[0-9a-f]{64}$/);
});

test("generateState values are unique across 100 draws", () => {
  const values = new Set(Array.from({ length: 100 }, () => generateState()));
  assert.equal(values.size, 100);
});

test("generateCodeVerifier returns 43 base64url chars", () => {
  const v = generateCodeVerifier();
  assert.equal(v.length, 43);
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
});

test("generateCodeVerifier values are unique across 100 draws", () => {
  const values = new Set(Array.from({ length: 100 }, () => generateCodeVerifier()));
  assert.equal(values.size, 100);
});

test("sha256Base64url is deterministic and input-sensitive", () => {
  assert.equal(sha256Base64url("abc"), sha256Base64url("abc"));
  assert.notEqual(sha256Base64url("abc"), sha256Base64url("abd"));
});

test("sha256Base64url matches the RFC 7636 appendix test vector", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(sha256Base64url(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("sha256Base64url output never contains padding or base64 special chars", () => {
  for (const input of ["a", "ab", "abc", "abcd"]) {
    assert.doesNotMatch(sha256Base64url(input), /[=+/]/);
  }
});
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/crypto.test.mjs`
Expected: FAIL — cannot find module `./crypto.ts` (or `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Implement**

`web/lib/zosma-auth/crypto.ts`:

```ts
/**
 * Zosma Router Auth — PKCE (RFC 7636) helpers.
 * Re-port of agent-sidecar/src/zosma-auth/crypto.ts (sidecar deleted 2026-08-26).
 * Pure Node crypto, no dependencies.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Generate a high-entropy random state parameter (64 hex chars = 256 bits).
 */
export function generateState(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Generate a PKCE code verifier (32 random bytes, base64url-encoded, 43 chars).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Derive S256 code challenge from a code verifier.
 */
export function sha256Base64url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/crypto.test.mjs`
Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/lib/zosma-auth/crypto.ts web/lib/zosma-auth/crypto.test.mjs
git commit -m "feat(zosma-auth): port PKCE crypto helpers into web/lib"
```

---

### Task 2: Pending transaction store

**Files:**
- Create: `web/lib/zosma-auth/state.ts`
- Test: `web/lib/zosma-auth/state.test.mjs`

- [ ] **Step 1: Write the failing tests**

`web/lib/zosma-auth/state.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { savePending, loadPending, deletePending, pendingFilePath } =
  await jiti.import("./state.ts");

function withTempDir(run) {
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-auth-pending-"));
    try {
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

const tx = (over = {}) => ({
  state: "s-state",
  codeVerifier: "v-verifier",
  deviceId: "cowork-123",
  expiresAt: Date.now() + 600_000,
  ...over,
});

test("savePending then loadPending roundtrips", withTempDir(async (dir) => {
  const t = tx();
  savePending(t, dir);
  assert.deepEqual(loadPending(dir), t);
}));

test("loadPending returns null when no file exists", withTempDir(async (dir) => {
  assert.equal(loadPending(dir), null);
}));

test("loadPending returns null and deletes an expired transaction", withTempDir(async (dir) => {
  savePending(tx({ expiresAt: Date.now() - 1 }), dir);
  assert.equal(loadPending(dir), null);
  const missing = await readFile(pendingFilePath(dir), "utf-8").then(
    () => false,
    () => true,
  );
  assert.equal(missing, true);
}));

test("loadPending returns null on corrupt JSON (file left in place)", withTempDir(async (dir) => {
  await writeFile(pendingFilePath(dir), "{not json", { mode: 0o600 });
  assert.equal(loadPending(dir), null);
  assert.match(await readFile(pendingFilePath(dir), "utf-8"), /\{not json/);
}));

test("loadPending rejects missing fields", withTempDir(async (dir) => {
  for (const missing of ["state", "codeVerifier", "deviceId", "expiresAt"]) {
    const bad = tx();
    delete bad[missing];
    await rm(pendingFilePath(dir), { force: true });
    savePending(bad, dir);
    assert.equal(loadPending(dir), null, `should reject missing ${missing}`);
  }
}));

test("loadPending rejects wrong field types", withTempDir(async (dir) => {
  savePending(tx({ expiresAt: "soon" }), dir);
  assert.equal(loadPending(dir), null);
}));

test("savePending overwrites a previous transaction", withTempDir(async (dir) => {
  savePending(tx({ state: "old" }), dir);
  savePending(tx({ state: "new" }), dir);
  assert.equal(loadPending(dir).state, "new");
}));

test("deletePending removes the file and is a no-op when absent", withTempDir(async (dir) => {
  savePending(tx(), dir);
  deletePending(dir);
  assert.equal(loadPending(dir), null);
  deletePending(dir); // must not throw
}));

test("saved file has 0600 permissions", withTempDir(async (dir) => {
  savePending(tx(), dir);
  assert.equal((await stat(pendingFilePath(dir))).mode & 0o777, 0o600);
}));
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/state.test.mjs`
Expected: FAIL — cannot find module `./state.ts`.

- [ ] **Step 3: Implement**

`web/lib/zosma-auth/state.ts`:

```ts
/**
 * Zosma Router Auth — Pending Transaction Store.
 *
 * File-backed store for PKCE state + code_verifier. Survives server restart,
 * expires after 10 minutes, atomic write via rename, 0600 permissions.
 *
 * Path: `<piDir>/zosma-auth-pending.json` (piDir is the pi agent dir).
 */

import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PENDING_FILE = "zosma-auth-pending.json";

export interface PendingAuthTransaction {
  state: string;
  codeVerifier: string;
  deviceId: string;
  expiresAt: number; // epoch ms
}

/**
 * Resolve the path to the pending transaction file.
 */
export function pendingFilePath(piDir: string): string {
  return join(piDir, PENDING_FILE);
}

/**
 * Atomically write a pending transaction to disk.
 * Temp file + rename for crash safety. 0600 permissions.
 */
export function savePending(tx: PendingAuthTransaction, piDir: string): void {
  const dest = pendingFilePath(piDir);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(tx, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, dest);
}

/**
 * Load and validate the pending transaction.
 * Returns null if missing or expired (deletes expired file).
 * Returns null on corrupt JSON or invalid fields (leaves file for debugging).
 */
export function loadPending(piDir: string): PendingAuthTransaction | null {
  const path = pendingFilePath(piDir);
  if (!existsSync(path)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null; // corrupt JSON — leave file, caller sees no pending tx
  }

  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (
    typeof obj.state !== "string" ||
    typeof obj.codeVerifier !== "string" ||
    typeof obj.deviceId !== "string" ||
    typeof obj.expiresAt !== "number"
  ) {
    return null;
  }

  if (Date.now() > obj.expiresAt) {
    removePendingFile(path);
    return null;
  }

  return {
    state: obj.state,
    codeVerifier: obj.codeVerifier,
    deviceId: obj.deviceId,
    expiresAt: obj.expiresAt,
  };
}

/**
 * Remove the pending transaction file. No-op if missing.
 */
export function deletePending(piDir: string): void {
  removePendingFile(pendingFilePath(piDir));
}

function removePendingFile(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best-effort cleanup — never fail the flow over cleanup.
  }
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/state.test.mjs`
Expected: 9 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/lib/zosma-auth/state.ts web/lib/zosma-auth/state.test.mjs
git commit -m "feat(zosma-auth): port pending transaction store into web/lib"
```

---

### Task 3: Router base-URL configuration

**Files:**
- Create: `web/lib/zosma-auth/router-config.ts`
- Test: `web/lib/zosma-auth/router-config.test.mjs`

- [ ] **Step 1: Write the failing tests**

`web/lib/zosma-auth/router-config.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  DEFAULT_AUTH_BASE_URL,
  DEFAULT_ROUTER_BASE_URL,
  validateRouterConfig,
  resolveRouterConfig,
  saveRouterConfig,
  loadPersistedRouterConfig,
} = await jiti.import("./router-config.ts");

test("defaults point at router.zosma.ai", () => {
  assert.equal(DEFAULT_AUTH_BASE_URL, "https://router.zosma.ai");
  assert.equal(DEFAULT_ROUTER_BASE_URL, "https://router.zosma.ai/v1");
});

test("validateRouterConfig accepts the default https pair", () => {
  const cfg = validateRouterConfig({
    authBaseUrl: "https://router.zosma.ai",
    routerBaseUrl: "https://router.zosma.ai/v1",
  });
  assert.deepEqual(cfg, {
    authBaseUrl: "https://router.zosma.ai",
    routerBaseUrl: "https://router.zosma.ai/v1",
  });
});

test("validateRouterConfig trims trailing slashes", () => {
  const cfg = validateRouterConfig({
    authBaseUrl: "https://router.zosma.ai///",
    routerBaseUrl: "https://router.zosma.ai/v1/",
  });
  assert.deepEqual(cfg, {
    authBaseUrl: "https://router.zosma.ai",
    routerBaseUrl: "https://router.zosma.ai/v1",
  });
});

test("validateRouterConfig allows http only for loopback", () => {
  assert.deepEqual(
    validateRouterConfig({ authBaseUrl: "http://127.0.0.1:8080", routerBaseUrl: "http://127.0.0.1:8080/v1" }),
    { authBaseUrl: "http://127.0.0.1:8080", routerBaseUrl: "http://127.0.0.1:8080/v1" },
  );
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "http://router.example.com", routerBaseUrl: "http://router.example.com/v1" }),
    /must use HTTPS/,
  );
});

test("validateRouterConfig enforces exact base paths", () => {
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "https://router.zosma.ai/v1", routerBaseUrl: "https://router.zosma.ai/v1" }),
    /authBaseUrl must be a base URL with path \//,
  );
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "https://router.zosma.ai", routerBaseUrl: "https://router.zosma.ai" }),
    /routerBaseUrl must be a base URL with path \/v1/,
  );
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "https://router.zosma.ai?x=1", routerBaseUrl: "https://router.zosma.ai/v1" }),
    /must be a base URL/,
  );
});

test("validateRouterConfig requires matching protocols", () => {
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "https://router.zosma.ai", routerBaseUrl: "http://127.0.0.1/v1" }),
    /same protocol/,
  );
});

test("resolveRouterConfig falls back to defaults with empty env and no file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zosma-rc-"));
  try {
    assert.deepEqual(
      resolveRouterConfig(dir, {}),
      { authBaseUrl: DEFAULT_AUTH_BASE_URL, routerBaseUrl: DEFAULT_ROUTER_BASE_URL },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRouterConfig: env wins over file and defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zosma-rc-"));
  try {
    saveRouterConfig(dir, { authBaseUrl: "http://127.0.0.1:9000", routerBaseUrl: "http://127.0.0.1:9000/v1" });
    const cfg = resolveRouterConfig(dir, {
      ZOSMA_AUTH_BASE_URL: "http://127.0.0.1:7000",
      ZOSMA_ROUTER_BASE_URL: "http://127.0.0.1:7000/v1",
    });
    assert.deepEqual(cfg, { authBaseUrl: "http://127.0.0.1:7000", routerBaseUrl: "http://127.0.0.1:7000/v1" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("save + loadPersistedRouterConfig roundtrips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zosma-rc-"));
  try {
    const saved = saveRouterConfig(dir, {
      authBaseUrl: "https://self.example.com",
      routerBaseUrl: "https://self.example.com/v1",
    });
    assert.deepEqual(loadPersistedRouterConfig(dir), saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadPersistedRouterConfig throws on corrupt JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zosma-rc-"));
  try {
    await writeFile(join(dir, "zosma-router-config.json"), "{corrupt");
    assert.throws(() => loadPersistedRouterConfig(dir), /invalid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/router-config.test.mjs`
Expected: FAIL — cannot find module `./router-config.ts`.

- [ ] **Step 3: Implement**

`web/lib/zosma-auth/router-config.ts`:

```ts
/**
 * Zosma Router base-URL configuration.
 *
 * Precedence: env vars > persisted file > built-in defaults.
 * Persisted file: `<piDir>/zosma-router-config.json` — same filename the old
 * sidecar used, so existing self-hosted-router configs keep working.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_AUTH_BASE_URL = "https://router.zosma.ai";
export const DEFAULT_ROUTER_BASE_URL = "https://router.zosma.ai/v1";
export const ROUTER_CONFIG_FILE = "zosma-router-config.json";

export interface RouterConfig {
  authBaseUrl: string;
  routerBaseUrl: string;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function validateBaseUrl(name: string, value: string, pathname: string): string {
  if (!value.trim()) throw new Error(`${name} is not configured`);
  const normalized = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  const local = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for localhost development)`);
  }
  if (url.pathname !== pathname || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be a base URL with path ${pathname}`);
  }
  return url.toString().replace(/\/+$/, "");
}

export function validateRouterConfig(config: RouterConfig): RouterConfig {
  const auth = validateBaseUrl("authBaseUrl", config.authBaseUrl, "/");
  const router = validateBaseUrl("routerBaseUrl", config.routerBaseUrl, "/v1");
  const authUrl = new URL(auth);
  const routerUrl = new URL(router);
  if (authUrl.protocol !== routerUrl.protocol) {
    throw new Error("authBaseUrl and routerBaseUrl must use the same protocol");
  }
  if (
    authUrl.protocol === "http:" &&
    (!isLoopbackHost(authUrl.hostname) || !isLoopbackHost(routerUrl.hostname))
  ) {
    throw new Error("HTTP router configuration is allowed only for localhost development");
  }
  return { authBaseUrl: auth, routerBaseUrl: router };
}

export function routerConfigFilePath(piDir: string): string {
  return join(piDir, ROUTER_CONFIG_FILE);
}

export function loadPersistedRouterConfig(piDir: string): Partial<RouterConfig> {
  const file = routerConfigFilePath(piDir);
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    throw new Error("persisted router configuration is invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("persisted router configuration must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  return {
    authBaseUrl: typeof obj.authBaseUrl === "string" ? obj.authBaseUrl : undefined,
    routerBaseUrl: typeof obj.routerBaseUrl === "string" ? obj.routerBaseUrl : undefined,
  };
}

export function saveRouterConfig(piDir: string, config: RouterConfig): RouterConfig {
  const validated = validateRouterConfig(config);
  const file = routerConfigFilePath(piDir);
  mkdirSync(piDir, { recursive: true });
  writeFileSync(file, JSON.stringify(validated, null, 2), "utf-8");
  chmodSync(file, 0o600);
  return validated;
}

/**
 * Resolve effective config: env > persisted file > built-in defaults.
 * Always returns a validated config or throws.
 */
export function resolveRouterConfig(
  piDir: string,
  env: NodeJS.ProcessEnv = process.env,
): RouterConfig {
  const persisted = loadPersistedRouterConfig(piDir);
  return validateRouterConfig({
    authBaseUrl: env.ZOSMA_AUTH_BASE_URL?.trim() || persisted.authBaseUrl || DEFAULT_AUTH_BASE_URL,
    routerBaseUrl: env.ZOSMA_ROUTER_BASE_URL?.trim() || persisted.routerBaseUrl || DEFAULT_ROUTER_BASE_URL,
  });
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/router-config.test.mjs`
Expected: 10 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/lib/zosma-auth/router-config.ts web/lib/zosma-auth/router-config.test.mjs
git commit -m "feat(zosma-auth): router base-url config with defaults + overrides"
```

---

### Task 4: Provider entry ops on models.json

**Files:**
- Create: `web/lib/zosma-auth/models-json.ts`
- Test: `web/lib/zosma-auth/models-json.test.mjs`

Reuses `web/lib/models-config-store.ts` (`readModelsConfig`, `writeModelsConfig` — both accept a path argument, default to `~/.pi/agent/models.json`; `writeModelsConfig` already does atomic 0600 write + `invalidateModelsCache()`).

- [ ] **Step 1: Write the failing tests**

`web/lib/zosma-auth/models-json.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  ZOSMA_PROVIDER_ID,
  snapshotProvider,
  upsertProvider,
  restoreProvider,
  deleteProvider,
  readProviderEntry,
} = await jiti.import("./models-json.ts");

function withModelsFile(initial, run) {
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-models-"));
    const modelsPath = join(dir, "models.json");
    if (initial !== undefined) {
      await writeFile(modelsPath, JSON.stringify(initial, null, 2));
    }
    try {
      await run(modelsPath, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

const entry = {
  id: "zosma-router",
  name: "Zosma AI",
  baseUrl: "https://router.zosma.ai/v1",
  apiKey: "sk-test",
  api: "openai-completions",
  models: [{ id: "m1", name: "M1", reasoning: true }],
};

test("ZOSMA_PROVIDER_ID is zosma-router (matches live pi state)", () => {
  assert.equal(ZOSMA_PROVIDER_ID, "zosma-router");
});

test("snapshotProvider returns null when provider absent", withModelsFile(
  { providers: { other: { id: "other" } } },
  async (p) => assert.equal(snapshotProvider(p, ZOSMA_PROVIDER_ID), null),
));

test("snapshotProvider returns a deep copy (mutation-safe)", withModelsFile(
  { providers: { "zosma-router": entry } },
  async (p) => {
    const snap = snapshotProvider(p, ZOSMA_PROVIDER_ID);
    snap.models.push({ id: "evil" });
    assert.equal(snapshotProvider(p, ZOSMA_PROVIDER_ID).models.length, 1);
  },
));

test("upsertProvider creates a new provider entry", withModelsFile(
  { providers: { "llama-swap": { id: "llama-swap" } } },
  async (p) => {
    upsertProvider(p, ZOSMA_PROVIDER_ID, entry);
    const data = JSON.parse(await readFile(p, "utf-8"));
    assert.deepEqual(data.providers["zosma-router"], entry);
    assert.deepEqual(data.providers["llama-swap"], { id: "llama-swap" });
  },
));

test("upsertProvider replaces an existing entry in place", withModelsFile(
  { providers: { "zosma-router": { ...entry, apiKey: "sk-old" } } },
  async (p) => {
    upsertProvider(p, ZOSMA_PROVIDER_ID, entry);
    assert.equal(readProviderEntry(p, ZOSMA_PROVIDER_ID).apiKey, "sk-test");
  },
));

test("restoreProvider with null snapshot removes the provider", withModelsFile(
  { providers: { "zosma-router": entry, other: { id: "other" } } },
  async (p) => {
    restoreProvider(p, ZOSMA_PROVIDER_ID, null);
    const data = JSON.parse(await readFile(p, "utf-8"));
    assert.equal(data.providers["zosma-router"], undefined);
    assert.deepEqual(data.providers.other, { id: "other" });
  },
));

test("restoreProvider puts back the exact snapshot", withModelsFile(
  { providers: { "zosma-router": { ...entry, apiKey: "sk-old" } } },
  async (p) => {
    const snap = snapshotProvider(p, ZOSMA_PROVIDER_ID);
    upsertProvider(p, ZOSMA_PROVIDER_ID, entry);
    restoreProvider(p, ZOSMA_PROVIDER_ID, snap);
    assert.equal(readProviderEntry(p, ZOSMA_PROVIDER_ID).apiKey, "sk-old");
  },
));

test("deleteProvider is a no-op-safe remove", withModelsFile(
  { providers: {} },
  async (p) => {
    deleteProvider(p, ZOSMA_PROVIDER_ID);
    assert.equal(readProviderEntry(p, ZOSMA_PROVIDER_ID), null);
  },
));
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/models-json.test.mjs`
Expected: FAIL — cannot find module `./models-json.ts`.

- [ ] **Step 3: Implement**

`web/lib/zosma-auth/models-json.ts`:

```ts
/**
 * Zosma Router provider entry ops on ~/.pi/agent/models.json.
 *
 * Builds on lib/models-config-store.ts (atomic private write + cache
 * invalidation). Snapshot/restore give completeZosmaAuth its rollback
 * guarantee: if the registry never sees the new models, the previous
 * provider entry (or absence) is restored.
 */

import { readModelsConfig, writeModelsConfig } from "../models-config-store";

/**
 * Matches the provider id already present in live pi state
 * (~/.pi/agent/models.json). Re-login upgrades the entry in place
 * instead of creating a duplicate.
 */
export const ZOSMA_PROVIDER_ID = "zosma-router";

export interface ZosmaProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  api: string;
  models: Array<Record<string, unknown>>;
}

function providersOf(data: Record<string, unknown>): Record<string, unknown> {
  const providers = data.providers;
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    return providers as Record<string, unknown>;
  }
  return {};
}

/**
 * Deep copy of the provider entry, or null if the provider is absent.
 */
export function snapshotProvider(modelsPath: string, providerId: string): unknown {
  const entry = providersOf(readModelsConfig(modelsPath))[providerId];
  return entry === undefined ? null : structuredClone(entry);
}

/**
 * Upsert the provider entry (replaces any existing one).
 */
export function upsertProvider(
  modelsPath: string,
  providerId: string,
  entry: ZosmaProviderEntry,
): void {
  const data = readModelsConfig(modelsPath);
  data.providers = { ...providersOf(data), [providerId]: structuredClone(entry) };
  writeModelsConfig(data, modelsPath);
}

/**
 * Restore a snapshot taken by snapshotProvider.
 * A null snapshot removes the provider.
 */
export function restoreProvider(
  modelsPath: string,
  providerId: string,
  snapshot: unknown,
): void {
  const data = readModelsConfig(modelsPath);
  const providers = providersOf(data);
  if (snapshot === null) {
    const rest = { ...providers };
    delete rest[providerId];
    data.providers = rest;
  } else {
    data.providers = { ...providers, [providerId]: snapshot };
  }
  writeModelsConfig(data, modelsPath);
}

export function deleteProvider(modelsPath: string, providerId: string): void {
  restoreProvider(modelsPath, providerId, null);
}

export function readProviderEntry(
  modelsPath: string,
  providerId: string,
): ZosmaProviderEntry | null {
  const entry = providersOf(readModelsConfig(modelsPath))[providerId];
  if (!entry || typeof entry !== "object") return null;
  return entry as ZosmaProviderEntry;
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/models-json.test.mjs`
Expected: 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/lib/zosma-auth/models-json.ts web/lib/zosma-auth/models-json.test.mjs
git commit -m "feat(zosma-auth): models.json provider entry ops with snapshot/rollback"
```

---

### Task 5: `startZosmaAuth` + device id

**Files:**
- Create: `web/lib/zosma-auth/index.ts`
- Test: `web/lib/zosma-auth/index.test.mjs`

- [ ] **Step 1: Write the failing tests**

`web/lib/zosma-auth/index.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { startZosmaAuth, ZOSMA_CLIENT_ID } = await jiti.import("./index.ts");
const stateModule = await jiti.import("./state.ts");

function withPiDir(run) {
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-index-"));
    try {
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

function stubFetch(handler) {
  return async (url, init) => handler(String(url), init);
}

function fileExists(path) {
  return readFile(path, "utf-8").then(() => true, () => false);
}

test("startZosmaAuth returns the server authorization_url", withPiDir(async (dir) => {
  const fetch = stubFetch(async () =>
    Response.json({ authorization_url: "https://router.zosma.ai/authorize?x=1" }),
  );
  const res = await startZosmaAuth(dir, { fetch });
  assert.equal(res.authorizationUrl, "https://router.zosma.ai/authorize?x=1");
}));

test("startZosmaAuth persists pending tx + device id before the network call", withPiDir(async (dir) => {
  const calls = [];
  const fetch = stubFetch(async (url) => {
    calls.push(url);
    // Read state mid-flight: pending file must already exist.
    const pending = JSON.parse(await readFile(join(dir, "zosma-auth-pending.json"), "utf-8"));
    assert.ok(pending.state);
    assert.ok(pending.codeVerifier);
    assert.ok(pending.deviceId);
    return Response.json({ authorization_url: "https://x/authorize" });
  });
  await startZosmaAuth(dir, { fetch });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/router\.zosma\.ai\/v1\/cowork\/authorizations$/);
  const deviceId = (await readFile(join(dir, "zosma-device-id.txt"), "utf-8")).trim();
  assert.match(deviceId, /^cowork-[0-9a-f]{32}$/);
}));

test("startZosmaAuth sends frozen client_id, PKCE fields and device id", withPiDir(async (dir) => {
  let body;
  const fetch = stubFetch(async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ authorization_url: "https://x/authorize" });
  });
  await startZosmaAuth(dir, { fetch });
  assert.equal(body.client_id, ZOSMA_CLIENT_ID);
  assert.match(body.state, /^[0-9a-f]{64}$/);
  assert.match(body.code_challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(body.code_challenge_method, "S256");
  assert.match(body.device_id, /^cowork-/);
}));

test("startZosmaAuth reuses an existing device id across calls", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => Response.json({ authorization_url: "https://x/authorize" }));
  await startZosmaAuth(dir, { fetch });
  const first = await readFile(join(dir, "zosma-device-id.txt"), "utf-8");
  await startZosmaAuth(dir, { fetch });
  assert.equal(await readFile(join(dir, "zosma-device-id.txt"), "utf-8"), first);
}));

test("startZosmaAuth throws and clears pending tx when the auth server errors", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => new Response("nope", { status: 500 }));
  await assert.rejects(() => startZosmaAuth(dir, { fetch }), /Auth server returned 500/);
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
}));

test("startZosmaAuth throws when authorization_url is missing", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => Response.json({}));
  await assert.rejects(() => startZosmaAuth(dir, { fetch }), /missing authorization_url/);
}));
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/index.test.mjs`
Expected: FAIL — cannot find module `./index.ts`.

- [ ] **Step 3: Implement**

`web/lib/zosma-auth/index.ts` (this file grows in Tasks 6 and 7 — create it with the start path + shared scaffolding now):

```ts
/**
 * Zosma Router Auth — orchestration.
 *
 * Re-port of agent-sidecar/src/zosma-auth/index.ts (sidecar deleted
 * 2026-08-26). Server-side: the Next.js web server now owns the whole
 * PKCE flow; no sidecar, no Tauri.
 *
 * Frozen server contract (do not change):
 *   client_id is "zosma-cowork"
 *   POST {authBaseUrl}/v1/cowork/authorizations -> { authorization_url }
 *   POST {authBaseUrl}/v1/cowork/token          -> { access_token }
 *   GET  {authBaseUrl}/v1/models  (Bearer)      -> { data: [rows] }
 *   POST {authBaseUrl}/v1/cowork/revoke (Bearer)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { generateCodeVerifier, generateState, sha256Base64url } from "./crypto";
import { deletePending, loadPending, savePending } from "./state";
import { resolveRouterConfig } from "./router-config";
import { ZOSMA_PROVIDER_ID } from "./models-json";

export const ZOSMA_CLIENT_ID = "zosma-cowork";
export const DEVICE_ID_FILE = "zosma-device-id.txt";
const TIMEOUT_MS = 10_000;
const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Injectable dependencies. Production wiring comes from productionDeps()
 * (Task 7); tests inject stubs.
 */
export interface ZosmaAuthDeps {
  /** Reload the pi model registry (production: invalidate web models cache). */
  reload: () => Promise<void>;
  /**
   * Models visible in the registry for one provider after reload.
   * Production: fresh ModelRuntime + getProvider(providerId).
   */
  getAvailable: (providerId: string) => Promise<Array<{ id: string; provider: string }>>;
  /** fetch override (tests). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface StartAuthResult {
  authorizationUrl: string;
}

export interface CompleteAuthResult {
  providerId: string;
  selectedModelId: string;
  modelCount: number;
}

export interface ZosmaStatus {
  configured: boolean;
  pending: boolean;
  modelCount: number;
  baseUrl: string | null;
  authBaseUrl: string;
  routerBaseUrl: string;
}

function fetchImpl(deps: ZosmaAuthDeps): typeof globalThis.fetch {
  return deps.fetch ?? globalThis.fetch;
}

/**
 * Load or generate a stable device id. Persists to `<piDir>/zosma-device-id.txt`.
 */
export function loadDeviceId(piDir: string): string {
  const path = join(piDir, DEVICE_ID_FILE);
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf-8").trim();
      if (existing) return existing;
    }
  } catch {
    // Unreadable file — generate a new id below.
  }
  const id = `cowork-${randomBytes(16).toString("hex")}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, id, { mode: 0o600 });
  return id;
}

/**
 * Start the Zosma Router auth flow.
 *
 * 1. Generate state + PKCE code_verifier + S256 challenge
 * 2. Load/generate device id
 * 3. Persist pending transaction BEFORE the network call (crash-safe)
 * 4. POST {auth}/v1/cowork/authorizations
 * 5. Return authorizationUrl for the system browser
 *
 * `redirectUri` (optional): loopback callback URL forwarded to the auth
 * server so browsers can complete the flow over HTTP. Servers that ignore
 * it simply deep-link instead; the manual-paste path always works.
 */
export async function startZosmaAuth(
  piDir: string,
  deps: ZosmaAuthDeps,
  opts: { redirectUri?: string } = {},
): Promise<StartAuthResult> {
  const config = resolveRouterConfig(piDir);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = sha256Base64url(codeVerifier);
  const deviceId = loadDeviceId(piDir);

  savePending(
    { state, codeVerifier, deviceId, expiresAt: Date.now() + PENDING_TTL_MS },
    piDir,
  );

  const body: Record<string, unknown> = {
    client_id: ZOSMA_CLIENT_ID,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    device_id: deviceId,
  };
  if (opts.redirectUri) body.redirect_uri = opts.redirectUri;

  const res = await fetchImpl(deps)(`${config.authBaseUrl}/v1/cowork/authorizations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    deletePending(piDir);
    throw new Error(`Auth server returned ${res.status}`);
  }

  const parsed = (await res.json()) as { authorization_url?: string };
  if (!parsed.authorization_url) {
    deletePending(piDir);
    throw new Error("Auth server returned missing authorization_url");
  }
  return { authorizationUrl: parsed.authorization_url };
}

/**
 * Default piDir for route handlers.
 */
export function zosmaPiDir(): string {
  return getAgentDir();
}

// Facade re-export (routes import config ops from @/lib/zosma-auth).
export { saveRouterConfig } from "./router-config";
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/index.test.mjs`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/lib/zosma-auth/index.ts web/lib/zosma-auth/index.test.mjs
git commit -m "feat(zosma-auth): startZosmaAuth with PKCE + device id + pending tx"
```

---

### Task 6: `completeZosmaAuth` (exchange, catalog, save, verify, rollback)

**Files:**
- Modify: `web/lib/zosma-auth/index.ts`
- Modify: `web/lib/zosma-auth/index.test.mjs`

- [ ] **Step 1: Probe the live `ModelRuntime` provider shape (de-risks `getAvailable`)**

The production `getAvailable` (added in Task 7) reads `ModelRuntime.create()` → `getProvider("zosma-router")`. This machine's `~/.pi/agent/models.json` already contains that provider, so probe it directly:

```bash
cd web && node --input-type=module -e "
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
const rt = await ModelRuntime.create();
const p = rt.getProvider('zosma-router');
console.log('provider keys:', p ? Object.keys(p) : null);
console.log('models sample:', p?.models?.slice(0, 1));
"
```

Record the exact accessor for model ids. **Probed 2026-08-26:** `rt.getProvider('zosma-router')` has NO `models` property — models come from the `getModels()` method (returns 27 objects with `.id` on this machine). Task 7's `productionDeps` is written accordingly; re-probe if the pi SDK changes the shape.

- [ ] **Step 2: Add failing tests**

Extend the top-of-file imports in `web/lib/zosma-auth/index.test.mjs`: add `completeZosmaAuth` to the `./index.ts` destructure (the `stateModule` import already exists from Task 5). Then append:

```js
const okCatalog = [
  { id: "m-a", display_name: "Model A", context_window: 1000, max_tokens: 100, reasoning: true, input: ["text", "image"] },
  { id: "m-b", input_modalities: ["text"] },
];

function completeFetch() {
  return stubFetch(async (url) => {
    if (url.endsWith("/v1/cowork/token")) return Response.json({ access_token: "sk-new-key" });
    if (url.endsWith("/v1/models")) return Response.json({ data: okCatalog });
    throw new Error(`unexpected url ${url}`);
  });
}

function seedPending(dir, over = {}) {
  stateModule.savePending(
    { state: "s1", codeVerifier: "v1", deviceId: "cowork-d1", expiresAt: Date.now() + 600_000, ...over },
    dir,
  );
}

const recordingDeps = () => {
  const calls = { reload: 0, available: [] };
  const deps = {
    reload: async () => { calls.reload += 1; },
    getAvailable: async (providerId) => {
      calls.available.push(providerId);
      return [{ id: "m-a", provider: providerId }, { id: "m-b", provider: providerId }];
    },
    fetch: completeFetch(),
  };
  return { calls, deps };
};

test("completeZosmaAuth: happy path saves provider, reloads, verifies, returns result", withPiDir(async (dir) => {
  seedPending(dir);
  const { calls, deps } = recordingDeps();
  const res = await completeZosmaAuth("code1", "s1", dir, deps);
  assert.deepEqual(res, { providerId: "zosma-router", selectedModelId: "m-a", modelCount: 2 });
  assert.equal(calls.reload, 1);
  assert.deepEqual(calls.available, ["zosma-router"]);

  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  const prov = models.providers["zosma-router"];
  assert.equal(prov.apiKey, "sk-new-key");
  assert.equal(prov.baseUrl, "https://router.zosma.ai/v1");
  assert.equal(prov.api, "openai-completions");
  assert.deepEqual(prov.models, [
    { id: "m-a", name: "Model A", contextWindow: 1000, maxTokens: 100, reasoning: true, input: ["text", "image"] },
    { id: "m-b", name: "m-b", reasoning: false, input: ["text"] },
  ]);
  // pending tx consumed
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
}));

test("completeZosmaAuth: missing code or state throws", withPiDir(async (dir) => {
  seedPending(dir);
  const { deps } = recordingDeps();
  await assert.rejects(() => completeZosmaAuth("", "s1", dir, deps), /missing code or state/);
  await assert.rejects(() => completeZosmaAuth("c", "", dir, deps), /missing code or state/);
}));

test("completeZosmaAuth: no pending transaction throws", withPiDir(async (dir) => {
  const { deps } = recordingDeps();
  await assert.rejects(
    () => completeZosmaAuth("code1", "s1", dir, deps),
    /no pending auth transaction/,
  );
}));

test("completeZosmaAuth: state mismatch deletes pending tx and throws", withPiDir(async (dir) => {
  seedPending(dir);
  const { deps } = recordingDeps();
  await assert.rejects(() => completeZosmaAuth("code1", "WRONG", dir, deps), /state mismatch/);
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
}));

test("completeZosmaAuth: token exchange 401 maps to friendly error", withPiDir(async (dir) => {
  seedPending(dir);
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async () => new Response("unauthorized", { status: 401 })),
  };
  await assert.rejects(() => completeZosmaAuth("code1", "s1", dir, deps), /code expired or already used/);
}));

test("completeZosmaAuth: empty catalog throws and saves nothing", withPiDir(async (dir) => {
  seedPending(dir);
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async (url) => {
      if (url.endsWith("/v1/cowork/token")) return Response.json({ access_token: "sk-x" });
      return Response.json({ data: [] });
    }),
  };
  await assert.rejects(() => completeZosmaAuth("code1", "s1", dir, deps), /no models entitled/);
  assert.equal(await fileExists(join(dir, "models.json")), false);
}));

test("completeZosmaAuth: verification failure rolls back the previous provider", withPiDir(async (dir) => {
  // Pre-existing provider entry that must survive the failed attempt.
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(dir, "models.json"),
    JSON.stringify({ providers: { "zosma-router": { id: "zosma-router", name: "Old", apiKey: "sk-old", models: [] } } }),
  );
  seedPending(dir);
  const deps = {
    reload: async () => {},
    getAvailable: async () => [{ id: "only-a", provider: "zosma-router" }], // m-b missing -> verify fails
    fetch: completeFetch(),
  };
  await assert.rejects(() => completeZosmaAuth("code1", "s1", dir, deps), /not found in registry/);
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-old");
}));

test("completeZosmaAuth: verify failure with no previous provider deletes the new one", withPiDir(async (dir) => {
  seedPending(dir);
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: completeFetch(),
  };
  await assert.rejects(() => completeZosmaAuth("code1", "s1", dir, deps), /not found in registry/);
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"], undefined);
}));
```

- [ ] **Step 3: Watch it fail**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/index.test.mjs`
Expected: the 8 new complete-tests FAIL with `completeZosmaAuth is not a function`; the 6 start-tests still pass.

- [ ] **Step 4: Implement**

Append to `web/lib/zosma-auth/index.ts` (and extend the models-json import at the top to: `import { ZOSMA_PROVIDER_ID, restoreProvider, snapshotProvider, upsertProvider } from "./models-json";`):

```ts
type ModelInput = "text" | "image";

interface MappedModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning: boolean;
  input?: ModelInput[];
}

/**
 * Map router model row input capabilities to pi's `input` shape.
 */
function mapInputCapability(row: Record<string, unknown>): ModelInput[] | undefined {
  if (Array.isArray(row.input)) {
    const filtered = row.input.filter(
      (v: unknown): v is ModelInput => v === "text" || v === "image",
    );
    if (filtered.length > 0) return filtered;
  }
  if (Array.isArray(row.input_modalities)) {
    const hasImage = row.input_modalities.some(
      (m: unknown) =>
        typeof m === "string" && (m === "image" || m === "vision" || m === "image_url"),
    );
    return hasImage ? ["text", "image"] : ["text"];
  }
  return undefined;
}

function mapCatalogRows(rows: Array<Record<string, unknown>>): MappedModel[] {
  return rows.map((r) => ({
    id: String(r.id),
    name: r.display_name ? String(r.display_name) : String(r.id),
    contextWindow:
      typeof r.context_window === "number"
        ? r.context_window
        : typeof r.contextWindow === "number"
          ? r.contextWindow
          : undefined,
    maxTokens:
      typeof r.max_tokens === "number"
        ? r.max_tokens
        : typeof r.maxTokens === "number"
          ? r.maxTokens
          : undefined,
    reasoning: Boolean(r.reasoning),
    input: mapInputCapability(r),
  }));
}

/**
 * Complete the Zosma Router auth flow after the browser returns code+state.
 *
 * 1. Validate inputs
 * 2. Load pending tx, verify state match
 * 3. Exchange code + PKCE verifier for the router key
 * 4. Fetch the authenticated model catalog
 * 5. Map rows to the pi model shape
 * 6. Snapshot the existing provider entry
 * 7. Atomic upsert via models-json (writeModelsConfig already invalidates cache)
 * 8. Reload the registry (deps.reload)
 * 9. Verify every expected model is visible (deps.getAvailable)
 * 10. On any failure from 7-9: restore snapshot, reload again, rethrow
 * 11. Delete pending tx
 * 12. Return result (first model selected — matches old behavior)
 */
export async function completeZosmaAuth(
  code: string,
  state: string,
  piDir: string,
  deps: ZosmaAuthDeps,
): Promise<CompleteAuthResult> {
  const config = resolveRouterConfig(piDir);

  if (!code || !state) throw new Error("missing code or state");

  const tx = loadPending(piDir);
  if (!tx) throw new Error("no pending auth transaction (expired or never started)");
  if (tx.state !== state) {
    deletePending(piDir);
    throw new Error("state mismatch — possible CSRF");
  }

  const tokenRes = await fetchImpl(deps)(`${config.authBaseUrl}/v1/cowork/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: ZOSMA_CLIENT_ID,
      code,
      code_verifier: tx.codeVerifier,
      device_id: tx.deviceId,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!tokenRes.ok) {
    deletePending(piDir);
    const msg =
      tokenRes.status === 401
        ? "code expired or already used"
        : `token exchange returned ${tokenRes.status}`;
    throw new Error(msg);
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  const routerKey = tokenBody.access_token;
  if (!routerKey) {
    deletePending(piDir);
    throw new Error("token response missing access_token");
  }

  const modelsRes = await fetchImpl(deps)(`${config.authBaseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${routerKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!modelsRes.ok) {
    deletePending(piDir);
    throw new Error(`model catalog returned ${modelsRes.status}`);
  }

  const catalogBody = (await modelsRes.json()) as { data?: unknown[] };
  const rows = (catalogBody.data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    deletePending(piDir);
    throw new Error("no models entitled for this account");
  }

  const models = mapCatalogRows(rows);
  const result = await saveCatalogAndVerify(models, routerKey, piDir, deps, "Zosma AI", "openai-completions");
  deletePending(piDir);
  return result;
}

/**
 * Shared save → reload → verify → rollback tail, used by completeZosmaAuth
 * here and by refreshZosmaModels / authenticateWithKey (Task 7).
 */
async function saveCatalogAndVerify(
  models: MappedModel[],
  apiKey: string,
  piDir: string,
  deps: ZosmaAuthDeps,
  name: string,
  api: string,
): Promise<CompleteAuthResult> {
  const config = resolveRouterConfig(piDir);
  const modelsPath = join(piDir, "models.json");
  const prior = snapshotProvider(modelsPath, ZOSMA_PROVIDER_ID);
  try {
    upsertProvider(modelsPath, ZOSMA_PROVIDER_ID, {
      id: ZOSMA_PROVIDER_ID,
      name,
      baseUrl: config.routerBaseUrl,
      apiKey,
      api,
      models: models.map((m) => ({ ...m })),
    });
    await deps.reload();
    const available = await deps.getAvailable(ZOSMA_PROVIDER_ID);
    const registered = new Set(available.map((m) => m.id));
    for (const m of models) {
      if (!registered.has(m.id)) {
        throw new Error(`model ${m.id} not found in registry after reload`);
      }
    }
  } catch (err) {
    restoreProvider(modelsPath, ZOSMA_PROVIDER_ID, prior);
    try {
      await deps.reload();
    } catch {
      // Re-init after rollback failed — leave it, the user can retry.
    }
    throw err;
  }
  return {
    providerId: ZOSMA_PROVIDER_ID,
    selectedModelId: models[0].id,
    modelCount: models.length,
  };
}
```

- [ ] **Step 5: Watch it pass**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/index.test.mjs`
Expected: 14 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add web/lib/zosma-auth/index.ts web/lib/zosma-auth/index.test.mjs
git commit -m "feat(zosma-auth): completeZosmaAuth with catalog fetch, verify and rollback"
```

---

### Task 7: `disconnectZosmaAuth`, `cancelZosmaAuth`, `refreshZosmaModels`, `getZosmaStatus`, `productionDeps`, `resolveDeps`

**Files:**
- Modify: `web/lib/zosma-auth/index.ts`
- Modify: `web/lib/zosma-auth/index.test.mjs`

- [ ] **Step 1: Add failing tests**

Extend the top-of-file `./index.ts` destructure with `disconnectZosmaAuth, cancelZosmaAuth, refreshZosmaModels, getZosmaStatus, authenticateWithKey`. Append to `web/lib/zosma-auth/index.test.mjs`:

```js
test("disconnectZosmaAuth revokes server-side, deletes provider, reloads", withPiDir(async (dir) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", name: "Z", baseUrl: "https://router.zosma.ai/v1", apiKey: "sk-live", api: "openai-completions", models: [] } },
  }));
  const revokeCalls = [];
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async (url, init) => {
      revokeCalls.push([url, init.headers.Authorization]);
      return new Response("ok", { status: 200 });
    }),
  };
  await disconnectZosmaAuth(dir, deps);
  assert.equal(revokeCalls.length, 1);
  assert.match(revokeCalls[0][0], /\/v1\/cowork\/revoke$/);
  assert.equal(revokeCalls[0][1], "Bearer sk-live");
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"], undefined);
}));

test("disconnectZosmaAuth proceeds locally when the revoke call fails", withPiDir(async (dir) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", apiKey: "sk-live", models: [] } },
  }));
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async () => new Response("boom", { status: 500 })),
  };
  await disconnectZosmaAuth(dir, deps); // must not throw
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"], undefined);
}));

test("cancelZosmaAuth deletes the pending tx only", withPiDir(async (dir) => {
  seedPending(dir);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", apiKey: "sk-live", models: [] } },
  }));
  await cancelZosmaAuth(dir);
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.ok(models.providers["zosma-router"]); // provider untouched
}));

test("refreshZosmaModels re-fetches the catalog with the existing key", withPiDir(async (dir) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", name: "Z", baseUrl: "https://router.zosma.ai/v1", apiKey: "sk-live", api: "openai-completions", models: [{ id: "old" }] } },
  }));
  const deps = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "new-1", provider: pid }],
    fetch: stubFetch(async (url) => {
      if (!url.endsWith("/v1/models")) throw new Error(`unexpected ${url}`);
      return Response.json({ data: [{ id: "new-1", display_name: "New 1" }] });
    }),
  };
  const res = await refreshZosmaModels(dir, deps);
  assert.deepEqual(res, { modelCount: 1, selectedModelId: "new-1" });
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-live"); // key unchanged
  assert.equal(models.providers["zosma-router"].models.length, 1);
  assert.equal(models.providers["zosma-router"].models[0].id, "new-1");
}));

test("refreshZosmaModels throws when not configured", withPiDir(async (dir) => {
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async () => Response.json({ data: [] })),
  };
  await assert.rejects(() => refreshZosmaModels(dir, deps), /not configured/);
}));

test("getZosmaStatus reports configured/pending/model count", withPiDir(async (dir) => {
  seedPending(dir);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", baseUrl: "https://router.zosma.ai/v1", apiKey: "sk", models: [{ id: "a" }, { id: "b" }] } },
  }));
  const status = getZosmaStatus(dir);
  assert.equal(status.configured, true);
  assert.equal(status.pending, true);
  assert.equal(status.modelCount, 2);
  assert.equal(status.baseUrl, "https://router.zosma.ai/v1");
  assert.equal(status.authBaseUrl, "https://router.zosma.ai");
}));

test("getZosmaStatus is clean when nothing is set up", withPiDir(async (dir) => {
  const status = getZosmaStatus(dir);
  assert.deepEqual(status, {
    configured: false,
    pending: false,
    modelCount: 0,
    baseUrl: null,
    authBaseUrl: "https://router.zosma.ai",
    routerBaseUrl: "https://router.zosma.ai/v1",
  });
}));

test("authenticateWithKey saves a fresh key and its catalog", withPiDir(async (dir) => {
  const deps = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "k1", provider: pid }],
    fetch: stubFetch(async (url) => {
      if (!String(url).endsWith("/v1/models")) throw new Error(`unexpected ${url}`);
      return Response.json({ data: [{ id: "k1", display_name: "K1" }] });
    }),
  };
  const res = await authenticateWithKey("  sk-pasted  ", dir, deps);
  assert.deepEqual(res, { providerId: "zosma-router", selectedModelId: "k1", modelCount: 1 });
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-pasted");
}));

test("authenticateWithKey rolls back on verification failure", withPiDir(async (dir) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", name: "Old", apiKey: "sk-old", models: [] } },
  }));
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async () => Response.json({ data: [{ id: "k1" }] })),
  };
  await assert.rejects(() => authenticateWithKey("sk-new", dir, deps), /not found in registry/);
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-old");
}));
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/index.test.mjs`
Expected: the 9 new tests FAIL (`not a function`); the previous 14 pass.

- [ ] **Step 3: Implement**

Add to the top import block of `web/lib/zosma-auth/index.ts` (merge with the existing `@earendil-works/pi-coding-agent` import):

```ts
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "../models-cache";
import { ZOSMA_PROVIDER_ID, deleteProvider, readProviderEntry, restoreProvider, snapshotProvider, upsertProvider } from "./models-json";
```

(replacing the earlier `import { ZOSMA_PROVIDER_ID } from "./models-json";` and the Task 6 extended import — one combined import line.)

Append to `web/lib/zosma-auth/index.ts`:

```ts
/**
 * Test seam: route unit tests override production deps (ModelRuntime +
 * network) without touching the real agent dir. Production code never
 * sets this global.
 */
declare global {
  var __zosmaAuthDepsForTests: ZosmaAuthDeps | undefined;
}

/**
 * Production dependency wiring: web models-cache invalidation + live
 * ModelRuntime reads.
 */
export function productionDeps(): ZosmaAuthDeps {
  return {
    reload: async () => {
      invalidateModelsCache();
    },
    getAvailable: async (providerId) => {
      const runtime = await ModelRuntime.create();
      const provider = runtime.getProvider(providerId);
      if (!provider) return [];
      const models = provider.getModels?.() ?? [];
      return models.map((m) => ({ id: m.id, provider: providerId }));
    },
  };
}

/**
 * Deps to use at runtime: test override if present, else production.
 */
export function resolveDeps(): ZosmaAuthDeps {
  return globalThis.__zosmaAuthDepsForTests ?? productionDeps();
}

/**
 * Disconnect: best-effort server-side revoke, local provider removal, reload.
 * Revoke failures never block the local disconnect.
 */
export async function disconnectZosmaAuth(piDir: string, deps: ZosmaAuthDeps): Promise<void> {
  const config = resolveRouterConfig(piDir);
  const modelsPath = join(piDir, "models.json");
  const provider = readProviderEntry(modelsPath, ZOSMA_PROVIDER_ID);

  if (provider?.apiKey) {
    try {
      const res = await fetchImpl(deps)(`${config.authBaseUrl}/v1/cowork/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`[zosma-auth] server revoke returned ${res.status}; proceeding locally`);
      }
    } catch {
      console.warn("[zosma-auth] server revoke failed; proceeding locally");
    }
  }

  deleteProvider(modelsPath, ZOSMA_PROVIDER_ID);
  await deps.reload();
}

/**
 * Cancel an in-progress flow: deletes the pending PKCE transaction only.
 * Never touches the configured provider.
 */
export async function cancelZosmaAuth(piDir: string): Promise<void> {
  deletePending(piDir);
}

/**
 * Refresh the model catalog with the existing key (no key rotation).
 */
export async function refreshZosmaModels(
  piDir: string,
  deps: ZosmaAuthDeps,
): Promise<{ modelCount: number; selectedModelId: string }> {
  const config = resolveRouterConfig(piDir);
  const modelsPath = join(piDir, "models.json");
  const provider = readProviderEntry(modelsPath, ZOSMA_PROVIDER_ID);
  if (!provider?.apiKey) throw new Error("Zosma Router is not configured");

  const modelsRes = await fetchImpl(deps)(`${config.authBaseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!modelsRes.ok) throw new Error(`model catalog returned ${modelsRes.status}`);

  const catalogBody = (await modelsRes.json()) as { data?: unknown[] };
  const rows = (catalogBody.data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) throw new Error("no models entitled for this account");

  const models = mapCatalogRows(rows);
  const result = await saveCatalogAndVerify(
    models,
    provider.apiKey,
    piDir,
    deps,
    provider.name ?? "Zosma AI",
    provider.api ?? "openai-completions",
  );
  return { modelCount: result.modelCount, selectedModelId: result.selectedModelId };
}

/**
 * Degraded sign-in for environments where the PKCE endpoints are not
 * deployed (Task 0 finding: production LiteLLM proxy has no /v1/cowork/*):
 * take a router key directly, fetch the catalog with it, save + verify.
 */
export async function authenticateWithKey(
  apiKey: string,
  piDir: string,
  deps: ZosmaAuthDeps,
): Promise<CompleteAuthResult> {
  const config = resolveRouterConfig(piDir);
  const key = apiKey.trim();
  if (!key) throw new Error("missing API key");

  const modelsRes = await fetchImpl(deps)(`${config.authBaseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!modelsRes.ok) throw new Error(`model catalog returned ${modelsRes.status}`);

  const catalogBody = (await modelsRes.json()) as { data?: unknown[] };
  const rows = (catalogBody.data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) throw new Error("no models entitled for this account");

  const models = mapCatalogRows(rows);
  const existing = readProviderEntry(join(piDir, "models.json"), ZOSMA_PROVIDER_ID);
  return saveCatalogAndVerify(
    models,
    key,
    piDir,
    deps,
    existing?.name ?? "Zosma AI",
    existing?.api ?? "openai-completions",
  );
}

/**
 * Read-only status for the UI: is the provider configured, is a sign-in
 * in flight, how many models, which base URLs are effective.
 */
export function getZosmaStatus(piDir: string): ZosmaStatus {
  const config = resolveRouterConfig(piDir);
  const provider = readProviderEntry(join(piDir, "models.json"), ZOSMA_PROVIDER_ID);
  return {
    configured: Boolean(provider),
    pending: Boolean(loadPending(piDir)),
    modelCount: provider?.models?.length ?? 0,
    baseUrl: provider?.baseUrl ?? null,
    authBaseUrl: config.authBaseUrl,
    routerBaseUrl: config.routerBaseUrl,
  };
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test lib/zosma-auth/index.test.mjs`
Expected: 20 pass, 0 fail.

- [ ] **Step 5: Run the whole zosma-auth lib suite**

Run: `cd web && node --experimental-strip-types --test "lib/zosma-auth/*.test.mjs"`
Expected: all pass (57 tests across 5 files: 7+9+10+8+23).

- [ ] **Step 6: Commit**

```bash
git add web/lib/zosma-auth/index.ts web/lib/zosma-auth/index.test.mjs
git commit -m "feat(zosma-auth): disconnect/cancel/refresh/status + production deps"
```

---

### Task 8: Routes — start, status, disconnect, cancel, config

**Files:**
- Create: `web/app/api/auth/zosma/start/route.ts`
- Create: `web/app/api/auth/zosma/status/route.ts`
- Create: `web/app/api/auth/zosma/disconnect/route.ts`
- Create: `web/app/api/auth/zosma/cancel/route.ts`
- Create: `web/app/api/auth/zosma/config/route.ts`
- Create: `web/app/api/auth/zosma/test-helper.mjs`
- Test: `web/app/api/auth/zosma/start/route.test.mjs`
- Test: `web/app/api/auth/zosma/status/route.test.mjs`
- Test: `web/app/api/auth/zosma/disconnect/route.test.mjs`
- Test: `web/app/api/auth/zosma/config/route.test.mjs`

Route conventions (match existing routes like `app/api/auth/providers/route.ts`): plain `Response.json`, `export const dynamic = "force-dynamic"`, no framework-specific headers.

Shared test helper — create `web/app/api/auth/zosma/test-helper.mjs`. ALL zosma route tests (this task and Task 9) use this exact shape; cleanup is registered via `t.after` so a failing assertion still restores the env var and removes the temp dir:

```js
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test wrapper that points PI_CODING_AGENT_DIR at a fresh temp dir.
 * getAgentDir() (pi-coding-agent) reads the env var at call time.
 * Usage: test("...", withAgentDir(async (dir, t) => { ... }));
 */
export function withAgentDir(run) {
  return async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-route-"));
    const prev = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    t.after(async () => {
      if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prev;
      await rm(dir, { recursive: true, force: true });
    });
    await run(dir, t);
  };
}
```

- [ ] **Step 1: Write the failing tests**

`web/app/api/auth/zosma/start/route.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

test("POST /start returns the authorizationUrl from the auth server", withAgentDir(async (_dir, t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ authorization_url: "https://stub.example/authorize?state=x" });
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/start", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { authorizationUrl: "https://stub.example/authorize?state=x" });
}));

test("POST /start forwards redirectUri to the auth server", withAgentDir(async (_dir, t) => {
  let seenBody;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    seenBody = JSON.parse(init.body);
    return Response.json({ authorization_url: "https://stub.example/authorize" });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirectUri: "http://127.0.0.1:30141/api/auth/zosma/callback" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(seenBody.redirect_uri, "http://127.0.0.1:30141/api/auth/zosma/callback");
}));

test("POST /start maps auth server errors to 502 with a message", withAgentDir(async (_dir, t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("down", { status: 503 });
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/start", { method: "POST" }));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "Auth server returned 503" });
}));

test("POST /start tolerates a missing body", withAgentDir(async (_dir, t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ authorization_url: "https://stub.example/authorize" });
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/start", { method: "POST" }));
  assert.equal(res.status, 200);
}));
```

`web/app/api/auth/zosma/status/route.test.mjs`:

```js
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");

test("GET /status reports an unconfigured default state", withAgentDir(async () => {
  const res = await GET(new Request("http://localhost/api/auth/zosma/status"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.configured, false);
  assert.equal(body.modelCount, 0);
  assert.equal(body.authBaseUrl, "https://router.zosma.ai");
  assert.equal(body.routerBaseUrl, "https://router.zosma.ai/v1");
}));

test("GET /status reports a configured provider", withAgentDir(async (dir) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: {
      "zosma-router": {
        id: "zosma-router", name: "Z", baseUrl: "https://router.zosma.ai/v1",
        apiKey: "sk", api: "openai-completions", models: [{ id: "a" }, { id: "b" }],
      },
    },
  }));
  const res = await GET(new Request("http://localhost/api/auth/zosma/status"));
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.equal(body.modelCount, 2);
  assert.equal(body.baseUrl, "https://router.zosma.ai/v1");
}));
```

`web/app/api/auth/zosma/disconnect/route.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

test("POST /disconnect removes the provider and reports ok", withAgentDir(async (dir, t) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", apiKey: "sk-live", models: [] } },
  }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: 200 });
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/disconnect", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"], undefined);
}));

test("POST /disconnect is a clean no-op when not configured", withAgentDir(async () => {
  const res = await POST(new Request("http://localhost/api/auth/zosma/disconnect", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
}));
```

`web/app/api/auth/zosma/config/route.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { PUT } = await jiti.import("./route.ts");

test("PUT /config persists a self-hosted router override", withAgentDir(async (dir) => {
  const res = await PUT(
    new Request("http://localhost/api/auth/zosma/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authBaseUrl: "https://router.internal.example",
        routerBaseUrl: "https://router.internal.example/v1",
      }),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    authBaseUrl: "https://router.internal.example",
    routerBaseUrl: "https://router.internal.example/v1",
  });
  const file = JSON.parse(await readFile(join(dir, "zosma-router-config.json"), "utf-8"));
  assert.equal(file.authBaseUrl, "https://router.internal.example");
}));

test("PUT /config rejects invalid URLs with 400", withAgentDir(async () => {
  const res = await PUT(
    new Request("http://localhost/api/auth/zosma/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authBaseUrl: "http://insecure.example", routerBaseUrl: "http://insecure.example/v1" }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /HTTPS/);
}));
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test app/api/auth/zosma/start/route.test.mjs app/api/auth/zosma/status/route.test.mjs app/api/auth/zosma/disconnect/route.test.mjs app/api/auth/zosma/config/route.test.mjs`
Expected: FAIL — cannot find module `./route.ts` (four times).

- [ ] **Step 3: Implement the routes**

`web/app/api/auth/zosma/start/route.ts`:

```ts
import { startZosmaAuth, productionDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/start — kick off the PKCE sign-in.
// Body (optional): { redirectUri?: string } — loopback callback URL forwarded
// to the auth server for browser completion.
export async function POST(req: Request) {
  let body: { redirectUri?: string } = {};
  try {
    body = (await req.json()) as { redirectUri?: string };
  } catch {
    // Missing/empty body is fine.
  }
  try {
    const result = await startZosmaAuth(zosmaPiDir(), productionDeps(), {
      redirectUri: body.redirectUri,
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to start sign-in";
    return Response.json({ error: message }, { status: 502 });
  }
}
```

`web/app/api/auth/zosma/status/route.ts`:

```ts
import { getZosmaStatus, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// GET /api/auth/zosma/status — read-only sign-in state for the UI.
export async function GET() {
  try {
    return Response.json(getZosmaStatus(zosmaPiDir()));
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read status";
    return Response.json({ error: message }, { status: 500 });
  }
}
```

`web/app/api/auth/zosma/disconnect/route.ts`:

```ts
import { disconnectZosmaAuth, productionDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/disconnect — revoke server-side (best-effort),
// remove the local provider, reload the registry.
export async function POST() {
  try {
    await disconnectZosmaAuth(zosmaPiDir(), productionDeps());
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to disconnect";
    return Response.json({ error: message }, { status: 500 });
  }
}
```

`web/app/api/auth/zosma/cancel/route.ts`:

```ts
import { cancelZosmaAuth, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/cancel — abandon the in-progress sign-in.
// Deletes the pending PKCE transaction only; never touches the provider.
export async function POST() {
  await cancelZosmaAuth(zosmaPiDir());
  return Response.json({ ok: true });
}
```

`web/app/api/auth/zosma/config/route.ts`:

```ts
import { saveRouterConfig, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// PUT /api/auth/zosma/config — persist a self-hosted router base-URL override.
// Body: { authBaseUrl: string, routerBaseUrl: string }
export async function PUT(req: Request) {
  let body: { authBaseUrl?: string; routerBaseUrl?: string };
  try {
    body = (await req.json()) as { authBaseUrl?: string; routerBaseUrl?: string };
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }
  if (typeof body?.authBaseUrl !== "string" || typeof body?.routerBaseUrl !== "string") {
    return Response.json(
      { error: "authBaseUrl and routerBaseUrl are required" },
      { status: 400 },
    );
  }
  try {
    const saved = saveRouterConfig(zosmaPiDir(), {
      authBaseUrl: body.authBaseUrl,
      routerBaseUrl: body.routerBaseUrl,
    });
    return Response.json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid configuration";
    return Response.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test app/api/auth/zosma/start/route.test.mjs app/api/auth/zosma/status/route.test.mjs app/api/auth/zosma/disconnect/route.test.mjs app/api/auth/zosma/config/route.test.mjs`
Expected: 10 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/auth/zosma/
git commit -m "feat(zosma-auth): start/status/disconnect/cancel/config routes"
```

---

### Task 9: Routes — complete, callback, refresh

**Files:**
- Create: `web/app/api/auth/zosma/complete/route.ts`
- Create: `web/app/api/auth/zosma/callback/route.ts`
- Create: `web/app/api/auth/zosma/refresh/route.ts`
- Create: `web/app/api/auth/zosma/api-key/route.ts`
- Test: `web/app/api/auth/zosma/complete/route.test.mjs`
- Test: `web/app/api/auth/zosma/callback/route.test.mjs`
- Test: `web/app/api/auth/zosma/refresh/route.test.mjs`
- Test: `web/app/api/auth/zosma/api-key/route.test.mjs`

These routes run the full flow, whose production wiring touches the real `ModelRuntime` and network. To keep the tests deterministic, they use the `globalThis.__zosmaAuthDepsForTests` seam added in Task 7 (`resolveDeps()`). Tests set the override and clean it up in `t.after`.

- [ ] **Step 1: Write the failing tests**

`web/app/api/auth/zosma/complete/route.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const stateModule = await jiti.import("../../../../../lib/zosma-auth/state.ts");

function seedPending(dir) {
  stateModule.savePending(
    { state: "s1", codeVerifier: "v1", deviceId: "cowork-d1", expiresAt: Date.now() + 600_000 },
    dir,
  );
}

function stubRegistryAndNetwork(t) {
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "m1", provider: pid }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v1/cowork/token")) return Response.json({ access_token: "sk-new" });
    if (String(url).endsWith("/v1/models")) return Response.json({ data: [{ id: "m1" }] });
    throw new Error(`unexpected ${url}`);
  };
  t.after(() => {
    delete globalThis.__zosmaAuthDepsForTests;
    globalThis.fetch = realFetch;
  });
}

test("POST /complete exchanges and returns the result", withAgentDir(async (dir, t) => {
  seedPending(dir);
  stubRegistryAndNetwork(t);
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c1", state: "s1" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    providerId: "zosma-router",
    selectedModelId: "m1",
    modelCount: 1,
  });
}));

test("POST /complete rejects state mismatch with 400", withAgentDir(async (dir, t) => {
  seedPending(dir);
  stubRegistryAndNetwork(t);
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c1", state: "nope" }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /state mismatch/);
}));

test("POST /complete maps expired-pending to 400", withAgentDir(async (_dir, t) => {
  stubRegistryAndNetwork(t);
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c1", state: "s1" }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no pending auth transaction/);
}));

test("POST /complete rejects a missing body field with 400", withAgentDir(async (_dir, t) => {
  stubRegistryAndNetwork(t);
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c1" }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /code and state required/);
}));
```

`web/app/api/auth/zosma/callback/route.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const stateModule = await jiti.import("../../../../../lib/zosma-auth/state.ts");

function seedPending(dir, state = "s1") {
  stateModule.savePending(
    { state, codeVerifier: "v1", deviceId: "cowork-d1", expiresAt: Date.now() + 600_000 },
    dir,
  );
}

function stubRegistryAndNetwork(t) {
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "m1", provider: pid }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v1/cowork/token")) return Response.json({ access_token: "sk-new" });
    if (String(url).endsWith("/v1/models")) return Response.json({ data: [{ id: "m1" }] });
    throw new Error(`unexpected ${url}`);
  };
  t.after(() => {
    delete globalThis.__zosmaAuthDepsForTests;
    globalThis.fetch = realFetch;
  });
}

// The route returns a plain 302 Response with an absolute Location header;
// the test just parses that header — no actual navigation in a unit test.

test("GET /callback completes and redirects to / with success params", withAgentDir(async (dir, t) => {
  seedPending(dir);
  stubRegistryAndNetwork(t);
  const res = await GET(new Request("http://localhost/api/auth/zosma/callback?code=c1&state=s1"));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.pathname, "/");
  assert.equal(loc.searchParams.get("zosma"), "success");
  assert.equal(loc.searchParams.get("models"), "1");
}));

test("GET /callback redirects with an error message on failure", withAgentDir(async (dir, t) => {
  seedPending(dir, "other-state");
  stubRegistryAndNetwork(t);
  const res = await GET(new Request("http://localhost/api/auth/zosma/callback?code=c1&state=s1"));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.pathname, "/");
  assert.equal(loc.searchParams.get("zosma"), "error");
  assert.ok(loc.searchParams.get("message").length > 0);
}));

test("GET /callback without code+state redirects to an error", withAgentDir(async (_dir, t) => {
  stubRegistryAndNetwork(t);
  const res = await GET(new Request("http://localhost/api/auth/zosma/callback?code=c1"));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.searchParams.get("zosma"), "error");
}));
```

`web/app/api/auth/zosma/refresh/route.test.mjs`:

```js
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

test("POST /refresh re-fetches the catalog with the existing key", withAgentDir(async (dir, t) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: {
      "zosma-router": {
        id: "zosma-router", name: "Z", baseUrl: "https://router.zosma.ai/v1",
        apiKey: "sk-live", api: "openai-completions", models: [{ id: "old" }],
      },
    },
  }));
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "new-1", provider: pid }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/v1\/models$/);
    return Response.json({ data: [{ id: "new-1", display_name: "New 1" }] });
  };
  t.after(() => {
    delete globalThis.__zosmaAuthDepsForTests;
    globalThis.fetch = realFetch;
  });
  const res = await POST(new Request("http://localhost/api/auth/zosma/refresh", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { modelCount: 1, selectedModelId: "new-1" });
}));

test("POST /refresh is 400 when not configured", withAgentDir(async (_dir, t) => {
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async () => [],
  };
  t.after(() => { delete globalThis.__zosmaAuthDepsForTests; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/refresh", { method: "POST" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not configured/);
}));
```

`web/app/api/auth/zosma/api-key/route.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

test("POST /api-key saves the key and returns the result", withAgentDir(async (dir, t) => {
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "k1", provider: pid }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: "k1" }] });
  t.after(() => {
    delete globalThis.__zosmaAuthDepsForTests;
    globalThis.fetch = realFetch;
  });
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-pasted" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).providerId, "zosma-router");
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-pasted");
}));

test("POST /api-key rejects an empty key with 400", withAgentDir(async () => {
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assert.equal(res.status, 400);
}));
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test app/api/auth/zosma/complete/route.test.mjs app/api/auth/zosma/callback/route.test.mjs app/api/auth/zosma/refresh/route.test.mjs`
Expected: FAIL — cannot find module `./route.ts` (three times).

- [ ] **Step 3: Implement the routes**

`web/app/api/auth/zosma/complete/route.ts`:

```ts
import { completeZosmaAuth, resolveDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/complete — finish the flow from code+state delivered
// by the Tauri deep link or the manual-paste fallback.
export async function POST(req: Request) {
  let body: { code?: string; state?: string };
  try {
    body = (await req.json()) as { code?: string; state?: string };
  } catch {
    return Response.json({ error: "code and state required" }, { status: 400 });
  }
  if (typeof body?.code !== "string" || typeof body?.state !== "string") {
    return Response.json({ error: "code and state required" }, { status: 400 });
  }
  try {
    const result = await completeZosmaAuth(body.code, body.state, zosmaPiDir(), resolveDeps());
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to complete sign-in";
    // 400 for user-recoverable flow errors (expired, mismatch, missing body);
    // 502 when the remote auth server is the problem.
    const status = /no pending auth transaction|state mismatch|missing code or state/.test(message) ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
```

`web/app/api/auth/zosma/callback/route.ts`:

```ts
import { completeZosmaAuth, resolveDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// GET /api/auth/zosma/callback?code&state — loopback redirect target.
// The auth server (when it honors redirect_uri) sends the user's browser
// here; we complete the flow server-side and bounce back to the app root
// with a `zosma` result param. AppShell opens the Models panel from that
// param (Task 11B). A plain 302 Response is used (not NextResponse)
// because route unit tests run under plain node + jiti, where next/server
// has no runtime.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const bounce = (zosma: "success" | "error", extra: Record<string, string> = {}) => {
    const next = new URL("/", req.url);
    next.searchParams.set("zosma", zosma);
    for (const [k, v] of Object.entries(extra)) next.searchParams.set(k, v);
    return new Response(null, { status: 302, headers: { Location: next.toString() } });
  };

  if (!code || !state) {
    return bounce("error", { message: "missing code or state in redirect" });
  }

  try {
    const result = await completeZosmaAuth(code, state, zosmaPiDir(), resolveDeps());
    return bounce("success", { models: String(result.modelCount) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to complete sign-in";
    return bounce("error", { message });
  }
}
```

`web/app/api/auth/zosma/refresh/route.ts`:

```ts
import { refreshZosmaModels, resolveDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/refresh — re-pull the entitled catalog with the
// existing key. No sign-in round trip.
export async function POST() {
  try {
    const result = await refreshZosmaModels(zosmaPiDir(), resolveDeps());
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to refresh models";
    const status = message === "Zosma Router is not configured" ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
```

`web/app/api/auth/zosma/api-key/route.ts`:

```ts
import { authenticateWithKey, resolveDeps, zosmaPiDir } from "@/lib/zosma-auth";

export const dynamic = "force-dynamic";

// POST /api/auth/zosma/api-key — degraded sign-in: paste a router key
// directly. Works even where the /v1/cowork/* PKCE endpoints are not
// deployed (Task 0 finding: production LiteLLM proxy has none).
export async function POST(req: Request) {
  let body: { apiKey?: string };
  try {
    body = (await req.json()) as { apiKey?: string };
  } catch {
    return Response.json({ error: "apiKey required" }, { status: 400 });
  }
  if (typeof body?.apiKey !== "string") {
    return Response.json({ error: "apiKey required" }, { status: 400 });
  }
  try {
    const result = await authenticateWithKey(body.apiKey, zosmaPiDir(), resolveDeps());
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to save API key";
    const status = message === "missing API key" ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test app/api/auth/zosma/complete/route.test.mjs app/api/auth/zosma/callback/route.test.mjs app/api/auth/zosma/refresh/route.test.mjs app/api/auth/zosma/api-key/route.test.mjs`
Expected: 11 pass, 0 fail.

- [ ] **Step 5: Re-run all zosma route tests together**

Run: `cd web && node --experimental-strip-types --test app/api/auth/zosma/*/route.test.mjs`
Expected: all pass (21 tests).

- [ ] **Step 6: Commit**

```bash
git add web/app/api/auth/zosma/
git commit -m "feat(zosma-auth): complete/callback/refresh routes"
```

---

### Task 10: `useZosmaAuth` client hook

**Files:**
- Create: `web/hooks/useZosmaAuth.ts`
- Test: `web/hooks/useZosmaAuth.test.mjs`
- Modify: `web/package.json` (add `@tauri-apps/plugin-deep-link`)

The old hook (`main:src/hooks/useZosmaAuth.ts`, 251 lines, deleted) drove the same state machine over Tauri `invoke`. This version drives it over `fetch` to the new routes and adds the universal manual-paste fallback.

- [ ] **Step 1: Install the deep-link JS package**

```bash
cd web && pnpm add @tauri-apps/plugin-deep-link
```

(It is a no-op in plain browsers — the hook only imports it when `window.__TAURI_INTERNALS__` exists, and the import is dynamic + guarded.)

- [ ] **Step 2: Write the failing tests**

`web/hooks/useZosmaAuth.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { parseCallbackUrl, safeError, isTauri } = await jiti.import("./useZosmaAuth.ts");

// ── parseCallbackUrl ────────────────────────────────────────────────
// Accepts: deep links, loopback redirect URLs, full pasted URLs, bare code.
// Rejects: anything else. Returns { code, state? } | null.

test("parseCallbackUrl accepts the Tauri deep link", () => {
  assert.deepEqual(
    parseCallbackUrl("ai.zosma.cowork://oauth/callback?code=c1&state=s1"),
    { code: "c1", state: "s1" },
  );
});

test("parseCallbackUrl accepts the loopback callback URL", () => {
  assert.deepEqual(
    parseCallbackUrl("http://127.0.0.1:30141/api/auth/zosma/callback?code=c2&state=s2"),
    { code: "c2", state: "s2" },
  );
});

test("parseCallbackUrl accepts any https URL carrying code+state", () => {
  assert.deepEqual(
    parseCallbackUrl("https://router.zosma.ai/done?code=c3&state=s3"),
    { code: "c3", state: "s3" },
  );
});

test("parseCallbackUrl accepts a bare code", () => {
  assert.deepEqual(parseCallbackUrl("just-a-code"), { code: "just-a-code" });
});

test("parseCallbackUrl rejects duplicate params", () => {
  assert.equal(parseCallbackUrl("http://127.0.0.1:30141/x?code=a&code=b&state=s"), null);
});

test("parseCallbackUrl rejects unknown deep-link schemes", () => {
  assert.equal(parseCallbackUrl("evil://oauth/callback?code=c&state=s"), null);
});

test("parseCallbackUrl rejects missing code", () => {
  assert.equal(parseCallbackUrl("http://127.0.0.1:30141/x?state=s"), null);
});

// ── safeError ───────────────────────────────────────────────────────

test("safeError maps expired/mismatched pending sessions", () => {
  assert.match(safeError(new Error("no pending auth transaction (expired or never started)")), /expired/i);
  assert.match(safeError(new Error("state mismatch — possible CSRF")), /signing in again/i);
});

test("safeError passes through other messages", () => {
  assert.equal(safeError(new Error("Auth server returned 503")), "Auth server returned 503");
  assert.equal(safeError("plain string"), "plain string");
});

// ── isTauri ─────────────────────────────────────────────────────────

test("isTauri is false outside Tauri", () => {
  assert.equal(isTauri({}), false);
});

test("isTauri is true when __TAURI_INTERNALS__ exists", () => {
  assert.equal(isTauri({ __TAURI_INTERNALS__: { invoke: () => {} } }), true);
});
```

- [ ] **Step 3: Watch it fail**

Run: `cd web && node --experimental-strip-types --test hooks/useZosmaAuth.test.mjs`
Expected: FAIL — cannot find module `./useZosmaAuth.ts`.

- [ ] **Step 4: Implement**

`web/hooks/useZosmaAuth.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useZosmaAuth — Zosma Router sign-in state machine (web version).
 *
 * idle → starting → waiting_browser → completing → done
 *                          ↘ error          ↑
 *              cancel → idle └──────────────┘
 *
 * Delivery paths for code+state:
 *  1. Loopback: auth server redirects the browser to
 *     /api/auth/zosma/callback — the server completes the flow itself and
 *     bounces to /models; this hook notices via onCompleted (the parent
 *     re-renders from the URL params) or a status re-poll.
 *  2. Tauri deep link: ai.zosma.cowork://oauth/callback?code&state →
 *     onOpenUrl listener → complete().
 *  3. Manual paste: submitManual(raw) — universal fallback.
 *
 * Security: never surface PKCE verifier, raw code, or state in error text.
 */

export type ZosmaAuthPhase =
  | "idle"
  | "starting"
  | "waiting_browser"
  | "completing"
  | "done"
  | "error";

export interface ZosmaAuthResult {
  providerId: string;
  selectedModelId: string;
  modelCount: number;
}

export interface UseZosmaAuthOptions {
  onCompleted?: (result: ZosmaAuthResult) => void;
  /** Loopback callback base — defaults to this page's origin. */
  redirectUri?: string;
}

export function isTauri(win: Window | Record<string, unknown>): boolean {
  return Boolean((win as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export interface ParsedCallback {
  code: string;
  state?: string;
}

/**
 * Extract { code, state? } from a deep link, redirect URL, or bare code.
 * Pure + exported for tests.
 */
export function parseCallbackUrl(raw: string): ParsedCallback | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    // Deep links: only the app's own scheme. http(s): any host (loopback or
    // whatever the auth server sent back).
    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:" &&
      parsed.protocol !== "ai.zosma.cowork:"
    ) {
      return null;
    }
    if (parsed.searchParams.getAll("code").length !== 1) return null;
    if (parsed.searchParams.getAll("state").length > 1) return null;
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state") ?? undefined;
    if (!code) return null;
    return state ? { code, state } : { code };
  }

  // Bare code (no scheme): accept a single unreserved token.
  if (/^[A-Za-z0-9._~-]{1,512}$/.test(trimmed)) {
    return { code: trimmed };
  }
  return null;
}

export function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("no pending") || msg.includes("expired")) {
    return "Sign-in session expired. Please try again.";
  }
  if (msg.includes("state mismatch")) {
    return "Something went wrong. Please try signing in again.";
  }
  if (msg.includes("timeout")) {
    return "Request timed out. Please check your connection and try again.";
  }
  return msg;
}

async function openInSystemBrowser(url: string): Promise<void> {
  const win = window as Window & {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args: object) => Promise<unknown> };
  };
  if (win.__TAURI_INTERNALS__?.invoke) {
    try {
      await win.__TAURI_INTERNALS__.invoke("open_url", { url });
      return;
    } catch {
      // Fall through to window.open (command missing → user sees a tab).
    }
  }
  window.open(url, "_blank", "noopener");
}

export function useZosmaAuth(options: UseZosmaAuthOptions = {}) {
  const [phase, setPhase] = useState<ZosmaAuthPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ZosmaAuthResult | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const deliveredRef = useRef(false);
  const onCompletedRef = useRef(options.onCompleted);
  onCompletedRef.current = options.onCompleted;
  const redirectUriRef = useRef(options.redirectUri);
  redirectUriRef.current = options.redirectUri;

  const complete = useCallback(async (code: string, state: string) => {
    setPhase("completing");
    setError(null);
    try {
      const res = await fetch("/api/auth/zosma/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `complete returned ${res.status}`);
      const result = body as ZosmaAuthResult;
      setResult(result);
      setPhase("done");
      onCompletedRef.current?.(result);
    } catch (err) {
      setError(safeError(err));
      setPhase("error");
    }
  }, []);

  // ── Tauri deep-link listener ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function listen() {
      const win = window as Window & { __TAURI_INTERNALS__?: unknown };
      if (!win.__TAURI_INTERNALS__) return;
      try {
        const mod = await import("@tauri-apps/plugin-deep-link");
        if (cancelled) return;
        unlistenRef.current = await mod.onOpenUrl((urls: string[]) => {
          if (deliveredRef.current) return;
          for (const url of urls) {
            const parsed = parseCallbackUrl(url);
            if (parsed?.state) {
              deliveredRef.current = true;
              void complete(parsed.code, parsed.state);
              return;
            }
          }
        });
      } catch {
        // Browser / plugin unavailable — manual paste still works.
      }
    }
    void listen();
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [complete]);

  const start = useCallback(async () => {
    setPhase("starting");
    setError(null);
    deliveredRef.current = false;
    try {
      const redirectUri =
        redirectUriRef.current ??
        (typeof window !== "undefined"
          ? `${window.location.origin}/api/auth/zosma/callback`
          : undefined);
      const res = await fetch("/api/auth/zosma/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(redirectUri ? { redirectUri } : {}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `start returned ${res.status}`);
      await openInSystemBrowser(body.authorizationUrl);
      setPhase("waiting_browser");
    } catch (err) {
      setError(safeError(err));
      setPhase("error");
    }
  }, []);

  /**
   * Universal fallback: paste the full redirect URL from the address bar.
   * Requires both code and state (state is checked server-side).
   */
  const submitManual = useCallback(
    async (raw: string) => {
      const parsed = parseCallbackUrl(raw);
      if (!parsed || !parsed.state) {
        setError("That doesn't look like a sign-in result URL — it needs both code and state. Paste the full address-bar URL.");
        setPhase("error");
        return;
      }
      deliveredRef.current = true;
      await complete(parsed.code, parsed.state);
    },
    [complete],
  );

  const cancel = useCallback(async () => {
    try {
      await fetch("/api/auth/zosma/cancel", { method: "POST" });
    } catch {
      // Best-effort — the pending tx expires in 10 minutes anyway.
    }
    setPhase("idle");
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  return { phase, error, result, start, cancel, reset, complete, submitManual };
}
```

- [ ] **Step 5: Watch it pass**

Run: `cd web && node --experimental-strip-types --test hooks/useZosmaAuth.test.mjs`
Expected: 11 pass, 0 fail.

- [ ] **Step 6: Typecheck + full web suite**

Run: `cd web && npx tsc --noEmit && pnpm test`
Expected: clean; all 700+ tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/hooks/useZosmaAuth.ts web/hooks/useZosmaAuth.test.mjs web/package.json web/pnpm-lock.yaml
git commit -m "feat(zosma-auth): fetch-based useZosmaAuth hook with manual-paste fallback"
```

---

### Task 11: `ZosmaAuthCard` UI + ModelsConfig integration

**Files:**
- Create: `web/components/ZosmaAuthCard.tsx`
- Create: `web/components/ZosmaAuthCard.test.mjs`
- Modify: `web/components/ModelsConfig.tsx`

- [ ] **Step 1: Write the failing test**

`web/components/ZosmaAuthCard.test.mjs` (server-side render smoke — `useEffect` does not run during `renderToString`, so no fetch happens and no mocking is needed). Note the `jsx` jiti option — required to parse the .tsx component (app idiom, see ChatInput.test.mjs):

```js
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ZosmaAuthCard } = await jiti.import("./ZosmaAuthCard.tsx");

test("ZosmaAuthCard renders the idle sign-in state", () => {
  const html = renderToString(React.createElement(ZosmaAuthCard, { onRefresh: () => {} }));
  assert.match(html, /Zosma Router/);
  assert.match(html, /Sign in with Zosma/);
});

test("ZosmaAuthCard renders a success notice with the model count", () => {
  const html = renderToString(
    React.createElement(ZosmaAuthCard, {
      onRefresh: () => {},
      notice: { status: "success", models: 3 },
    }),
  );
  assert.match(html, /Signed in/);
  assert.match(html, /3 models/);
});

test("ZosmaAuthCard renders an error notice message", () => {
  const html = renderToString(
    React.createElement(ZosmaAuthCard, {
      onRefresh: () => {},
      notice: { status: "error", message: "Sign-in session expired." },
    }),
  );
  assert.match(html, /Sign-in session expired\./);
});
```

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test components/ZosmaAuthCard.test.mjs`
Expected: FAIL — cannot find module `./ZosmaAuthCard.tsx`.

- [ ] **Step 3: Implement**

`web/components/ZosmaAuthCard.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useZosmaAuth } from "@/hooks/useZosmaAuth";

/** One-shot landing notice from the callback redirect (?zosma=success|error). */
export interface ZosmaNotice {
  status: "success" | "error";
  message?: string;
  models?: number;
}

interface ZosmaStatus {
  configured: boolean;
  pending: boolean;
  modelCount: number;
  baseUrl: string | null;
  authBaseUrl: string;
  routerBaseUrl: string;
}

interface Props {
  onRefresh: () => void;
  /** One-shot landing notice (Task 11B wires it from the URL params). */
  notice?: ZosmaNotice | null;
}

// App styling idiom: inline styles over globals.css design tokens
// (ModelsConfig uses zero className; shadcn/Tailwind token utilities are
// not defined in this app — do not add them).
const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-subtle)",
  padding: 14,
};
const primaryBtnStyle: CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtnStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: 12,
  cursor: "pointer",
};
const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontSize: 12,
  boxSizing: "border-box",
};

function Spinner() {
  // Same inline-SVG + `animate-spin` idiom as AppShell's loading spinners.
  return (
    <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Zosma Router sign-in card for the Models panel.
 *
 * States:
 *  - not configured → "Sign in with Zosma"
 *  - waiting_browser → spinner + cancel + manual-paste fallback
 *  - completing → spinner
 *  - configured (no pending flow) → model count + Refresh / Disconnect
 *  - landing notice → one-shot success/error line from the callback redirect
 */
export function ZosmaAuthCard({ onRefresh, notice: noticeProp }: Props) {
  const [status, setStatus] = useState<ZosmaStatus | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedAuthUrl, setAdvancedAuthUrl] = useState("");
  const [advancedRouterUrl, setAdvancedRouterUrl] = useState("");
  const [savedConfig, setSavedConfig] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [landingNotice, setLandingNotice] = useState<ZosmaNotice | null>(noticeProp ?? null);
  const { phase, error, start, cancel, reset, submitManual } = useZosmaAuth({
    onCompleted: () => onRefresh(),
  });

  const effectivePhase = landingNotice?.status === "error" && phase === "idle" ? "error" : phase;
  const shownError =
    error ??
    (effectivePhase === "error"
      ? landingNotice?.message ?? "Sign-in failed. Please try again."
      : null);
  const successText =
    landingNotice?.status === "success"
      ? landingNotice.models
        ? `Signed in — ${landingNotice.models} models available.`
        : "Signed in — Zosma Router configured."
      : null;

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/zosma/status");
      if (res.ok) setStatus((await res.json()) as ZosmaStatus);
    } catch {
      // Non-fatal — the card falls back to flow state.
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, phase]);

  const configured = status?.configured ?? false;
  const working = phase === "starting" || phase === "completing";

  const saveConfig = async () => {
    setSavedConfig(false);
    const res = await fetch("/api/auth/zosma/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authBaseUrl: advancedAuthUrl || status?.authBaseUrl,
        routerBaseUrl: advancedRouterUrl || status?.routerBaseUrl,
      }),
    });
    if (res.ok) {
      setSavedConfig(true);
      void loadStatus();
    }
  };

  const disconnect = async () => {
    await fetch("/api/auth/zosma/disconnect", { method: "POST" });
    reset();
    void loadStatus();
    onRefresh();
  };

  const refreshModels = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/auth/zosma/refresh", { method: "POST" });
    } finally {
      setRefreshing(false);
    }
    onRefresh();
    void loadStatus();
  };

  const saveApiKey = async () => {
    const res = await fetch("/api/auth/zosma/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKeyInput }),
    });
    if (res.ok) {
      setApiKeyInput("");
      void loadStatus();
      onRefresh();
    }
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Zosma Router</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {configured
              ? `${status?.modelCount ?? 0} models via ${status?.baseUrl}`
              : "Sign in to route models through your Zosma account"}
          </div>
        </div>
        {configured && phase === "idle" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={refreshing}
              style={{
                ...ghostBtnStyle,
                opacity: refreshing ? 0.5 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {refreshing && <Spinner />}
              Refresh
            </button>
            <button type="button" onClick={() => void disconnect()} style={ghostBtnStyle}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      {shownError && effectivePhase === "error" && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--state-error)" }}>{shownError}</div>
      )}

      {!shownError && successText && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--state-success)" }}>{successText}</div>
      )}

      {phase === "waiting_browser" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text)" }}>
            <Spinner />
            Complete sign-in in your browser
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => void cancel()} style={ghostBtnStyle}>
              Cancel
            </button>
            <details style={{ flex: 1 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
                Trouble? Paste the result URL
              </summary>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  type="text"
                  value={pastedUrl}
                  onChange={(e) => setPastedUrl(e.target.value)}
                  placeholder="http://…/callback?code=…&state=…"
                  style={fieldStyle}
                />
                <button
                  type="button"
                  onClick={() => void submitManual(pastedUrl)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Submit
                </button>
              </div>
            </details>
          </div>
        </div>
      )}

      {working && (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <Spinner />
          {phase === "starting" ? "Opening sign-in..." : "Loading your models..."}
        </div>
      )}

      {(phase === "idle" || phase === "error") && (
        <button
          type="button"
          onClick={() => {
            setLandingNotice(null);
            void start();
          }}
          style={{
            ...primaryBtnStyle,
            background: configured ? "transparent" : "var(--accent)",
            color: configured ? "var(--text)" : "#fff",
            border: configured ? "1px solid var(--border)" : "none",
            fontWeight: configured ? 500 : 600,
          }}
        >
          {configured ? "Re-sign in (rotate key)" : "Sign in with Zosma"}
        </button>
      )}

      <details
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        style={{ marginTop: 12 }}
      >
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
          Self-hosted router
        </summary>
        {showAdvanced && status && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="text"
              value={advancedAuthUrl || status.authBaseUrl}
              onChange={(e) => setAdvancedAuthUrl(e.target.value)}
              placeholder="https://router.example.com"
              style={fieldStyle}
            />
            <input
              type="text"
              value={advancedRouterUrl || status.routerBaseUrl}
              onChange={(e) => setAdvancedRouterUrl(e.target.value)}
              placeholder="https://router.example.com/v1"
              style={fieldStyle}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => void saveConfig()}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              {savedConfig && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Saved</span>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Paste router key (sk-…)"
                style={fieldStyle}
              />
              <button
                type="button"
                onClick={() => void saveApiKey()}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Use key
              </button>
            </div>
          </div>
        )}
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test components/ZosmaAuthCard.test.mjs`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Integrate into ModelsConfig**

In `web/components/ModelsConfig.tsx`:

1. Add the import with the other component imports at the top:

```tsx
import { ZosmaAuthCard } from "@/components/ZosmaAuthCard";
```

2. Find the custom-providers section anchor (around line 2163):

```tsx
              {/* Divider before custom providers, only when there are active managed providers */}
```

3. Insert the card **above** that comment, inside the same container:

```tsx
              <ZosmaAuthCard onRefresh={refreshAuthProviders} />

              {/* Divider before custom providers, only when there are active managed providers */}
```

(`refreshAuthProviders` is the existing refresh callback already passed to `OAuthDetail`/`ApiKeyDetail` — after a successful sign-in the Models panel re-reads providers, so the `zosma-router` provider and its models appear in the picker.)

- [ ] **Step 6: Typecheck + full web suite**

Run: `cd web && npx tsc --noEmit && pnpm test`
Expected: clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/components/ZosmaAuthCard.tsx web/components/ZosmaAuthCard.test.mjs web/components/ModelsConfig.tsx
git commit -m "feat(zosma-auth): ZosmaAuthCard in the Models panel"
```

---

### Task 11B: Landing notice wiring (`?zosma=...` → Models panel)

**Files:**
- Modify: `web/lib/initial-navigation.ts`
- Modify: `web/lib/initial-navigation.test.mjs`
- Modify: `web/components/AppShell.tsx`
- Modify: `web/components/SettingsShell.tsx`
- Modify: `web/components/SettingsContent.tsx`
- Modify: `web/components/ModelsConfig.tsx`

The callback route (Task 9) bounces the browser to `/?zosma=success|error&...`. The app is a single page (`/` → `AppShell`); the Models panel is the settings modal (`SettingsShell` → `ModelsContent` → `ModelsConfig`). This task plumbs the result param so landing opens the Models panel and the card shows its one-shot notice.

- [ ] **Step 1: Write the failing tests (parse)**

The existing `web/lib/initial-navigation.test.mjs` asserts **whole-object** `assert.deepEqual(result, { requestedCwd, sessionId })` in four tests — adding `zosmaNotice` to the return value breaks them, so update them in the same step: append `zosmaNotice: null,` to each of the four expected objects. Then append:

```js
test("parses a zosma success notice with model count", async () => {
  const { getInitialNavigation } = await loadSubject();
  assert.deepEqual(
    getInitialNavigation(new URLSearchParams("zosma=success&models=3")),
    { requestedCwd: null, sessionId: null, zosmaNotice: { status: "success", models: 3 } },
  );
});

test("parses a zosma error notice with an encoded message", async () => {
  const { getInitialNavigation } = await loadSubject();
  const result = getInitialNavigation(
    new URLSearchParams(`zosma=error&message=${encodeURIComponent("state mismatch — possible CSRF")}`),
  );
  assert.equal(result.zosmaNotice.status, "error");
  assert.equal(result.zosmaNotice.message, "state mismatch — possible CSRF");
});

test("ignores an absent or invalid zosma param", async () => {
  const { getInitialNavigation } = await loadSubject();
  assert.equal(getInitialNavigation(new URLSearchParams("")).zosmaNotice, null);
  assert.equal(getInitialNavigation(new URLSearchParams("zosma=weird")).zosmaNotice, null);
});
```

(Note: `message: undefined` and `models: undefined` are omitted by the implementation when absent; `assert.deepStrictEqual` treats explicit undefined properties as absent, so the expected objects above are exact.)

- [ ] **Step 2: Watch it fail**

Run: `cd web && node --experimental-strip-types --test lib/initial-navigation.test.mjs`
Expected: the 4 updated existing tests FAIL (missing `zosmaNotice: null`) and the 3 new tests FAIL (undefined field).

- [ ] **Step 3: Implement the parse**

Replace the contents of `web/lib/initial-navigation.ts`:

```ts
export interface ZosmaUrlNotice {
  status: "success" | "error";
  message?: string;
  models?: number;
}

export interface InitialNavigation {
  requestedCwd: string | null;
  sessionId: string | null;
  /** Landing result of the Zosma Router sign-in callback (Task 9). */
  zosmaNotice: ZosmaUrlNotice | null;
}

export function getInitialNavigation(searchParams: Pick<URLSearchParams, "get">): InitialNavigation {
  const requestedCwd = searchParams.get("cwd")?.trim() || null;

  const zosma = searchParams.get("zosma");
  const zosmaNotice: ZosmaUrlNotice | null =
    zosma === "success" || zosma === "error"
      ? {
          status: zosma,
          message: searchParams.get("message") || undefined,
          models: Number.parseInt(searchParams.get("models") ?? "", 10) || undefined,
        }
      : null;

  return {
    requestedCwd,
    sessionId: requestedCwd ? null : searchParams.get("session"),
    zosmaNotice,
  };
}
```

- [ ] **Step 4: Watch it pass**

Run: `cd web && node --experimental-strip-types --test lib/initial-navigation.test.mjs`
Expected: all pass (4 updated + 3 new).

- [ ] **Step 5: Plumb the prop (AppShell → SettingsShell → ModelsContent → ModelsConfig → card)**

5a. `web/components/AppShell.tsx`:

- `AppShell` already holds `const [initialNavigation] = useState(() => getInitialNavigation(searchParams));` and the modal state `settingsOpen` / `settingsInitialCategory`.
- Add a one-shot opener **after** the line where `projectTrustCwd` is available (it gates the modal render — the modal only renders when a trusted cwd exists, so the opener must wait for it):

```tsx
const [zosmaNotice] = useState(initialNavigation.zosmaNotice);
const zosmaNoticeHandled = useRef(false);
useEffect(() => {
  if (!zosmaNotice || zosmaNoticeHandled.current || !projectTrustCwd) return;
  zosmaNoticeHandled.current = true;
  setSettingsInitialCategory("models");
  setSettingsOpen(true);
}, [zosmaNotice, projectTrustCwd]);
```

(`useRef` is already imported in AppShell; if not, add it to the react import.)

- Add the notice to the modal render:

```tsx
<SettingsShell
  onClose={() => setSettingsOpen(false)}
  cwd={projectTrustCwd}
  sessionId={selectedSession?.id ?? null}
  onReloaded={() => setSessionKey((k) => k + 1)}
  onModelsRefresh={() => setModelsRefreshKey((k) => k + 1)}
  initialCategory={settingsInitialCategory}
  zosmaNotice={zosmaNotice}
/>
```

5b. `web/components/SettingsShell.tsx`: import the type from `./ZosmaAuthCard` and extend `SettingsShellProps`:

```tsx
interface SettingsShellProps {
  // ...existing fields (onClose, cwd, sessionId, onReloaded?, onModelsRefresh?, initialCategory?)...
  zosmaNotice?: ZosmaNotice | null;
}
```

destructure `zosmaNotice` in the component signature, and in the existing content switch make the models branch:

```tsx
const modelsPanel = <ModelsContent onClose={handleClose} zosmaNotice={zosmaNotice} />;
```

5c. `web/components/SettingsContent.tsx`:

```tsx
export function ModelsContent({
  onClose,
  zosmaNotice,
}: {
  onClose: () => void;
  zosmaNotice?: ZosmaNotice | null;
}) {
  return (
    <EmbeddedWrapper>
      <ModelsConfig onClose={onClose} zosmaNotice={zosmaNotice} />
    </EmbeddedWrapper>
  );
}
```

5d. `web/components/ModelsConfig.tsx`: extend the signature (line ~1894) — the body is unchanged:

```tsx
export function ModelsConfig({
  onClose,
  zosmaNotice,
}: {
  onClose: () => void;
  zosmaNotice?: ZosmaNotice | null;
}) {
  // ...existing body; only the card line below changes...
}
```

and update the `<ZosmaAuthCard ... />` line added in Task 11 Step 5:

```tsx
<ZosmaAuthCard onRefresh={refreshAuthProviders} notice={zosmaNotice} />
```

- [ ] **Step 6: Typecheck + full web suite**

Run: `cd web && npx tsc --noEmit && pnpm test`
Expected: clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/lib/initial-navigation.ts web/lib/initial-navigation.test.mjs web/components/AppShell.tsx web/components/SettingsShell.tsx web/components/SettingsContent.tsx web/components/ModelsConfig.tsx
git commit -m "feat(zosma-auth): open Models panel from ?zosma=... landing param"
```

---

### Task 12: Tauri desktop wiring (deep link + open_url)

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

This restores the desktop deep-link path (`ai.zosma.cowork://oauth/callback`) and the system-browser opener the hook calls via `__TAURI_INTERNALS__.invoke("open_url", ...)`.

- [ ] **Step 1: Register the deep-link scheme in tauri.conf.json**

`src-tauri/tauri.conf.json` is minified single-line JSON and already has a top-level `plugins` object (currently holding `updater`). Merge a `deep-link` key **into** that object — do not add a second `plugins` block. Result:

```json
"plugins": { "updater": { ...existing... }, "deep-link": { "desktop": { "schemes": ["ai.zosma.cowork"] } } }
```

Verify the file still parses: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8'))"` (must not throw).

- [ ] **Step 2: Add the capability**

In `src-tauri/capabilities/default.json`, add `"deep-link:default"` to the `permissions` array.

- [ ] **Step 3: Add the Rust plugin dependency**

In `src-tauri/Cargo.toml` `[dependencies]`, add (match the installed `tauri` major version — 2.x):

```toml
tauri-plugin-deep-link = "2"
```

- [ ] **Step 4: Register the plugin and the open_url command in lib.rs**

4a. Import and register the plugin in the builder chain (next to the other `.plugin(...)` calls):

```rust
.plugin(tauri_plugin_deep_link::init())
```

4b. Add the command — ported from `main:src-tauri/src/lib.rs:2116-2158` (the Windows `raw_arg` quoting is load-bearing for OAuth URLs containing `&`):

```rust
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    // Per-platform browser opener. The Windows path MUST keep the URL wrapped
    // in double quotes via raw_arg: cmd.exe treats `&` as a command separator
    // and would otherwise truncate the URL at the first `&`.
    #[cfg(target_os = "windows")]
    let result = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/c", "start", ""])
            .raw_arg(format!("\"{url}\""))
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .status()
    };
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).status();

    let st = result.map_err(|e| format!("open: {e}"))?;
    if !st.success() {
        return Err(format!("exit: {}", st));
    }
    Ok(())
}
```

4c. The thin shell currently has **no** Tauri commands — add the handler to the builder chain, immediately before `.run(tauri::generate_context!())`:

```rust
.invoke_handler(tauri::generate_handler![open_url])
```

- [ ] **Step 5: Verify the shell compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat(tauri): deep-link scheme + open_url for Zosma Router sign-in"
```

---

### Task 13: End-to-end verification + polish

**Files:** none new (verification + at most small fixes).

- [ ] **Step 1: Full green gate**

```bash
cd web && npx tsc --noEmit && pnpm test && pnpm lint
cd src-tauri && cargo clippy -- -D warnings && cargo fmt --check
```

Expected: all clean. (If lint trips on a pattern — e.g. the `_removed` destructuring rename in `restoreProvider` — fix per lint output.)

- [ ] **Step 2: Live sign-in (human step)**

```bash
cd web && pnpm dev   # http://127.0.0.1:30141
```

1. Open http://127.0.0.1:30141, go to the Models panel.
2. Click **Sign in with Zosma** → browser opens the router.zosma.ai sign-in.
3. Complete Google sign-in. Per the Task 0 finding: (a) loopback redirect lands on `/` and the Models panel opens with a success banner (Task 11B), (b) deep link requires the desktop app, (c) otherwise paste the result URL into "Trouble? Paste the result URL".
4. Verify: card shows model count + baseUrl; `zosma-router` provider with the new models appears in the picker below; `~/.pi/agent/models.json` has the updated entry (`apiKey` = fresh key, `baseUrl` = `https://router.zosma.ai/v1`).

```bash
python3 -c "import json; d=json.load(open('/home/arjun/.pi/agent/models.json')); p=d['providers']['zosma-router']; print(p['baseUrl'], len(p['models']), p['apiKey'][:6])"
```

- [ ] **Step 3: Model selection journey ("the model thing set in pi")**

In the Models panel, pick a `zosma-router` model from the new entry and confirm the selection persists and a chat turn runs through the router (pick the cheapest model; send "ping"). This is the existing picker → pi state path, verified end-to-end with the new provider present.

- [ ] **Step 4: Desktop shell smoke**

```bash
pnpm tauri dev   # from repo root (dev server must be stopped first — port 30141)
```

1. Window opens against 30141.
2. Models panel → **Sign in with Zosma** → system browser opens (not a webview tab).
3. Complete sign-in → deep link `ai.zosma.cowork://oauth/callback` fires → card transitions to done, models appear.
4. **Disconnect** → confirm `zosma-router` disappears from the picker and models.json; re-sign in to restore.

- [ ] **Step 5: Browser-only regression**

With the dev server running, open the app in a plain browser (no Tauri): sign-in must reach the manual-paste path without console errors (no `@tauri-apps/plugin-deep-link` import crash).

- [ ] **Step 6: Push + PR**

```bash
git push arjun-fork feat/zosma-router-auth-web
gh pr create --repo zosmaai/zosma-cowork --base main --head arjun-zosma:feat/zosma-router-auth-web \
  --title "feat(zosma-auth): Zosma Router sign-in journey on the web/ stack" \
  --body-file /tmp/pr-body-zosma-auth.md
```

PR body (draft at `/tmp/pr-body-zosma-auth.md` before pushing): what (journey restored on the new stack), architecture summary (server-side PKCE in `web/lib/zosma-auth`, three callback paths, models.json atomicity), the provider-id decision (`zosma-router`, matches live state), the Task 0 finding on auth-server redirect behavior, verification evidence (test counts, live sign-in, desktop deep link, model turn).

---

## Self-Review Notes (plan author)

1. **Spec coverage:** auth journey (login → key → models in pi → selectable model) = Tasks 1–13. All old-journey features mapped: PKCE start (T5), complete+verify+rollback (T6), disconnect (T7), cancel (T7), refresh (T7), router setup (T8 config route + card advanced section), desktop deep link (T12), manual fallback (T10/T11).
2. **Placeholder scan:** no TBDs; every code step has full code. The two "probe first" steps (T0 auth server behavior, T6 `ModelRuntime` shape) are explicit discovery steps with decision tables, not deferred implementation.
3. **Type consistency:** `ZosmaAuthDeps.getAvailable(providerId) => Promise<Array<{id, provider}>>` used identically in T5–T9; `ZOSMA_PROVIDER_ID` ("zosma-router") is a single source in `models-json.ts`; `CompleteAuthResult` shape identical between lib (T6), complete route (T9), callback (T9), and hook (T10).
4. **Known risk:** `runtime.getProvider(id).models` field shape — de-risked by the live probe in Task 6 Step 1 before implementation; adjust `productionDeps` if the probe disagrees.
5. **Review pass (plan-document-reviewer, 2026-08-26):** issues found and fixed — (1) callback now bounces to `/` with `?zosma=...` and Task 11B wires AppShell → SettingsShell → ModelsContent → ModelsConfig so the Models panel opens on landing (no `/models` route exists); (2) `lucide-react` dropped entirely — card uses inline SVG + `animate-spin` (AppShell idiom), so the only new npm dep is `@tauri-apps/plugin-deep-link`; (3) card restyled to the app's inline-style + globals.css token idiom (no shadcn token utilities exist in this app); (4) route-test helper import corrected to `../test-helper.mjs`; (5) Tauri deep-link merges into the existing `plugins` object (minified single-line JSON); (6) `invoke_handler` added to the thin shell (it had no commands); (7) test counts corrected (54 lib / 11 hook / 3 card); (8) existing `initial-navigation` whole-object `deepEqual` expectations updated for the new field; (9) callback route uses a plain 302 `Response` (not `NextResponse`) so unit tests run under plain node + jiti without `next/server` runtime concerns. (10) Task 0 live probe recorded in-plan: production `router.zosma.ai` is a LiteLLM proxy with **no** `/v1/cowork/*` endpoints (the dev router — `localhost:3000` per this machine's `zosma-router-config.json` — has them); added the key-paste degraded path (`authenticateWithKey` lib fn + `api-key` route + card field) that works against production today; shared `saveCatalogAndVerify` save→reload→verify→rollback tail extracted in Task 6 so all three flows (PKCE complete / refresh / api-key) use one rollback guarantee.
