# Unified Installer Phase 1: Production Server Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and smoke-test self-contained Linux/macOS Cowork server archives with one production supervisor shared by future local and Docker installation modes.

**Architecture:** Keep the existing Next standalone packager and the daemon's Node type-stripping runtime. Add one production supervisor that launches both with the bundled Node executable, plus one small authenticated health helper. A release packager uses `pnpm deploy` for portable daemon dependencies, verifies an official Node distribution, assembles the fixed archive tree, and proves the extracted artifact with no system Node, pnpm, Rust, or Git on `PATH`.

**Tech Stack:** Node.js 24 runtime, JavaScript ESM, TypeScript daemon sources, Next.js standalone output, pnpm 10 deploy, Node test runner, native `tar`, GitHub Actions.

**Roadmap:** [`docs/superpowers/roadmaps/2026-09-12-unified-installer-roadmap.md`](../roadmaps/2026-09-12-unified-installer-roadmap.md)

**Phase:** Phase 1: Production Supervisor and Local Server Artifacts

---

## Scope Guard

This plan intentionally stops before Docker, GHCR, `install.sh`, the `zosma` lifecycle CLI, user services, release uploads, or public documentation. It may add non-publishing CI matrix jobs, but it must not change `.github/workflows/release.yml` or any desktop release trigger.

Before executing, ensure nothing answers on `127.0.0.1:30141`; `apps/web/scripts/package-server.mjs` correctly refuses to package while a development server is running.

### Task 1: Harden the daemon's production supervision contract

**Files:**
- Modify: `apps/daemon/src/server.test.mjs`
- Modify: `apps/daemon/src/server.ts`
- Modify: `apps/daemon/src/git/rpc.ts`
- Modify: `apps/daemon/src/index.test.mjs`
- Modify: `apps/daemon/src/index.ts`
- Modify: `apps/daemon/src/orchestrator.test.mjs`

- [ ] **Step 1: Run the existing daemon tests before changing behavior**

Run:

```bash
pnpm -C apps/daemon test
pnpm -C apps/daemon typecheck
```

Expected: both commands pass.

- [ ] **Step 2: Write failing tests for authenticated daemon health**

Replace the current unauthenticated health assertions in `apps/daemon/src/server.test.mjs` with separate authorization and readiness behaviors:

```js
test("health rejects requests without the supervisor token", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    const res = await req(port, { method: "GET", path: "/health" });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { ok: false, error: "unauthorized" });
  } finally {
    await server.stop();
  }
});

test("authorized health reports starting before readiness", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    const res = await req(port, {
      method: "GET",
      path: "/health",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { status: "starting" });
  } finally {
    await server.stop();
  }
});

test("authorized health reports ready after readiness", async () => {
  const server = createDaemonServer({ token: TOKEN });
  const { port } = await server.start();
  try {
    server.setReady("ready");
    const res = await req(port, {
      method: "GET",
      path: "/health",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ready" });
  } finally {
    await server.stop();
  }
});
```

Update the fixed-port test and `apps/daemon/src/orchestrator.test.mjs` helper to send `Authorization: Bearer test-token`. Do not weaken IPC authentication.

- [ ] **Step 3: Write failing tests for configurable state and missing Git**

Add to `apps/daemon/src/index.test.mjs`:

```js
test("resolveDataDir prefers ZOSMA_DAEMON_DATA_DIR", () => {
  assert.equal(
    resolveDataDir({ ZOSMA_DAEMON_DATA_DIR: "/tmp/zosma-state" }),
    "/tmp/zosma-state",
  );
});

test("run omits daemon token material from logs", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "zosma-daemon-redact-"));
  const lines = [];
  let handle;
  try {
    handle = await run({
      dataDir,
      env: { ZOSMA_DAEMON_TOKEN: "tok123456789" },
      logger: createLogger({ sink: (line) => lines.push(line) }),
    });
    assert.doesNotMatch(lines.join("\n"), /tok123|tok123456789/);
  } finally {
    if (handle) await stopHandle(handle);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
```

Add to `apps/daemon/src/server.test.mjs`:

```js
test("Git operations report git_unavailable when Git is absent", async () => {
  const server = createDaemonServer({ token: TOKEN, gitAvailable: false });
  const { port } = await server.start();
  try {
    server.setReady("ready");
    const res = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
    }, { type: "git:status", cwd: "/tmp" });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "git_unavailable");
  } finally {
    await server.stop();
  }
});

test("cwd validation remains available when Git is absent", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "zosma-no-git-"));
  const server = createDaemonServer({ token: TOKEN, gitAvailable: false });
  const { port } = await server.start();
  try {
    const res = await req(port, {
      method: "POST",
      path: "/ipc",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
    }, { type: "cwd:validate", cwd });
    assert.equal(res.status, 200);
  } finally {
    await server.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

Add `mkdtempSync`/`rmSync` from `node:fs`, `tmpdir` from `node:os`, and `join` from `node:path` to `apps/daemon/src/server.test.mjs`. Add `resolveDataDir` to the existing import from `./index.ts` in `index.test.mjs`.

- [ ] **Step 4: Run the focused tests and verify the expected failures**

Run:

```bash
pnpm -C apps/daemon test
```

Expected: failures show that `/health` is currently public, `resolveDataDir` is missing, and `gitAvailable: false` is not honored.

- [ ] **Step 5: Implement the smallest shared daemon guards**

In `apps/daemon/src/git/rpc.ts`, export the operations that truly require a Git executable; deliberately exclude `cwd:validate`:

```ts
export const GIT_REQUIRED_RPC_OPS = [
  "git:status",
  "git:diff",
  "worktrees:list",
  "worktrees:create",
  "worktrees:remove",
] as const;
```

In `apps/daemon/src/server.ts`:

```ts
import { spawnSync } from "node:child_process";
import {
  GIT_REQUIRED_RPC_OPS,
  GIT_RPC_OPS,
  handleGitRpc,
  type GitRpcRequest,
} from "./git/rpc.ts";

export interface DaemonServerOptions {
  token: string;
  gitAvailable?: boolean;
  // keep every existing option unchanged
}

function detectGit(): boolean {
  try {
    return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}
```

Resolve `const gitAvailable = options.gitAvailable ?? detectGit()` once inside `createDaemonServer`. Before calling `handleGitRpc`, return this stable response for required Git operations:

```ts
if (
  !gitAvailable
  && (GIT_REQUIRED_RPC_OPS as readonly string[]).includes(type)
) {
  return c.json({ ok: false, type, error: "git_unavailable" }, 503);
}
```

Protect `/health` with the existing constant-time `authHeld` helper:

```ts
app.get("/health", (c) => {
  if (!authHeld(c.req.header("authorization"), options.token)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  if (state === "ready") return c.json({ status: "ready" }, 200);
  if (state === "shutting-down") return c.json({ status: "shutting-down" }, 503);
  return c.json({ status: state }, 503);
});
```

In `apps/daemon/src/index.ts`, resolve the daemon's lock/token/session-mapping state from an explicit service environment and remove the `tokenHint` field from the startup log entirely:

```ts
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZOSMA_DAEMON_DATA_DIR || DATA_DIR;
}

export interface RunArgs {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  port?: number;
  exit?: (code: number) => void;
}

export async function run(args: RunArgs = {}): Promise<Daemon> {
  const logger = args.logger ?? createLogger();
  const env = args.env ?? process.env;
  const dataDir = args.dataDir ?? resolveDataDir(env);
  const token = resolveToken(dataDir, env);
  const pi = new PiAdapter({ storeDir: dataDir });
  const exit = args.exit ?? ((code: number) => void (process.exitCode = code));
  const handle = await startDaemon({
    token,
    dataDir,
    logger,
    piRpc: (request) => handlePiRpc(pi, request),
    piStream: (request, sink) => handlePiStream(pi, request, sink),
    port: args.port ?? resolvePort(env),
    exit,
  });
  if (!handle.acquired) {
    logger.error("already running");
    exit(3);
    return handle;
  }
  logger.info("zosma-daemon up", {
    port: handle.port,
    health: `http://127.0.0.1:${handle.port}/health`,
    ipc: `http://127.0.0.1:${handle.port}/ipc`,
  });
  return handle;
}
```

Do not log a full token, prefix, suffix, hash, or hint.

Do not alter Pi's separate `PI_CODING_AGENT_DIR` behavior.

- [ ] **Step 6: Run daemon tests and type checking**

Run:

```bash
pnpm -C apps/daemon test
pnpm -C apps/daemon typecheck
```

Expected: both pass with no warnings or leaked child processes.

- [ ] **Step 7: Commit the daemon contract**

```bash
git add apps/daemon/src/server.test.mjs apps/daemon/src/server.ts \
  apps/daemon/src/git/rpc.ts apps/daemon/src/index.test.mjs \
  apps/daemon/src/index.ts apps/daemon/src/orchestrator.test.mjs
git commit -m "feat: harden daemon supervision contract"
```

### Task 2: Report missing Git through the current user-facing web routes

**Files:**
- Create: `apps/web/lib/git-availability.ts`
- Create: `apps/web/lib/git-availability.test.mjs`
- Create: `apps/web/app/api/git/status/route.test.mjs`
- Modify: `apps/web/app/api/git/status/route.ts`
- Modify: `apps/web/app/api/git/diff/route.ts`
- Modify: `apps/web/app/api/worktrees/route.ts`

- [ ] **Step 1: Write failing Git-availability unit tests**

Create `apps/web/lib/git-availability.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { isGitAvailable } = await jiti.import("./git-availability.ts");

test("isGitAvailable returns true when git --version succeeds", () => {
  const calls = [];
  assert.equal(isGitAvailable((command, args) => {
    calls.push({ command, args });
    return { status: 0 };
  }), true);
  assert.deepEqual(calls, [{ command: "git", args: ["--version"] }]);
});

test("isGitAvailable returns false when Git cannot be spawned", () => {
  assert.equal(isGitAvailable(() => ({ status: null, error: { code: "ENOENT" } })), false);
});
```

- [ ] **Step 2: Write a failing route test for the current browser path**

Create `apps/web/app/api/git/status/route.test.mjs` using the route-test pattern from `apps/web/app/api/cwd/validate/route.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");

test("GET /api/git/status returns git_unavailable when Git is absent", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "zosma-web-no-git-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  allowFileRoot(cwd);
  const previous = process.env.PATH;
  process.env.PATH = path.join(os.tmpdir(), "zosma-no-git-path");
  try {
    const request = new NextRequest(`http://localhost/api/git/status?cwd=${encodeURIComponent(cwd)}`);
    const response = await GET(request);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "git_unavailable" });
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});
```

Keep Git detection dynamic rather than import-time cached so installing Git later does not require restarting Cowork and tests do not depend on module-cache ordering.

- [ ] **Step 3: Run the focused web tests and verify they fail**

Run:

```bash
pnpm -C apps/web exec node --experimental-strip-types --test \
  lib/git-availability.test.mjs app/api/git/status/route.test.mjs
```

Expected: FAIL because `git-availability.ts` is absent and the status route currently treats a missing Git executable as a non-repository result.

- [ ] **Step 4: Implement one cheap Git probe and guard all current Git routes**

Create `apps/web/lib/git-availability.ts`:

```ts
import { spawnSync } from "node:child_process";

type GitProbe = (command: string, args: string[]) => { status: number | null };

export function isGitAvailable(
  probe: GitProbe = (command, args) => spawnSync(command, args, { stdio: "ignore" }),
): boolean {
  try {
    return probe("git", ["--version"]).status === 0;
  } catch {
    return false;
  }
}
```

In each current route, import `isGitAvailable` and return the same stable response after request/path authorization but before invoking a Git helper:

```ts
if (!isGitAvailable()) {
  return NextResponse.json({ error: "git_unavailable" }, { status: 503 });
}
```

Apply it to:

- `apps/web/app/api/git/status/route.ts` before `getGitStatus`.
- `apps/web/app/api/git/diff/route.ts` before `getGitFileDiff`.
- `apps/web/app/api/worktrees/route.ts` in GET before `resolveProject`, in POST before `addWorktree`, and in DELETE before `removeWorktree`.

Do not guard `/api/cwd/validate`; choosing a normal directory must continue to work without Git.

- [ ] **Step 5: Run focused and full web tests**

Run:

```bash
pnpm -C apps/web exec node --experimental-strip-types --test \
  lib/git-availability.test.mjs app/api/git/status/route.test.mjs
pnpm -C apps/web test
pnpm -C apps/web typecheck
```

Expected: all pass. Existing non-repository behavior remains unchanged when Git is installed.

- [ ] **Step 6: Commit the user-facing Git degradation contract**

```bash
git add apps/web/lib/git-availability.ts apps/web/lib/git-availability.test.mjs \
  apps/web/app/api/git/status/route.test.mjs \
  apps/web/app/api/git/status/route.ts apps/web/app/api/git/diff/route.ts \
  apps/web/app/api/worktrees/route.ts
git commit -m "feat: report unavailable Git consistently"
```

### Task 3: Add the reusable authenticated web health check

**Files:**
- Create: `scripts/healthcheck.mjs`
- Create: `scripts/healthcheck.test.mjs`

- [ ] **Step 1: Write failing health-helper tests**

Create `scripts/healthcheck.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { checkWebHealth, webHealthRequest } from "./healthcheck.mjs";

test("webHealthRequest targets the loopback v1 health endpoint", () => {
  const request = webHealthRequest({ PORT: "40141" });
  assert.equal(request.url, "http://127.0.0.1:40141/api/v1/health");
  assert.deepEqual(request.headers, {});
});

test("webHealthRequest adds Basic authentication when configured", () => {
  const request = webHealthRequest({ PORT: "40141", PI_WEB_PASSWORD: "secret value" });
  assert.equal(
    request.headers.authorization,
    `Basic ${Buffer.from("pi:secret value").toString("base64")}`,
  );
});

test("checkWebHealth returns true only for a successful response", async () => {
  assert.equal(await checkWebHealth({ fetchFn: async () => ({ ok: true }) }), true);
  assert.equal(await checkWebHealth({ fetchFn: async () => ({ ok: false }) }), false);
  assert.equal(await checkWebHealth({ fetchFn: async () => { throw new Error("offline"); } }), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test scripts/healthcheck.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/healthcheck.mjs`.

- [ ] **Step 3: Implement the health helper**

Create `scripts/healthcheck.mjs`:

```js
#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function webHealthRequest(env = process.env) {
  const port = env.PORT ?? "30141";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error(`invalid PORT: ${port}`);
  }
  const headers = {};
  if (env.PI_WEB_PASSWORD) {
    headers.authorization = `Basic ${Buffer.from(`pi:${env.PI_WEB_PASSWORD}`).toString("base64")}`;
  }
  return {
    url: `http://127.0.0.1:${port}/api/v1/health`,
    headers,
  };
}

export async function checkWebHealth({ env = process.env, fetchFn = fetch } = {}) {
  try {
    const { url, headers } = webHealthRequest(env);
    return (await fetchFn(url, { headers })).ok;
  } catch {
    return false;
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  process.exitCode = (await checkWebHealth()) ? 0 : 1;
}
```

The helper reads the password from the environment; never accept it as a command-line flag.

- [ ] **Step 4: Run the helper tests and syntax check**

Run:

```bash
node --test scripts/healthcheck.test.mjs
node --check scripts/healthcheck.mjs
```

Expected: PASS and no syntax errors.

- [ ] **Step 5: Commit the health helper**

```bash
git add scripts/healthcheck.mjs scripts/healthcheck.test.mjs
git commit -m "feat: add authenticated server health check"
```

### Task 4: Add the production daemon/web supervisor

**Files:**
- Create: `scripts/run-server.mjs`
- Create: `scripts/run-server.test.mjs`

- [ ] **Step 1: Write failing supervisor behavior tests**

Create `scripts/run-server.test.mjs`. Use a tiny `EventEmitter` child fake rather than mocking Node modules globally:

```js
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { dirname } from "node:path";
import test from "node:test";
import { startSupervisor } from "./run-server.mjs";

class FakeChild extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.kills = [];
    this.exitCode = null;
  }
  kill(signal) {
    this.kills.push(signal);
    this.exitCode = 0;
    queueMicrotask(() => this.emit("exit", 0, signal));
    return true;
  }
}

function harness(overrides = {}) {
  const calls = [];
  const logs = [];
  const children = [];
  const spawnChild = (command, args, options) => {
    const child = new FakeChild(children.length === 0 ? "daemon" : "web");
    children.push(child);
    calls.push({ command, args, options });
    return child;
  };
  return {
    calls,
    logs,
    children,
    options: {
      rootDir: "/bundle",
      env: {
        ZOSMA_DAEMON_PORT: "64713",
        ZOSMA_DAEMON_TOKEN: "tok123456789",
        ZOSMA_DAEMON_DATA_DIR: "/state/daemon",
        PORT: "30141",
        PI_WEB_PASSWORD: "pwd987654321",
      },
      spawnChild,
      fetchFn: async () => ({ ok: true, status: 200 }),
      sleep: async () => {},
      log: (line) => logs.push(line),
      pathExists: () => true,
      ...overrides,
    },
  };
}

test("supervisor starts daemon before web with the bundled Node executable", async () => {
  const h = harness();
  const supervisor = await startSupervisor(h.options);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].command, process.execPath);
  assert.deepEqual(h.calls[0].args, [
    "--conditions=zosma-production",
    "--experimental-strip-types",
    "/bundle/daemon/src/index.ts",
  ]);
  assert.equal(h.calls[1].command, process.execPath);
  assert.deepEqual(h.calls[1].args, [
    "/bundle/web/dist-server/bin/pi-web.js",
    "--no-open",
    "--port", "30141",
    "--hostname", "127.0.0.1",
  ]);
  assert.equal(h.calls[0].options.env.PATH, dirname(process.execPath));
  assert.equal(h.calls[1].options.env.PATH, dirname(process.execPath));
  await supervisor.stop("SIGTERM");
  assert.deepEqual(h.children.map((child) => child.kills), [["SIGTERM"], ["SIGTERM"]]);
});

test("supervisor authenticates daemon and web readiness probes", async () => {
  const seen = [];
  const h = harness({
    fetchFn: async (url, options) => {
      seen.push({ url, options });
      return { ok: true, status: 200 };
    },
  });
  const supervisor = await startSupervisor(h.options);
  assert.equal(seen[0].url, "http://127.0.0.1:64713/health");
  assert.equal(seen[0].options.headers.authorization, "Bearer tok123456789");
  assert.equal(seen[1].url, "http://127.0.0.1:30141/api/v1/health");
  assert.equal(
    seen[1].options.headers.authorization,
    `Basic ${Buffer.from("pi:pwd987654321").toString("base64")}`,
  );
  await supervisor.stop("SIGTERM");
});

test("supervisor removes both secrets from diagnostics", async () => {
  const h = harness();
  const supervisor = await startSupervisor(h.options);
  assert.doesNotMatch(h.logs.join("\n"), /tok123|tok123456789|pwd987|pwd987654321/);
  await supervisor.stop("SIGTERM");
});

test("supervisor forwards SIGINT to both children", async () => {
  const h = harness();
  const supervisor = await startSupervisor(h.options);
  await supervisor.stop("SIGINT");
  assert.deepEqual(h.children.map((child) => child.kills), [["SIGINT"], ["SIGINT"]]);
});

test("supervisor stops the sibling after an unexpected child exit", async () => {
  const h = harness();
  const supervisor = await startSupervisor(h.options);
  h.children[1].emit("exit", 7, null);
  assert.equal(await supervisor.done, 7);
  assert.deepEqual(h.children[0].kills, ["SIGTERM"]);
});

test("supervisor aborts a stalled readiness request", async () => {
  const h = harness({
    fetchFn: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    healthTimeoutMs: 5,
  });
  await assert.rejects(startSupervisor(h.options), /daemon did not become ready/);
});

test("supervisor cleans up the daemon when web readiness times out", async () => {
  let probes = 0;
  const h = harness({
    fetchFn: async () => ({ ok: ++probes === 1, status: probes === 1 ? 200 : 503 }),
    healthTimeoutMs: 0,
  });
  await assert.rejects(startSupervisor(h.options), /web did not become ready/);
  assert.deepEqual(h.children[0].kills, ["SIGTERM"]);
  assert.deepEqual(h.children[1].kills, ["SIGTERM"]);
});
```

If the direct `healthTimeoutMs: 0` path performs no probe, use `healthTimeoutMs: 1` with the injected zero-delay `sleep`; do not add real-time sleeps to unit tests.

- [ ] **Step 2: Run the tests and verify the expected module failure**

Run:

```bash
node --test scripts/run-server.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/run-server.mjs`.

- [ ] **Step 3: Implement explicit production paths and environment**

Create `scripts/run-server.mjs` with this public shape:

```js
#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webHealthRequest } from "./healthcheck.mjs";

const DEFAULT_DAEMON_PORT = 64713;
const DEFAULT_WEB_PORT = 30141;
const DEFAULT_TIMEOUT_MS = 30_000;

function port(value, fallback, name) {
  const text = value ?? String(fallback);
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw new Error(`invalid ${name}: ${text}`);
  }
  return Number(text);
}

async function waitFor(url, headers, { fetchFn, sleep, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const response = await fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(Math.min(1_000, remainingMs)),
      });
      if (response.ok) return true;
    } catch {
      // Child has not bound yet.
    }
    if (Date.now() >= deadline) return false;
    await sleep(250);
  } while (true);
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

export async function startSupervisor({
  rootDir = join(dirname(fileURLToPath(import.meta.url)), ".."),
  env = process.env,
  spawnChild = spawn,
  fetchFn = fetch,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  log = (line) => process.stderr.write(`[server] ${line}\n`),
  pathExists = existsSync,
  healthTimeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const daemonPort = port(env.ZOSMA_DAEMON_PORT, DEFAULT_DAEMON_PORT, "ZOSMA_DAEMON_PORT");
  const webPort = port(env.PORT, DEFAULT_WEB_PORT, "PORT");
  const token = env.ZOSMA_DAEMON_TOKEN;
  const dataDir = env.ZOSMA_DAEMON_DATA_DIR;
  const childPath = [dirname(process.execPath), env.PATH].filter(Boolean).join(delimiter);
  if (!token) throw new Error("ZOSMA_DAEMON_TOKEN is required");
  if (!dataDir) throw new Error("ZOSMA_DAEMON_DATA_DIR is required");

  const daemonEntry = join(rootDir, "daemon", "src", "index.ts");
  const webEntry = join(rootDir, "web", "dist-server", "bin", "pi-web.js");
  for (const entry of [daemonEntry, webEntry]) {
    if (!pathExists(entry)) throw new Error(`runtime entry missing: ${entry}`);
  }

  const children = [];
  let stopping = false;
  let settleDone;
  const done = new Promise((resolveDone) => { settleDone = resolveDone; });

  const stop = async (signal = "SIGTERM", code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (child.exitCode === null) child.kill(signal);
    }
    await Promise.all(children.map((child) => waitForExit(child)));
    settleDone(code);
  };

  const watch = (name, child) => {
    child.once("exit", (code, signal) => {
      if (!stopping) {
        log(`${name} exited unexpectedly (${code ?? signal ?? "unknown"})`);
        void stop("SIGTERM", code && code > 0 ? code : 1);
      }
    });
  };

  const daemon = spawnChild(process.execPath, [
    "--conditions=zosma-production",
    "--experimental-strip-types",
    daemonEntry,
  ], {
    cwd: join(rootDir, "daemon"),
    env: {
      ...env,
      PATH: childPath,
      ZOSMA_DAEMON_PORT: String(daemonPort),
      ZOSMA_DAEMON_TOKEN: token,
      ZOSMA_DAEMON_DATA_DIR: dataDir,
    },
    stdio: "inherit",
  });
  children.push(daemon);
  watch("daemon", daemon);

  const daemonReady = await waitFor(
    `http://127.0.0.1:${daemonPort}/health`,
    { authorization: `Bearer ${token}` },
    { fetchFn, sleep, timeoutMs: healthTimeoutMs },
  );
  if (!daemonReady) {
    await stop();
    throw new Error("daemon did not become ready");
  }

  const hostname = env.PI_WEB_HOSTNAME || "127.0.0.1";
  const web = spawnChild(process.execPath, [
    webEntry,
    "--no-open",
    "--port", String(webPort),
    "--hostname", hostname,
  ], {
    cwd: join(rootDir, "web", "dist-server"),
    env: {
      ...env,
      PATH: childPath,
      PORT: String(webPort),
      PI_WEB_HOSTNAME: hostname,
      PI_WEB_NO_OPEN: "1",
      ZOSMA_DAEMON_URL: `http://127.0.0.1:${daemonPort}`,
      ZOSMA_DAEMON_PORT: String(daemonPort),
      ZOSMA_DAEMON_TOKEN: token,
    },
    stdio: "inherit",
  });
  children.push(web);
  watch("web", web);

  const webRequest = webHealthRequest({ ...env, PORT: String(webPort) });
  const webReady = await waitFor(webRequest.url, webRequest.headers, {
    fetchFn,
    sleep,
    timeoutMs: healthTimeoutMs,
  });
  if (!webReady) {
    await stop();
    throw new Error("web did not become ready");
  }

  log(`ready at http://${hostname}:${webPort}`);
  return { done, stop };
}
```

Then add the direct-entry wiring at the end of the same file:

```js
const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  try {
    const supervisor = await startSupervisor();
    const stop = (signal) => void supervisor.stop(signal, 0);
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
    process.exitCode = await supervisor.done;
  } catch (error) {
    process.stderr.write(`[server] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
```

Keep all child commands as structured argv with `shell: false` (the default). Prepending `dirname(process.execPath)` to child `PATH` lets npm-launched shebang executables find the bundled Node binary even when no system Node exists. Do not reuse a pre-existing daemon in production; the installed runtime owns both children as one unit.

- [ ] **Step 4: Run the supervisor tests and fix only contract mismatches**

Run:

```bash
node --test scripts/healthcheck.test.mjs scripts/run-server.test.mjs
node --check scripts/run-server.mjs
```

Expected: PASS. If a fake child exposes a missing Node `ChildProcess` field, add only that field to `FakeChild`; do not weaken the production branch.

- [ ] **Step 5: Commit the production supervisor**

```bash
git add scripts/run-server.mjs scripts/run-server.test.mjs
git commit -m "feat: add production Cowork supervisor"
```

### Task 5: Make the TypeScript daemon portable with `pnpm deploy`

**Files:**
- Create: `scripts/deploy-daemon.test.mjs`
- Modify: `apps/daemon/package.json`
- Modify: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.build.json`
- Modify: `apps/daemon/src/pi/adapter.ts`

- [ ] **Step 1: Write a failing portable-deploy test**

Create `scripts/deploy-daemon.test.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function walk(root) {
  const paths = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    paths.push(path);
    if (entry.isDirectory() && !entry.isSymbolicLink()) paths.push(...walk(path));
  }
  return paths;
}

test("pnpm deploy creates a portable production daemon", () => {
  const temp = mkdtempSync(join(tmpdir(), "zosma-daemon-deploy-"));
  const deployed = join(temp, "daemon");
  try {
    execFileSync("pnpm", ["-C", "packages/protocol", "build"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execFileSync("pnpm", [
      "--filter", "@zosma-cowork/daemon",
      "deploy", "--prod", "--legacy", deployed,
    ], { cwd: repoRoot, stdio: "pipe" });

    assert.equal(statSync(join(deployed, "bin", "zosma-daemon.js")).isFile(), true);
    assert.equal(statSync(join(deployed, "src", "index.ts")).isFile(), true);
    assert.equal(
      statSync(join(deployed, "node_modules", "@zosma-cowork", "protocol", "dist", "index.js")).isFile(),
      true,
    );
    assert.equal(walk(join(deployed, "src")).some((path) => /\.test\.(?:mjs|ts)$/.test(path)), false);
    const protocolSrc = join(deployed, "node_modules", "@zosma-cowork", "protocol", "src");
    assert.equal(walk(protocolSrc).some((path) => /\.test\.ts$/.test(path)), false);

    const deployedRoot = realpathSync(deployed);
    for (const path of walk(deployed)) {
      if (lstatSync(path).isSymbolicLink()) {
        const target = realpathSync(path);
        const fromRoot = relative(deployedRoot, target);
        assert.equal(
          fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)),
          true,
          `symlink escapes deployed tree: ${path} -> ${target}`,
        );
      }
    }

    execFileSync(process.execPath, [
      "--conditions=zosma-production",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      "import('./src/pi/adapter.ts').then(({ PiAdapter }) => { if (!PiAdapter) process.exit(1) })",
    ], { cwd: deployed, stdio: "pipe" });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
```

The containment check must reject both dangling links and valid links that resolve back into the live workspace.

- [ ] **Step 2: Run the test and verify it fails for the current package shape**

Run:

```bash
node --test scripts/deploy-daemon.test.mjs
```

Expected: FAIL because the daemon package currently omits its TypeScript source and the protocol package exposes `.ts` files from inside `node_modules`, which Node 24 refuses to type-strip.

- [ ] **Step 3: Define the runtime files and remove the monorepo-relative import**

In `apps/daemon/package.json`, replace the current `files` array with:

```json
"files": [
  "bin",
  "src",
  "!src/**/*.test.mjs"
]
```

In `packages/protocol/package.json`, change `build` to `tsc -p tsconfig.build.json`, add a production condition that selects compiled JavaScript, preserve source imports for workspace development, and ship compiled output plus non-test source declarations:

```json
"files": [
  "dist",
  "src",
  "!src/**/*.test.ts"
],
"exports": {
  ".": {
    "types": "./src/index.ts",
    "zosma-production": "./dist/index.js",
    "import": "./src/index.ts"
  },
  "./errors": {
    "types": "./src/errors.ts",
    "zosma-production": "./dist/errors.js",
    "import": "./src/errors.ts"
  },
  "./negotiation": {
    "types": "./src/negotiation.ts",
    "zosma-production": "./dist/negotiation.js",
    "import": "./src/negotiation.ts"
  }
},
"scripts": {
  "typecheck": "tsc --noEmit -p tsconfig.json",
  "test": "node --experimental-strip-types --test 'src/**/*.test.ts'",
  "build": "tsc -p tsconfig.build.json"
}
```

Create `packages/protocol/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "declaration": true,
    "declarationMap": false,
    "noEmit": false,
    "outDir": "dist",
    "rewriteRelativeImportExtensions": true,
    "rootDir": "src",
    "sourceMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```

In `apps/daemon/src/pi/adapter.ts`, replace both imports from `../../../../packages/protocol/src/index.ts` with imports from the already-declared production dependency:

```ts
import {
  CURRENT_VERSION,
  MINIMUM_VERSION,
  negotiateHandshake,
  normalizeAdapterError,
  adapterError,
  SessionStore,
} from "@zosma-cowork/protocol";

import type {
  AdapterManifest,
  SessionHandle,
  SessionState,
  SessionRecord,
  InitializeRequest,
  InitializeResponse,
  Turn,
  TurnResult,
  UpdatePatch,
  AcpSessionConfig,
  PermissionRequest,
  PermissionResponse,
  HealthStatus,
  Identity,
  Capability,
  NormalizedEvent,
} from "@zosma-cowork/protocol";
```

The daemon itself remains TypeScript outside `node_modules` and runs through Node's type stripper. The production supervisor and deploy test pass `--conditions=zosma-production`, so imports from the deployed protocol dependency select `dist/*.js`; workspace development keeps selecting `src/*.ts`. Node never attempts to type-strip a file physically inside deployed `node_modules`.

- [ ] **Step 4: Verify deployed and source daemon behavior**

Run:

```bash
pnpm -C packages/protocol build
node --test scripts/deploy-daemon.test.mjs
pnpm -C apps/daemon test
pnpm -C apps/daemon typecheck
pnpm -C packages/protocol test
pnpm -C packages/protocol typecheck
```

Expected: all pass. The deploy test must inspect the temporary deployed directory, not the workspace's hoisted `node_modules`.

- [ ] **Step 5: Commit the portable daemon package**

```bash
git add scripts/deploy-daemon.test.mjs apps/daemon/package.json \
  packages/protocol/package.json packages/protocol/tsconfig.build.json \
  apps/daemon/src/pi/adapter.ts
git commit -m "feat: make daemon runtime deployable"
```

### Task 6: Assemble and checksum host server archives

**Files:**
- Create: `scripts/bundled-node-version.mjs`
- Create: `scripts/package-server-release.mjs`
- Create: `scripts/package-server-release.test.mjs`
- Modify: `apps/desktop/scripts/fetch-node.mjs`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-09-12-unified-installer-design.md`

- [ ] **Step 1: Clarify the approved archive shape for bundled npm**

The existing daemon's `apps/daemon/src/read/lib/npx.ts` resolves `npx-cli.js` relative to `process.execPath`. Therefore Phase 1 must retain npm from the official Node distribution while still requiring no system Node/npm.

Update the archive tree in the design spec to:

```text
runtime/bin/node
runtime/lib/node_modules/npm/
web/dist-server/
daemon/
supervisor/run-server.mjs
supervisor/healthcheck.mjs
VERSION
```

This is a packaging clarification, not a new installer capability.

- [ ] **Step 2: Write failing package-helper tests**

Create `scripts/package-server-release.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  archiveName,
  assertPortableTree,
  assertRuntimeTree,
  nodeDistribution,
  parseSha256Sums,
  targetFor,
} from "./package-server-release.mjs";

test("targetFor normalizes the four supported host tuples", () => {
  assert.equal(targetFor("linux", "x64"), "linux-x64");
  assert.equal(targetFor("linux", "arm64"), "linux-arm64");
  assert.equal(targetFor("darwin", "x64"), "darwin-x64");
  assert.equal(targetFor("darwin", "arm64"), "darwin-arm64");
});

test("targetFor rejects unsupported hosts", () => {
  assert.throws(() => targetFor("win32", "x64"), /unsupported server target/);
});

test("nodeDistribution selects the expected official archive", () => {
  assert.deepEqual(nodeDistribution("v24.15.0", "linux-arm64"), {
    directory: "node-v24.15.0-linux-arm64",
    filename: "node-v24.15.0-linux-arm64.tar.xz",
  });
  assert.deepEqual(nodeDistribution("v24.15.0", "darwin-x64"), {
    directory: "node-v24.15.0-darwin-x64",
    filename: "node-v24.15.0-darwin-x64.tar.gz",
  });
});

test("parseSha256Sums returns only exact filenames", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const sums = parseSha256Sums(`${a}  node-a.tar.gz\n${b}  node-b.tar.gz\n`);
  assert.equal(sums.get("node-a.tar.gz"), a);
  assert.equal(sums.get("node-a"), undefined);
});

test("archiveName requires a v-prefixed semantic version", () => {
  assert.equal(
    archiveName("v0.19.0", "linux-x64"),
    "zosma-cowork-server-v0.19.0-linux-x64.tar.gz",
  );
  assert.throws(() => archiveName("latest", "linux-x64"), /v-prefixed semantic version/);
});

test("assertPortableTree rejects symlinks outside the staged bundle", () => {
  const temp = mkdtempSync(join(tmpdir(), "zosma-link-"));
  const root = join(temp, "root");
  try {
    mkdirSync(root);
    writeFileSync(join(temp, "workspace-file"), "outside");
    symlinkSync(join(temp, "workspace-file"), join(root, "escaped-link"));
    assert.throws(() => assertPortableTree(root), /symlink escapes runtime tree/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("assertPortableTree rejects first-party daemon tests", () => {
  const root = mkdtempSync(join(tmpdir(), "zosma-policy-"));
  try {
    mkdirSync(join(root, "daemon/src"), { recursive: true });
    writeFileSync(join(root, "daemon/src/example.test.mjs"), "test");
    assert.throws(() => assertPortableTree(root), /forbidden first-party test entry/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertPortableTree rejects Next cache output", () => {
  const root = mkdtempSync(join(tmpdir(), "zosma-policy-"));
  try {
    mkdirSync(join(root, "web/dist-server/.next/cache"), { recursive: true });
    writeFileSync(join(root, "web/dist-server/.next/cache/item"), "cache");
    assert.throws(() => assertPortableTree(root), /forbidden Next cache entry/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertRuntimeTree rejects a bundle without npm", () => {
  const root = mkdtempSync(join(tmpdir(), "zosma-tree-"));
  try {
    for (const path of ["runtime/bin", "web/dist-server", "daemon/src", "supervisor"]) {
      mkdirSync(join(root, path), { recursive: true });
    }
    writeFileSync(join(root, "runtime/bin/node"), "node");
    writeFileSync(join(root, "web/dist-server/server.js"), "server");
    writeFileSync(join(root, "daemon/src/index.ts"), "entry");
    writeFileSync(join(root, "supervisor/run-server.mjs"), "entry");
    writeFileSync(join(root, "supervisor/healthcheck.mjs"), "entry");
    writeFileSync(join(root, "VERSION"), "v0.19.0\n");
    assert.throws(() => assertRuntimeTree(root), /npm-cli\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the package tests to verify they fail**

Run:

```bash
node --test scripts/package-server-release.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/package-server-release.mjs`.

- [ ] **Step 4: Introduce one shared bundled Node version**

Create `scripts/bundled-node-version.mjs`:

```js
export const BUNDLED_NODE_VERSION = "v24.15.0";
```

In `apps/desktop/scripts/fetch-node.mjs`, replace its local `NODE_VERSION` declaration with:

```js
import { BUNDLED_NODE_VERSION as NODE_VERSION } from "../../../scripts/bundled-node-version.mjs";
```

Do not otherwise refactor the proven desktop downloader in this phase.

- [ ] **Step 5: Implement the testable package primitives**

Create `scripts/package-server-release.mjs` with these exports and constants:

```js
#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { BUNDLED_NODE_VERSION } from "./bundled-node-version.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]);

export function targetFor(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!TARGETS.has(target)) throw new Error(`unsupported server target: ${target}`);
  return target;
}

export function archiveName(version, target) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("version must be a v-prefixed semantic version");
  }
  if (!TARGETS.has(target)) throw new Error(`unsupported server target: ${target}`);
  return `zosma-cowork-server-${version}-${target}.tar.gz`;
}

export function nodeDistribution(version, target) {
  if (!TARGETS.has(target)) throw new Error(`unsupported server target: ${target}`);
  const extension = target.startsWith("linux-") ? "tar.xz" : "tar.gz";
  return {
    directory: `node-${version}-${target}`,
    filename: `node-${version}-${target}.${extension}`,
  };
}

export function parseSha256Sums(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) result.set(match[2], match[1].toLowerCase());
  }
  return result;
}

function walk(root) {
  const paths = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    paths.push(path);
    if (entry.isDirectory() && !entry.isSymbolicLink()) paths.push(...walk(path));
  }
  return paths;
}

export function assertPortableTree(root) {
  const resolvedRoot = realpathSync(root);
  for (const path of walk(root)) {
    const entry = relative(root, path).split(/[\\/]+/);
    const relativePath = entry.join("/");
    if (entry.includes(".git")) throw new Error(`forbidden .git entry: ${path}`);
    if (relativePath.startsWith("web/dist-server/.next/cache/")) {
      throw new Error(`forbidden Next cache entry: ${path}`);
    }
    const firstPartySource = relativePath.startsWith("daemon/src/")
      || relativePath.includes("daemon/node_modules/@zosma-cowork/protocol/src/");
    if (firstPartySource && /\.test\.(?:mjs|ts)$/.test(path)) {
      throw new Error(`forbidden first-party test entry: ${path}`);
    }
    if (lstatSync(path).isSymbolicLink()) {
      const target = realpathSync(path);
      const fromRoot = relative(resolvedRoot, target);
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new Error(`symlink escapes runtime tree: ${path} -> ${target}`);
      }
    }
  }
}

export function assertRuntimeTree(root) {
  const required = [
    "runtime/bin/node",
    "runtime/lib/node_modules/npm/bin/npm-cli.js",
    "runtime/lib/node_modules/npm/bin/npx-cli.js",
    "web/dist-server/server.js",
    "web/dist-server/bin/pi-web.js",
    "daemon/src/index.ts",
    "daemon/bin/zosma-daemon.js",
    "supervisor/run-server.mjs",
    "supervisor/healthcheck.mjs",
    "VERSION",
  ];
  for (const path of required) {
    try {
      if (!statSync(join(root, path)).isFile()) throw new Error();
    } catch {
      throw new Error(`required runtime file missing: ${path}`);
    }
  }
}
```

Keep `assertRuntimeTree` synchronous because it is used only at the final assembly boundary and in tests.

Add small internal helpers to the same file; do not add a packaging framework:

```js
function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} exited ${code}`)));
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(path, { mode: 0o600 }),
  );
}
```

- [ ] **Step 6: Implement assembly as one staged transaction**

Continue in `scripts/package-server-release.mjs` with this command flow:

```js
async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      version: { type: "string" },
      output: { type: "string", default: "dist/server" },
    },
  });
  const hostTarget = targetFor();
  const target = values.target ?? hostTarget;
  const version = values.version;
  if (!version) throw new Error("--version is required");
  if (target !== hostTarget) {
    throw new Error(`cross-packaging is unsupported: host ${hostTarget}, target ${target}`);
  }

  const outputDir = resolve(REPO_ROOT, values.output);
  const temp = await mkdtemp(join(tmpdir(), "zosma-server-package-"));
  const stage = join(temp, "stage");
  const nodeTemp = join(temp, "node");
  const finalName = archiveName(version, target);
  const finalPath = join(outputDir, finalName);
  const stagedArchive = join(temp, finalName);

  try {
    await mkdir(stage, { recursive: true });
    await run("pnpm", ["-C", "apps/web", "build"], { cwd: REPO_ROOT });
    await run("pnpm", ["-C", "apps/web", "package-server"], { cwd: REPO_ROOT });
    await run("pnpm", ["-C", "apps/daemon", "typecheck"], { cwd: REPO_ROOT });
    await run("pnpm", ["-C", "packages/protocol", "build"], { cwd: REPO_ROOT });
    await run("pnpm", [
      "--filter", "@zosma-cowork/daemon",
      "deploy", "--prod", "--legacy", join(stage, "daemon"),
    ], { cwd: REPO_ROOT });

    await cp(join(REPO_ROOT, "apps/web/dist-server"), join(stage, "web/dist-server"), {
      recursive: true,
      dereference: true,
    });
    await mkdir(join(stage, "supervisor"), { recursive: true });
    await cp(join(REPO_ROOT, "scripts/run-server.mjs"), join(stage, "supervisor/run-server.mjs"));
    await cp(join(REPO_ROOT, "scripts/healthcheck.mjs"), join(stage, "supervisor/healthcheck.mjs"));
    await writeFile(join(stage, "VERSION"), `${version}\n`, { mode: 0o644 });

    const distribution = nodeDistribution(BUNDLED_NODE_VERSION, target);
    const baseUrl = `https://nodejs.org/dist/${BUNDLED_NODE_VERSION}`;
    const archive = join(temp, distribution.filename);
    const sumsPath = join(temp, "SHASUMS256.txt");
    await download(`${baseUrl}/SHASUMS256.txt`, sumsPath);
    await download(`${baseUrl}/${distribution.filename}`, archive);
    const expected = parseSha256Sums(await readFile(sumsPath, "utf8")).get(distribution.filename);
    if (!expected || await sha256(archive) !== expected) {
      throw new Error(`Node checksum mismatch: ${distribution.filename}`);
    }

    await mkdir(nodeTemp, { recursive: true });
    await run("tar", [target.startsWith("linux-") ? "-xJf" : "-xzf", archive, "-C", nodeTemp]);
    const nodeRoot = join(nodeTemp, distribution.directory);
    await mkdir(join(stage, "runtime/bin"), { recursive: true });
    await mkdir(join(stage, "runtime/lib/node_modules"), { recursive: true });
    await cp(join(nodeRoot, "bin/node"), join(stage, "runtime/bin/node"));
    await cp(join(nodeRoot, "lib/node_modules/npm"), join(stage, "runtime/lib/node_modules/npm"), {
      recursive: true,
      dereference: true,
    });
    await chmod(join(stage, "runtime/bin/node"), 0o755);

    assertRuntimeTree(stage);
    assertPortableTree(stage);
    await run("tar", ["-czf", stagedArchive, "-C", stage, "."]);
    await mkdir(outputDir, { recursive: true });
    await rename(stagedArchive, finalPath);
    const digest = await sha256(finalPath);
    await writeFile(join(outputDir, "SHA256SUMS"), `${digest}  ${finalName}\n`, { mode: 0o644 });
    process.stdout.write(`${finalPath}\n`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
```

Add the direct-entry guard and safe error output:

```js
const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
```

Run `node --check scripts/package-server-release.mjs` after assembly. Keep the imports shown above exact, and do not copy the whole Node distribution or include headers/docs.

- [ ] **Step 7: Add root commands and run the unit checks**

Add to root `package.json`:

```json
"server:package": "node scripts/package-server-release.mjs",
"test:server": "node --test scripts/*.test.mjs"
```

Run:

```bash
pnpm test:server
node --check scripts/package-server-release.mjs
node --check apps/desktop/scripts/fetch-node.mjs
```

Expected: package helper tests pass, and both scripts parse while importing the same Node version constant. Do not execute the desktop downloader or modify generated desktop binaries.

- [ ] **Step 8: Build one host archive and inspect its contents**

Run on the current supported host:

```bash
pnpm server:package -- --version v0.0.0-dev
tar -tzf dist/server/zosma-cowork-server-v0.0.0-dev-$(node -p '`${process.platform}-${process.arch}`').tar.gz | sort
```

Expected: `assertPortableTree` has already enforced no first-party daemon tests, `.git`, Next cache, dangling links, or links escaping into the live workspace. A portable pnpm virtual-store directory is allowed when `pnpm deploy` needs it. The listing confirms the fixed shape, and `SHA256SUMS` matches the archive.

- [ ] **Step 9: Re-run package and application checks**

Run:

```bash
pnpm test:server
pnpm -C apps/daemon test
pnpm -C apps/daemon typecheck
pnpm -C apps/web typecheck
pnpm -C apps/web test
```

Expected: all pass.

- [ ] **Step 10: Commit archive assembly**

```bash
git add scripts/bundled-node-version.mjs scripts/package-server-release.mjs \
  scripts/package-server-release.test.mjs apps/desktop/scripts/fetch-node.mjs \
  package.json docs/superpowers/specs/2026-09-12-unified-installer-design.md
git commit -m "feat: package self-contained server archives"
```

### Task 7: Smoke-test the extracted archive without host toolchains

**Files:**
- Create: `scripts/smoke-server-release.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the smoke command before its implementation**

Add to root `package.json`:

```json
"server:smoke": "node scripts/smoke-server-release.mjs"
```

Run:

```bash
pnpm server:smoke -- --archive dist/server/does-not-exist.tar.gz
```

Expected: FAIL because `scripts/smoke-server-release.mjs` does not exist.

- [ ] **Step 2: Implement the exact-artifact smoke test**

Create `scripts/smoke-server-release.mjs` with only Node built-ins. Its direct flow must:

```js
#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitFor(url, options, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
    } catch {
      // Runtime is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`health timeout: ${url}`);
}

async function post(url, token, body) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "pipe", ...options });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} exited ${code}`)));
  });
}
```

The main body must perform these exact checks:

```js
const { values } = parseArgs({ options: { archive: { type: "string" } } });
if (!values.archive) throw new Error("--archive is required");
const archive = resolve(values.archive);
const temp = await mkdtemp(join(tmpdir(), "zosma-server-smoke-"));
const root = join(temp, "runtime-root");
const workspace = join(temp, "workspace");
const daemonState = join(temp, "daemon-state");
const piState = join(temp, "pi-agent");
let child;

try {
  await mkdir(root, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await new Promise((resolveRun, rejectRun) => {
    const tar = spawn("tar", ["-xzf", archive, "-C", root], { stdio: "inherit" });
    tar.once("error", rejectRun);
    tar.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`tar exited ${code}`)));
  });

  const version = (await readFile(join(root, "VERSION"), "utf8")).trim();
  if (!/^v\d+\.\d+\.\d+/.test(version)) throw new Error(`invalid VERSION: ${version}`);

  const bundledNode = join(root, "runtime/bin/node");
  const bundledNpx = join(root, "runtime/lib/node_modules/npm/bin/npx-cli.js");
  await run(bundledNode, [bundledNpx, "--version"], {
    env: { HOME: temp, PATH: join(root, "runtime/bin") },
  });

  const daemonPort = await freePort();
  const webPort = await freePort();
  const token = randomUUID();
  const password = randomUUID();
  child = spawn(bundledNode, [join(root, "supervisor/run-server.mjs")], {
    cwd: root,
    env: {
      HOME: temp,
      PATH: join(temp, "empty-path"),
      PORT: String(webPort),
      PI_WEB_HOSTNAME: "127.0.0.1",
      PI_WEB_PASSWORD: password,
      PI_WEB_NO_OPEN: "1",
      PI_CODING_AGENT_DIR: piState,
      ZOSMA_DAEMON_DATA_DIR: daemonState,
      ZOSMA_DAEMON_PORT: String(daemonPort),
      ZOSMA_DAEMON_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  await waitFor(`http://127.0.0.1:${daemonPort}/health`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const webAuthorization = `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`;
  await waitFor(`http://127.0.0.1:${webPort}/api/v1/health`, {
    headers: { authorization: webAuthorization },
  });

  const validate = await fetch(`http://127.0.0.1:${webPort}/api/cwd/validate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: webAuthorization },
    body: JSON.stringify({ cwd: workspace }),
  });
  if (!validate.ok) throw new Error(`web cwd validation failed: ${validate.status}`);
  const webGit = await fetch(
    `http://127.0.0.1:${webPort}/api/git/status?cwd=${encodeURIComponent(workspace)}`,
    { headers: { authorization: webAuthorization } },
  );
  const webGitBody = await webGit.json();
  if (webGit.status !== 503 || webGitBody.error !== "git_unavailable") {
    throw new Error(`web Git route did not degrade predictably: ${webGit.status}`);
  }

  const allow = await post(`http://127.0.0.1:${daemonPort}/ipc`, token, {
    type: "read:allow-root",
    root: workspace,
  });
  if (!allow.ok) throw new Error(`allow-root failed: ${allow.status}`);
  const git = await post(`http://127.0.0.1:${daemonPort}/ipc`, token, {
    type: "git:status",
    cwd: workspace,
  });
  const gitBody = await git.json();
  if (git.status !== 503 || gitBody.error !== "git_unavailable") {
    throw new Error(`missing Git did not degrade predictably: ${git.status}`);
  }

  child.kill("SIGTERM");
  const exitCode = await new Promise((resolveExit) => child.once("exit", resolveExit));
  if (exitCode !== 0) throw new Error(`supervisor exited ${exitCode}`);
  if (
    output.includes(token)
    || output.includes(token.slice(0, 6))
    || output.includes(password)
    || output.includes(password.slice(0, 6))
  ) {
    throw new Error("secret or secret hint leaked to output");
  }
  process.stdout.write(`server archive smoke passed: ${version}\n`);
} finally {
  if (child?.exitCode === null) child.kill("SIGKILL");
  await rm(temp, { recursive: true, force: true });
}
```

Create `empty-path` before spawning, or use a non-existent absolute path; the child must not discover system `node`, `npm`, `pnpm`, `rustc`, or `git`. The supervisor uses `process.execPath`, so both children still run from the bundled Node executable.

Top-level ESM rejection already exits non-zero and the `finally` block performs cleanup. Do not add a test framework around this end-to-end check; the smoke script is the runnable check.

- [ ] **Step 3: Run a real archive smoke test**

Run:

```bash
archive="$(find dist/server -maxdepth 1 -name 'zosma-cowork-server-v0.0.0-dev-*.tar.gz' -print -quit)"
pnpm server:smoke -- --archive "$archive"
```

Expected: `server archive smoke passed: v0.0.0-dev`, both child processes exit, and temporary state is removed.

- [ ] **Step 4: Verify checksum failure before runtime execution**

Run:

```bash
(
  cd dist/server
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check SHA256SUMS
  else
    shasum -a 256 --check SHA256SUMS
  fi
)
```

Expected: archive reports `OK`. The smoke script receives only verified artifacts in CI; checksum enforcement in the end-user CLI belongs to Phase 3.

- [ ] **Step 5: Commit extracted-artifact smoke coverage**

```bash
git add scripts/smoke-server-release.mjs package.json
git commit -m "test: smoke test packaged Cowork server"
```

### Task 8: Build and smoke all four host archives in non-publishing CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the host artifact matrix**

Append a new independent job to `.github/workflows/ci.yml`:

```yaml
  server-artifact:
    name: Server artifact (${{ matrix.target }})
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        include:
          - runner: ubuntu-22.04
            target: linux-x64
          - runner: ubuntu-22.04-arm
            target: linux-arm64
          - runner: macos-15-intel
            target: darwin-x64
          - runner: macos-15
            target: darwin-arm64
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup build Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - name: Install workspace dependencies
        run: pnpm install --frozen-lockfile

      - name: Run server unit and daemon tests
        run: |
          pnpm test:server
          pnpm -C apps/daemon test
          pnpm -C apps/daemon typecheck

      - name: Package host archive
        run: pnpm server:package -- --target "${{ matrix.target }}" --version v0.0.0-ci

      - name: Verify archive checksum
        working-directory: dist/server
        run: |
          if command -v sha256sum >/dev/null 2>&1; then
            sha256sum --check SHA256SUMS
          else
            shasum -a 256 --check SHA256SUMS
          fi

      - name: Smoke extracted archive
        shell: bash
        run: |
          archive="dist/server/zosma-cowork-server-v0.0.0-ci-${{ matrix.target }}.tar.gz"
          pnpm server:smoke -- --archive "$archive"

      - name: Debian 12 compatibility smoke
        if: matrix.target == 'linux-x64'
        shell: bash
        run: |
          archive="dist/server/zosma-cowork-server-v0.0.0-ci-linux-x64.tar.gz"
          temp="$(mktemp -d)"
          trap 'rm -rf "$temp"' EXIT
          tar -xzf "$archive" -C "$temp"
          docker run --rm --network host \
            -v "$PWD:/repo" -v "$temp:$temp:ro" -w /repo debian:12-slim \
            "$temp/runtime/bin/node" scripts/smoke-server-release.mjs --archive "$archive"
```

This executes the archive's Node binary inside Debian 12 and runs the full smoke script there; a version-only check is insufficient.

Do not add `actions/upload-artifact`: Phase 1 CI proves artifacts but does not publish them.

- [ ] **Step 2: Validate the workflow and local equivalents**

Run:

```bash
pnpm test:server
pnpm -C apps/daemon test
pnpm -C apps/daemon typecheck
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm server:package -- --version v0.0.0-ci
archive="$(find dist/server -maxdepth 1 -name 'zosma-cowork-server-v0.0.0-ci-*.tar.gz' -print -quit)"
pnpm server:smoke -- --archive "$archive"
```

Expected: all commands pass on the current host. Also inspect `.github/workflows/ci.yml` to confirm the existing `web`, `docs`, and `tauri` jobs are unchanged.

- [ ] **Step 3: Run repository formatting and diff checks**

Run:

```bash
git diff --check
pnpm lint
pnpm typecheck
```

Expected: clean output and zero exit status.

- [ ] **Step 4: Commit Phase 1 CI**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: verify local server archives"
```

- [ ] **Step 5: Perform the Phase 1 completion check**

Run:

```bash
git status --short
pnpm test:server
pnpm -C apps/daemon test
pnpm -C apps/daemon typecheck
pnpm -C apps/web test
pnpm -C apps/web typecheck
git diff --check
```

Expected:

- Worktree is clean.
- All tests/type checks pass.
- Current-host archive checksum and smoke test pass.
- CI matrix contains exactly Linux x64/arm64 and macOS x64/arm64.
- No Docker image, installer CLI, service file, release asset, or stable-channel behavior has been added.

Phase 1 is complete only when the four CI matrix jobs pass on the branch. Phase 2 must consume this exact supervisor/archive contract rather than creating another runtime entry point.
