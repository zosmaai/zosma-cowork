# Production Docker Image and GHCR Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the proven Phase 1 Cowork runtime into a non-root amd64/arm64 Docker image, verify its production Compose contract, and publish exact-version images to GHCR with an independently recorded immutable manifest digest.

**Architecture:** The root Dockerfile reuses the Phase 1 `server:package` command inside a pinned Linux builder, extracts that exact archive payload, and adds only Debian runtime files plus Git. A generated-Compose template runs the shared supervisor with two bind mounts, explicit UID/GID, loopback publication by default, and environment-backed authenticated health. Normal CI builds and smokes one local amd64 image; an independent tag workflow waits for the matching published desktop release, builds and smokes native amd64/arm64 images by digest, then creates the sole exact-version tag and records its top-level digest.

**Tech Stack:** Docker Engine/BuildKit, Docker Compose v2, Debian 12 slim, bundled Node.js 24, POSIX container runtime, Node.js built-in test runner, GitHub Actions, GHCR.

**Roadmap:** `docs/superpowers/roadmaps/2026-09-12-unified-installer-roadmap.md`

**Phase:** Phase 2: Production Docker Image and GHCR Publication

---

## Phase boundary

This plan implements only Phase 2. It does not add `install.sh`, the `zosma` lifecycle CLI, user-machine Compose generation, GitHub Release assets, artifact attestations, `latest`, stable manifests, domain configuration, or public installation documentation. Keep `.github/workflows/release.yml` unchanged. Retain `apps/web/Dockerfile`, `apps/web/docker-compose.sandbox.yml`, `apps/web/entrypoint.sh`, and `apps/web/scripts/docker-sandbox.sh` as development-only sandbox fixtures.

The unauthenticated registry endpoint currently returns an authentication challenge, so this local audit cannot prove that the package exists or is publicly pullable. GitHub documents that a newly created container package is private by default. The first exact-image workflow may therefore stop at its anonymous-pull gate until an organization owner changes `ghcr.io/zosmaai/zosma-cowork` visibility to **Public** and reruns the failed job. Do not add a PAT or broaden `GITHUB_TOKEN` permissions to automate that administrative action.

## Fixed release inputs

Use these reviewed immutable inputs when this plan is implemented:

- Builder: `node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d`
- Runtime: `debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171`
- `actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803` (`v6`)
- `actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38` (`v6`)
- `actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f` (`v6`)
- `actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131` (`v7`)
- `docker/login-action@dbcb813823bdd20940b903addbd779551569679f` (`v4`)
- `docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e` (`v4`)
- `docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a` (`v7`)

The base-image digests were resolved from the official multi-architecture image indexes. If either exact digest has disappeared when implementation begins, stop and request review rather than silently replacing it.

### Task 1: Define the installer-consumed Compose contract

**Files:**
- Create: `deploy/compose.yml.template`
- Create: `scripts/docker/compose-contract.test.mjs`

- [ ] **Step 1: Write the failing Compose contract tests**

Create `scripts/docker/compose-contract.test.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const template = join(repoRoot, "deploy", "compose.yml.template");
const digest = `sha256:${"a".repeat(64)}`;
const baseEnv = {
  ...process.env,
  ZOSMA_IMAGE: `ghcr.io/zosmaai/zosma-cowork@${digest}`,
  ZOSMA_BIND_ADDRESS: "127.0.0.1",
  ZOSMA_PORT: "30141",
  ZOSMA_UID: "1000",
  ZOSMA_GID: "1000",
  ZOSMA_WORKSPACE: "/tmp/zosma-workspace",
  ZOSMA_PI_STATE: "/tmp/zosma-pi-state",
  ZOSMA_DAEMON_TOKEN: "contract-daemon-token",
  PI_WEB_PASSWORD: "contract-web-password",
  PI_WEB_ALLOWED_HOSTS: "cowork.example.test",
};

function composeConfig(overrides = {}) {
  const stdout = execFileSync(
    "docker",
    ["compose", "-f", template, "config", "--format", "json"],
    { cwd: repoRoot, env: { ...baseEnv, ...overrides }, encoding: "utf8" },
  );
  return JSON.parse(stdout);
}

test("Compose uses a digest-pinned image and loopback publication by default", () => {
  const service = composeConfig().services.cowork;
  assert.equal(service.image, baseEnv.ZOSMA_IMAGE);
  assert.deepEqual(service.ports, [{
    mode: "ingress",
    target: 30141,
    published: "30141",
    protocol: "tcp",
    host_ip: "127.0.0.1",
    name: "web",
  }]);
});

test("Compose runs with the selected Linux UID and GID", () => {
  assert.equal(composeConfig().services.cowork.user, "1000:1000");
});

test("Compose mounts only the selected workspace and dedicated Pi state", () => {
  const volumes = composeConfig().services.cowork.volumes;
  assert.deepEqual(volumes.map(({ type, source, target, read_only }) => ({
    type,
    source,
    target,
    read_only: Boolean(read_only),
  })), [
    { type: "bind", source: "/tmp/zosma-workspace", target: "/workspace", read_only: false },
    { type: "bind", source: "/tmp/zosma-pi-state", target: "/data/pi-agent", read_only: false },
  ]);
});

test("Compose passes LAN authentication and host allowlisting through environment", () => {
  const service = composeConfig({ ZOSMA_BIND_ADDRESS: "0.0.0.0" }).services.cowork;
  assert.equal(service.ports[0].host_ip, "0.0.0.0");
  assert.equal(service.environment.PI_WEB_PASSWORD, "contract-web-password");
  assert.equal(service.environment.PI_WEB_ALLOWED_HOSTS, "cowork.example.test");
});

test("Compose contains no privileged host integration", () => {
  const service = composeConfig().services.cowork;
  assert.notEqual(service.privileged, true);
  assert.notEqual(service.network_mode, "host");
  assert.deepEqual(service.cap_add ?? [], []);
  assert.deepEqual(service.devices ?? [], []);
  assert.equal(
    JSON.stringify(service).includes("/var/run/docker.sock"),
    false,
  );
});

test("Compose requires every installer-owned runtime input", () => {
  for (const name of [
    "ZOSMA_IMAGE",
    "ZOSMA_WORKSPACE",
    "ZOSMA_PI_STATE",
    "ZOSMA_DAEMON_TOKEN",
  ]) {
    const env = { ...baseEnv };
    delete env[name];
    assert.throws(
      () => execFileSync(
        "docker",
        ["compose", "-f", template, "config", "--format", "json"],
        { cwd: repoRoot, env, stdio: "pipe" },
      ),
      undefined,
      name,
    );
  }
});
```

The test uses only placeholder credentials. Never substitute real tokens or passwords into fixtures.

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```bash
node --test scripts/docker/compose-contract.test.mjs
```

Expected: FAIL because `deploy/compose.yml.template` does not exist.

- [ ] **Step 3: Add the production Compose template**

Create `deploy/compose.yml.template`:

```yaml
services:
  cowork:
    image: "${ZOSMA_IMAGE:?set ZOSMA_IMAGE to an immutable ghcr.io digest reference}"
    user: "${ZOSMA_UID:-1000}:${ZOSMA_GID:-1000}"
    restart: unless-stopped
    environment:
      HOME: /data/pi-agent
      PORT: "30141"
      PI_WEB_HOSTNAME: 0.0.0.0
      PI_WEB_NO_OPEN: "1"
      PI_WEB_PASSWORD: "${PI_WEB_PASSWORD:-}"
      PI_WEB_ALLOWED_HOSTS: "${PI_WEB_ALLOWED_HOSTS:-}"
      PI_CODING_AGENT_DIR: /data/pi-agent
      ZOSMA_DAEMON_DATA_DIR: /data/pi-agent/daemon
      ZOSMA_DAEMON_PORT: "64713"
      ZOSMA_DAEMON_TOKEN: "${ZOSMA_DAEMON_TOKEN:?set ZOSMA_DAEMON_TOKEN}"
    ports:
      - name: web
        target: 30141
        published: "${ZOSMA_PORT:-30141}"
        host_ip: "${ZOSMA_BIND_ADDRESS:-127.0.0.1}"
        protocol: tcp
    volumes:
      - type: bind
        source: "${ZOSMA_WORKSPACE:?set ZOSMA_WORKSPACE to an absolute directory}"
        target: /workspace
      - type: bind
        source: "${ZOSMA_PI_STATE:?set ZOSMA_PI_STATE to an absolute directory}"
        target: /data/pi-agent
```

Do not add a `build` section, named volume, Docker socket, host networking, capability, device, Tailscale sidecar, or mutable default image. Phase 3 will validate absolute host paths and generate the environment consumed by this template.

- [ ] **Step 4: Run the Compose contract tests**

Run:

```bash
node --test scripts/docker/compose-contract.test.mjs
```

Expected: 6 tests pass. `docker compose config` emits no warnings.

- [ ] **Step 5: Commit the Compose contract**

```bash
git add deploy/compose.yml.template scripts/docker/compose-contract.test.mjs
git commit -m "feat: define production Docker Compose contract"
```

### Task 2: Build the production image from the Phase 1 artifact

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `scripts/docker/image-contract.test.mjs`

- [ ] **Step 1: Write the failing image contract tests**

Create `scripts/docker/image-contract.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { BUNDLED_NODE_VERSION } from "../bundled-node-version.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRoot = (name) => readFileSync(join(repoRoot, name), "utf8");

const NODE_INDEX = "sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d";
const DEBIAN_INDEX = "sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171";

test("Dockerfile pins the builder and runtime image indexes", () => {
  const source = readRoot("Dockerfile");
  assert.match(
    source,
    new RegExp(`ARG NODE_IMAGE=node:${BUNDLED_NODE_VERSION.slice(1)}-bookworm-slim@${NODE_INDEX}`),
  );
  assert.match(source, new RegExp(`ARG RUNTIME_IMAGE=debian:bookworm-slim@${DEBIAN_INDEX}`));
});

test("Dockerfile consumes the Phase 1 server package instead of rebuilding a second runtime", () => {
  const source = readRoot("Dockerfile");
  assert.match(source, /pnpm server:package --version "\$\{ZOSMA_VERSION\}"/);
  assert.match(source, /zosma-cowork-server-\$\{ZOSMA_VERSION\}-linux-\$\{arch\}\.tar\.gz/);
});

test("Dockerfile installs Git and launches the shared supervisor as a non-root user", () => {
  const source = readRoot("Dockerfile");
  assert.match(source, /apt-get install[^\n]*--no-install-recommends[^\n]*ca-certificates[^\n]*git[^\n]*tzdata/);
  assert.match(source, /^USER 10001:10001$/m);
  assert.match(source, /HEALTHCHECK[^\n]*CMD \["\/opt\/zosma\/runtime\/bin\/node", "\/opt\/zosma\/supervisor\/healthcheck\.mjs"\]/);
  assert.match(source, /ENTRYPOINT \["\/opt\/zosma\/runtime\/bin\/node", "\/opt\/zosma\/supervisor\/run-server\.mjs"\]/);
});

test("Dockerfile contains no sandbox-only privilege or Tailscale setup", () => {
  const source = readRoot("Dockerfile");
  assert.doesNotMatch(source, /tailscale|tailscaled|NET_ADMIN|SYS_ADMIN|\/dev\/net\/tun/i);
});

test("root Docker context excludes build products, repositories, and local secrets", () => {
  const entries = new Set(
    readRoot(".dockerignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  for (const entry of [
    ".git",
    ".env*",
    "**/.env*",
    ".zosma*",
    ".llm-wiki",
    ".pi",
    ".worktrees",
    "**/node_modules",
    "**/.next",
    "**/dist-server",
    "dist",
    "target",
    "*.log",
  ]) {
    assert.equal(entries.has(entry), true, `missing .dockerignore entry: ${entry}`);
  }
});
```

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```bash
node --test scripts/docker/image-contract.test.mjs
```

Expected: FAIL because the root `Dockerfile` and `.dockerignore` do not exist.

- [ ] **Step 3: Add the minimal root Docker context policy**

Create `.dockerignore`:

```dockerignore
.git
.gitignore
.env*
**/.env*
.zosma*
.llm-wiki
.obsidian
.pi
.pr-assets
.worktrees
**/node_modules
**/.next
**/dist-server
**/coverage
dist
target
*.log
*.tmp
```

Do not copy a local environment file, local dependency tree, existing Phase 1 archive, or compiled desktop output into the build context.

- [ ] **Step 4: Add the production multi-stage Dockerfile**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
ARG RUNTIME_IMAGE=debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

FROM ${NODE_IMAGE} AS builder
ARG ZOSMA_VERSION
WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends xz-utils \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN corepack enable \
  && corepack prepare pnpm@10.33.2 --activate \
  && pnpm install --frozen-lockfile
RUN arch="$(node -p 'process.arch')" \
  && pnpm server:package --version "${ZOSMA_VERSION}" --output /tmp/server \
  && mkdir -p /opt/zosma \
  && tar -xzf "/tmp/server/zosma-cowork-server-${ZOSMA_VERSION}-linux-${arch}.tar.gz" \
    -C /opt/zosma

FROM ${RUNTIME_IMAGE} AS runtime
ARG ZOSMA_VERSION
ARG VCS_REF
LABEL org.opencontainers.image.title="Zosma Cowork" \
  org.opencontainers.image.description="Self-hosted Zosma Cowork web and daemon runtime" \
  org.opencontainers.image.source="https://github.com/zosmaai/zosma-cowork" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.version="${ZOSMA_VERSION}" \
  org.opencontainers.image.revision="${VCS_REF}"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 zosma \
  && useradd --uid 10001 --gid 10001 --no-create-home \
    --home-dir /data/pi-agent --shell /usr/sbin/nologin zosma \
  && mkdir -p /workspace /data/pi-agent \
  && chown -R 10001:10001 /workspace /data/pi-agent
COPY --from=builder --chown=10001:10001 /opt/zosma /opt/zosma
ENV HOME=/data/pi-agent \
  PATH=/opt/zosma/runtime/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  PORT=30141 \
  PI_WEB_HOSTNAME=0.0.0.0 \
  PI_WEB_NO_OPEN=1 \
  PI_CODING_AGENT_DIR=/data/pi-agent \
  ZOSMA_DAEMON_DATA_DIR=/data/pi-agent/daemon \
  ZOSMA_DAEMON_PORT=64713
WORKDIR /workspace
USER 10001:10001
EXPOSE 30141
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD ["/opt/zosma/runtime/bin/node", "/opt/zosma/supervisor/healthcheck.mjs"]
ENTRYPOINT ["/opt/zosma/runtime/bin/node", "/opt/zosma/supervisor/run-server.mjs"]
```

The builder deliberately calls the Phase 1 archive command. This costs one archive/extract pass but prevents Docker and local mode from drifting into separate web/daemon packaging implementations. Do not use `apps/web/Dockerfile` as a base or copy its Tailscale entrypoint.

- [ ] **Step 5: Run image contract and Phase 1 regression tests**

Run:

```bash
node --test scripts/docker/image-contract.test.mjs
pnpm test:server
```

Expected: the image contract tests and all Phase 1 server tests pass.

- [ ] **Step 6: Commit the production image definition**

```bash
git add Dockerfile .dockerignore scripts/docker/image-contract.test.mjs
git commit -m "feat: add production Cowork container image"
```

### Task 3: Smoke the Compose runtime and security policy

**Files:**
- Create: `scripts/docker/smoke-helpers.test.mjs`
- Create: `scripts/docker-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing policy-helper tests**

Create `scripts/docker/smoke-helpers.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertContainerPolicy,
  assertImagePolicy,
  basicAuthorization,
} from "../docker-smoke.mjs";

const entrypoint = [
  "/opt/zosma/runtime/bin/node",
  "/opt/zosma/supervisor/run-server.mjs",
];

test("basicAuthorization creates the health-check credential without exposing plaintext", () => {
  const value = basicAuthorization("example-password");
  assert.equal(value, `Basic ${Buffer.from("pi:example-password").toString("base64")}`);
  assert.equal(value.includes("example-password"), false);
});

test("assertImagePolicy rejects a root image", () => {
  assert.throws(
    () => assertImagePolicy({ Config: { User: "", Entrypoint: entrypoint } }),
    /image must declare a non-root user/,
  );
});

test("assertContainerPolicy accepts the production boundary", () => {
  assert.doesNotThrow(() => assertContainerPolicy({
    Path: entrypoint[0],
    Args: [entrypoint[1]],
    Config: { User: "1000:1000" },
    HostConfig: {
      Privileged: false,
      NetworkMode: "zosma_default",
      CapAdd: null,
      Devices: [],
      PortBindings: { "30141/tcp": [{ HostIp: "127.0.0.1", HostPort: "32141" }] },
    },
    Mounts: [
      { Source: "/tmp/workspace", Destination: "/workspace", RW: true },
      { Source: "/tmp/state", Destination: "/data/pi-agent", RW: true },
    ],
  }, {
    uid: 1000,
    gid: 1000,
    bindAddress: "127.0.0.1",
    daemonToken: "daemon-example-secret",
    webPassword: "web-example-secret",
  }));
});

test("assertContainerPolicy rejects forbidden privilege and mounts", () => {
  assert.throws(() => assertContainerPolicy({
    Path: "node",
    Args: [],
    Config: { User: "1000:1000" },
    HostConfig: {
      Privileged: true,
      NetworkMode: "host",
      CapAdd: ["NET_ADMIN"],
      Devices: [{ PathOnHost: "/dev/net/tun" }],
      PortBindings: {},
    },
    Mounts: [{ Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock", RW: true }],
  }, {
    uid: 1000,
    gid: 1000,
    bindAddress: "127.0.0.1",
    daemonToken: "daemon-example-secret",
    webPassword: "web-example-secret",
  }), /privileged|host network|capabilities|devices|docker socket|published port/);
});
```

- [ ] **Step 2: Run the helper tests and verify the expected failure**

Run:

```bash
node --test scripts/docker/smoke-helpers.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/docker-smoke.mjs`.

- [ ] **Step 3: Implement the Docker smoke runner**

Create `scripts/docker-smoke.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(repoRoot, "deploy", "compose.yml.template");
const expectedEntrypoint = [
  "/opt/zosma/runtime/bin/node",
  "/opt/zosma/supervisor/run-server.mjs",
];

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    execFile(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${command} ${args.join(" ")} failed: ${stderr || error.message}`;
        rejectRun(error);
      } else {
        resolveRun({ stdout, stderr });
      }
    });
  });
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = http.createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function request({ port, path = "/api/v1/health", method = "GET", host, authorization, body }) {
  return new Promise((resolveRequest, rejectRequest) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        host,
        ...(authorization ? { authorization } : {}),
        ...(encoded ? {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(encoded),
        } : {}),
      },
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolveRequest({ status: response.statusCode, body: text }));
    });
    req.once("error", rejectRequest);
    if (encoded) req.write(encoded);
    req.end();
  });
}

async function waitForHealth(options, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await request(options);
      if (response.status === 200) return;
    } catch {
      // Container is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("container web health timed out");
}

async function waitForContainerHealth(containerId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { stdout } = await run(
      "docker",
      ["inspect", "--format", "{{.State.Health.Status}}", containerId],
    );
    if (stdout.trim() === "healthy") return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("Docker healthcheck did not become healthy");
}

export function basicAuthorization(password) {
  return `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`;
}

export function assertImagePolicy(image) {
  const user = image.Config?.User;
  if (!user || user === "0" || user === "root" || user.startsWith("0:")) {
    throw new Error("image must declare a non-root user");
  }
  assert.deepEqual(image.Config?.Entrypoint, expectedEntrypoint);
}

export function assertContainerPolicy(container, {
  uid,
  gid,
  bindAddress,
  daemonToken,
  webPassword,
}) {
  if (container.Config?.User !== `${uid}:${gid}`) throw new Error("container UID/GID mismatch");
  if (container.HostConfig?.Privileged) throw new Error("privileged container is forbidden");
  if (container.HostConfig?.NetworkMode === "host") throw new Error("host network is forbidden");
  if ((container.HostConfig?.CapAdd ?? []).length) throw new Error("added capabilities are forbidden");
  if ((container.HostConfig?.Devices ?? []).length) throw new Error("host devices are forbidden");

  const mounts = container.Mounts ?? [];
  if (mounts.some((mount) => mount.Source === "/var/run/docker.sock" || mount.Destination === "/var/run/docker.sock")) {
    throw new Error("docker socket is forbidden");
  }
  const expectedMounts = new Map([
    ["/workspace", true],
    ["/data/pi-agent", true],
  ]);
  if (mounts.length !== expectedMounts.size) throw new Error("unexpected mount count");
  for (const mount of mounts) {
    if (!expectedMounts.has(mount.Destination) || !mount.RW) {
      throw new Error(`unexpected or read-only mount: ${mount.Destination}`);
    }
  }

  const binding = container.HostConfig?.PortBindings?.["30141/tcp"]?.[0];
  if (!binding || binding.HostIp !== bindAddress) throw new Error("published port binding mismatch");

  const command = JSON.stringify({ path: container.Path, args: container.Args });
  for (const secret of [daemonToken, webPassword].filter(Boolean)) {
    if (command.includes(secret) || command.includes(secret.slice(0, 6))) {
      throw new Error("secret material appeared in process arguments");
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      image: { type: "string" },
      bind: { type: "string", default: "127.0.0.1" },
    },
  });
  if (!values.image) throw new Error("--image is required");
  if (!new Set(["127.0.0.1", "0.0.0.0"]).has(values.bind)) {
    throw new Error("--bind must be 127.0.0.1 or 0.0.0.0");
  }

  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
    throw new Error("Docker ownership smoke requires a POSIX host");
  }

  const temp = await mkdtemp(join(tmpdir(), "zosma-docker-smoke-"));
  const workspace = join(temp, "workspace");
  const state = join(temp, "pi-state");
  await mkdir(workspace);
  await mkdir(state);
  const port = await freePort();
  const daemonToken = randomUUID();
  const lanMode = values.bind === "0.0.0.0";
  const webPassword = lanMode ? randomUUID() : "";
  const allowedHost = lanMode ? "cowork.example.test" : "127.0.0.1";
  const authorization = lanMode ? basicAuthorization(webPassword) : undefined;
  const project = `zosma-smoke-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const composeArgs = ["compose", "-p", project, "-f", composeFile];
  const env = {
    ...process.env,
    ZOSMA_IMAGE: values.image,
    ZOSMA_BIND_ADDRESS: values.bind,
    ZOSMA_PORT: String(port),
    ZOSMA_UID: String(uid),
    ZOSMA_GID: String(gid),
    ZOSMA_WORKSPACE: workspace,
    ZOSMA_PI_STATE: state,
    ZOSMA_DAEMON_TOKEN: daemonToken,
    PI_WEB_PASSWORD: webPassword,
    PI_WEB_ALLOWED_HOSTS: allowedHost,
  };
  const compose = (...args) => run("docker", [...composeArgs, ...args], { env });

  try {
    await compose("up", "-d", "--no-build");
    await waitForHealth({ port, host: allowedHost, authorization });

    const { stdout: containerId } = await compose("ps", "-q", "cowork");
    await waitForContainerHealth(containerId.trim());
    const [container] = JSON.parse((await run(
      "docker",
      ["inspect", containerId.trim()],
    )).stdout);
    const [image] = JSON.parse((await run(
      "docker",
      ["image", "inspect", values.image],
    )).stdout);
    assertImagePolicy(image);
    assertContainerPolicy(container, {
      uid,
      gid,
      bindAddress: values.bind,
      daemonToken,
      webPassword,
    });

    assert.equal((await request({
      port,
      host: allowedHost,
      authorization,
    })).status, 200);
    assert.equal((await request({
      port,
      host: "unknown.example.test",
      authorization,
    })).status, 403);
    if (lanMode) {
      assert.equal((await request({
        port,
        host: allowedHost,
      })).status, 401);
    }

    await compose("exec", "-T", "cowork", "git", "init", "/workspace");
    const validate = await request({
      port,
      host: allowedHost,
      authorization,
      method: "POST",
      path: "/api/cwd/validate",
      body: { cwd: "/workspace" },
    });
    assert.equal(validate.status, 200, validate.body);
    const gitStatus = await request({
      port,
      host: allowedHost,
      authorization,
      path: `/api/git/status?cwd=${encodeURIComponent("/workspace")}`,
    });
    assert.equal(gitStatus.status, 200, gitStatus.body);

    await compose(
      "exec", "-T", "cowork",
      "node", "-e",
      "require('node:fs').writeFileSync('/workspace/container-write','ok')",
    );
    if (process.platform === "linux") {
      const created = await stat(join(workspace, "container-write"));
      assert.equal(created.uid, uid);
      assert.equal(created.gid, gid);
    }

    await compose(
      "exec", "-T", "cowork",
      "node", "-e",
      "require('node:fs').writeFileSync('/data/pi-agent/persisted','kept')",
    );
    await compose("down", "--remove-orphans");
    await compose("up", "-d", "--no-build");
    await waitForHealth({ port, host: allowedHost, authorization });
    assert.equal(await readFile(join(state, "persisted"), "utf8"), "kept");

    const logs = (await compose("logs", "--no-color", "cowork")).stdout;
    for (const secret of [daemonToken, webPassword].filter(Boolean)) {
      assert.equal(logs.includes(secret), false);
      assert.equal(logs.includes(secret.slice(0, 6)), false);
    }
    process.stdout.write(`docker smoke passed: ${values.image} (${values.bind})\n`);
  } finally {
    await compose("down", "--remove-orphans").catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
```

Keep secrets only in the child environment. The smoke runner must never include them in command arguments, its success line, or failure diagnostics.

- [ ] **Step 4: Add the focused root commands**

Add these scripts to the root `package.json`:

```json
"docker:smoke": "node scripts/docker-smoke.mjs",
"test:docker": "node --test 'scripts/docker/*.test.mjs'"
```

Do not add Docker tests to `test:server`; Phase 1's four-host archive matrix includes macOS runners without Docker Engine.

- [ ] **Step 5: Run the helper and static contract tests**

Run:

```bash
pnpm test:docker
```

Expected: all Compose, image, and smoke-helper tests pass without building an image.

- [ ] **Step 6: Build the local production image**

Run:

```bash
docker build \
  --build-arg ZOSMA_VERSION=v0.0.0-ci \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --tag zosma-cowork:phase2 \
  .
```

Expected: PASS. The build runs the Phase 1 packager inside the builder and produces `zosma-cowork:phase2`.

- [ ] **Step 7: Smoke loopback and LAN publication**

Run:

```bash
pnpm docker:smoke --image zosma-cowork:phase2 --bind 127.0.0.1
pnpm docker:smoke --image zosma-cowork:phase2 --bind 0.0.0.0
```

Expected: both commands print `docker smoke passed`. They prove non-root execution, Git availability, authenticated health, host allowlisting, workspace ownership, state persistence, fixed mounts, forbidden privilege absence, and secret redaction.

- [ ] **Step 8: Commit the Docker smoke runner**

```bash
git add scripts/docker-smoke.mjs scripts/docker/smoke-helpers.test.mjs package.json
git commit -m "test: smoke production Docker runtime"
```

### Task 4: Add non-publishing Docker verification to normal CI

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/docker/ci-contract.test.mjs`

- [ ] **Step 1: Write a failing normal-CI contract test**

Create `scripts/docker/ci-contract.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

test("normal CI builds without publishing a production image", () => {
  assert.match(workflow, /^  docker:/m);
  assert.match(workflow, /docker build[\s\S]*--tag zosma-cowork:ci/);
  assert.doesNotMatch(workflow, /docker push|packages:\s*write/);
});

test("normal CI checks both loopback and LAN container modes", () => {
  assert.match(workflow, /docker:smoke --image zosma-cowork:ci --bind 127\.0\.0\.1/);
  assert.match(workflow, /docker:smoke --image zosma-cowork:ci --bind 0\.0\.0\.0/);
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```bash
node --test scripts/docker/ci-contract.test.mjs
```

Expected: FAIL because `.github/workflows/ci.yml` has no `docker` job.

- [ ] **Step 3: Add the normal-CI Docker job**

Append this job under `jobs:` in `.github/workflows/ci.yml` without changing existing jobs:

```yaml
  docker:
    name: Production Docker image
    runs-on: ubuntu-22.04
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6

      - name: Setup Node
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version: 24

      - name: Setup pnpm
        run: |
          corepack enable
          corepack prepare pnpm@10.33.2 --activate

      - name: Verify Docker and Compose contracts
        run: pnpm test:docker

      - name: Build local image
        run: |
          docker build \
            --build-arg ZOSMA_VERSION=v0.0.0-ci \
            --build-arg VCS_REF="$GITHUB_SHA" \
            --tag zosma-cowork:ci \
            .

      - name: Smoke loopback mode
        run: pnpm docker:smoke --image zosma-cowork:ci --bind 127.0.0.1

      - name: Smoke LAN mode
        run: pnpm docker:smoke --image zosma-cowork:ci --bind 0.0.0.0
```

The new Docker job uses immutable action pins. Converting untouched jobs in the existing CI workflow remains Phase 4 workflow-hardening scope.

- [ ] **Step 4: Run the CI contract and Docker unit tests**

Run:

```bash
pnpm test:docker
```

Expected: all tests pass, including the normal-CI source assertions.

- [ ] **Step 5: Commit normal-CI verification**

```bash
git add .github/workflows/ci.yml scripts/docker/ci-contract.test.mjs
git commit -m "ci: verify production Docker image"
```

### Task 5: Publish native platform digests and merge the exact tag

**Files:**
- Create: `scripts/docker/server-release-workflow.test.mjs`
- Create: `.github/workflows/server-release.yml`

- [ ] **Step 1: Write the failing workflow trust-boundary tests**

Create `scripts/docker/server-release-workflow.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "server-release.yml");
const workflow = readFileSync(workflowPath, "utf8");

const pins = [
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  "actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131",
  "docker/login-action@dbcb813823bdd20940b903addbd779551569679f",
  "docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e",
  "docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a",
];

test("server release runs independently on canonical version tags", () => {
  assert.match(workflow, /push:[\s\S]*tags:[\s\S]*"v\*\.\*\.\*"/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/releases\/tags\/\$\{TAG\}"/);
  assert.match(workflow, /\.draft == false and \.prerelease == false/);
});

test("server release grants only read-content and scoped package publication", () => {
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /packages: write/);
  assert.doesNotMatch(workflow, /contents: write|id-token: write|attestations: write/);
});

test("server release pins every action dependency to an immutable SHA", () => {
  for (const pin of pins) assert.match(workflow, new RegExp(pin.replaceAll("/", "\\/")));
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d/);
});

test("server release builds and smokes native amd64 and arm64 digests before tagging", () => {
  assert.match(workflow, /platform: linux\/amd64/);
  assert.match(workflow, /platform: linux\/arm64/);
  assert.match(workflow, /runner: ubuntu-22\.04-arm/);
  assert.match(workflow, /push-by-digest=true/);
  assert.match(workflow, /docker:smoke --image "\$\{IMAGE_NAME\}@\$\{DIGEST\}"/);
  assert.match(workflow, /imagetools create --tag "\$\{IMAGE_NAME\}:\$\{TAG\}"/);
});

test("server release records one top-level digest without promoting latest", () => {
  assert.match(workflow, /image-reference\.txt/);
  assert.match(workflow, /docker buildx imagetools inspect/);
  assert.match(workflow, /existing exact tag points to different platform digests/);
  assert.match(workflow, /docker logout ghcr\.io/);
  assert.match(workflow, /docker pull "\$\{IMAGE_NAME\}@\$\{DIGEST\}"/);
  assert.doesNotMatch(workflow, /zosma-cowork:latest|type=raw,value=latest/);
});

test("Phase 2 workflow does not alter GitHub releases or stable installer assets", () => {
  assert.doesNotMatch(workflow, /gh release (upload|edit)|upload-release-asset|install-manifest|install\.zosma\.ai/);
});
```

- [ ] **Step 2: Run the workflow tests and verify the expected failure**

Run:

```bash
node --test scripts/docker/server-release-workflow.test.mjs
```

Expected: FAIL because `.github/workflows/server-release.yml` does not exist.

- [ ] **Step 3: Add the independent server-image workflow**

Create `.github/workflows/server-release.yml`:

```yaml
name: Server Release

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: read

env:
  IMAGE_NAME: ghcr.io/zosmaai/zosma-cowork

jobs:
  wait-for-desktop-release:
    name: Wait for published desktop release
    runs-on: ubuntu-22.04
    timeout-minutes: 125
    steps:
      - name: Validate tag and wait for matching release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ github.ref_name }}
        run: |
          set -euo pipefail
          if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
            echo "::error::server release requires a canonical v-prefixed semantic version"
            exit 1
          fi
          for attempt in $(seq 1 120); do
            release="$(gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${TAG}" 2>/dev/null || true)"
            if jq -e '.draft == false and .prerelease == false' <<<"$release" >/dev/null 2>&1; then
              echo "desktop release ${TAG} is published"
              exit 0
            fi
            echo "desktop release ${TAG} is not published yet (${attempt}/120)"
            sleep 60
          done
          echo "::error::timed out waiting for published desktop release ${TAG}"
          exit 1

  build-platform:
    name: Build and smoke (${{ matrix.platform }})
    needs: wait-for-desktop-release
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 90
    permissions:
      contents: read
      packages: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - runner: ubuntu-22.04
            platform: linux/amd64
            artifact: linux-amd64
          - runner: ubuntu-22.04-arm
            platform: linux/arm64
            artifact: linux-arm64
    steps:
      - name: Check out source
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6

      - name: Setup Node
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version: 24

      - name: Setup pnpm
        run: |
          corepack enable
          corepack prepare pnpm@10.33.2 --activate

      - name: Setup Docker Buildx
        uses: docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e # v4

      - name: Login to GHCR
        uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Verify Docker contracts
        run: pnpm test:docker

      - name: Build and push platform digest
        id: build
        uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7
        with:
          context: .
          platforms: ${{ matrix.platform }}
          build-args: |
            ZOSMA_VERSION=${{ github.ref_name }}
            VCS_REF=${{ github.sha }}
          outputs: type=image,name=${{ env.IMAGE_NAME }},push-by-digest=true,name-canonical=true,push=true
          provenance: false
          sbom: false

      - name: Smoke pushed platform digest
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: pnpm docker:smoke --image "${IMAGE_NAME}@${DIGEST}" --bind 127.0.0.1

      - name: Record platform digest
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: |
          set -euo pipefail
          [[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]
          mkdir -p digest
          touch "digest/${DIGEST#sha256:}"

      - name: Upload platform digest
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6
        with:
          name: digest-${{ matrix.artifact }}
          path: digest/*
          if-no-files-found: error
          retention-days: 1

  merge-manifest:
    name: Publish exact multi-architecture tag
    needs: build-platform
    runs-on: ubuntu-22.04
    timeout-minutes: 30
    permissions:
      actions: read
      contents: read
      packages: write
    steps:
      - name: Setup Docker Buildx
        uses: docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e # v4

      - name: Login to GHCR
        uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Download platform digests
        uses: actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7
        with:
          pattern: digest-linux-*
          path: digests
          merge-multiple: true

      - name: Create exact tag and verify manifest
        env:
          TAG: ${{ github.ref_name }}
        run: |
          set -euo pipefail
          mapfile -t files < <(find digests -maxdepth 1 -type f -printf '%f\n' | sort)
          if [ "${#files[@]}" -ne 2 ]; then
            echo "::error::expected exactly two platform digests"
            exit 1
          fi
          sources=()
          expected_digests=""
          for digest in "${files[@]}"; do
            [[ "$digest" =~ ^[a-f0-9]{64}$ ]]
            sources+=("${IMAGE_NAME}@sha256:${digest}")
            expected_digests+="sha256:${digest}"$'\n'
          done
          expected_digests="$(sort <<<"$expected_digests" | sed '/^$/d')"

          if manifest="$(docker buildx imagetools inspect "${IMAGE_NAME}:${TAG}" --raw 2>/dev/null)"; then
            actual_digests="$(
              jq -r '
                .manifests[]
                | select(.platform.os == "linux"
                  and (.platform.architecture == "amd64" or .platform.architecture == "arm64"))
                | .digest
              ' <<<"$manifest" | sort
            )"
            if [ "$actual_digests" != "$expected_digests" ]; then
              echo "::error::existing exact tag points to different platform digests"
              exit 1
            fi
            echo "exact tag already contains the verified platform digests"
          else
            docker buildx imagetools create --tag "${IMAGE_NAME}:${TAG}" "${sources[@]}"
            manifest="$(docker buildx imagetools inspect "${IMAGE_NAME}:${TAG}" --raw)"
          fi

          jq -e '
            [.manifests[].platform
              | select(.os == "linux" and (.architecture == "amd64" or .architecture == "arm64"))
              | .architecture]
            | unique | sort == ["amd64", "arm64"]
          ' <<<"$manifest" >/dev/null
          DIGEST="$(
            docker buildx imagetools inspect "${IMAGE_NAME}:${TAG}" --format '{{json .Manifest}}'
              | jq -r '.digest'
          )"
          [[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]
          {
            echo "version=${TAG}"
            echo "image=${IMAGE_NAME}"
            echo "digest=${DIGEST}"
            echo "reference=${IMAGE_NAME}@${DIGEST}"
          } > image-reference.txt
          echo "DIGEST=${DIGEST}" >> "$GITHUB_ENV"

      - name: Verify anonymous digest pull
        run: |
          set -euo pipefail
          docker logout ghcr.io
          if ! docker pull "${IMAGE_NAME}@${DIGEST}"; then
            echo "::error::GHCR package must be Public; change package visibility and rerun this job"
            exit 1
          fi

      - name: Upload immutable image reference
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6
        with:
          name: zosma-cowork-image-${{ github.ref_name }}
          path: image-reference.txt
          if-no-files-found: error
          retention-days: 30
```

Do not add QEMU: both supported images build and smoke on matching native GitHub runners. Provenance and SBOM outputs are explicitly disabled here so each native build yields one image-manifest digest that can be compared during an idempotent rerun; Phase 4 adds the required release attestations. Do not add `latest`, semver-major/minor aliases, GitHub Release uploads, or a stable manifest in this phase.

- [ ] **Step 4: Run the workflow trust-boundary tests**

Run:

```bash
node --test scripts/docker/server-release-workflow.test.mjs
```

Expected: all 5 workflow tests pass.

- [ ] **Step 5: Validate workflow syntax and references locally**

Run:

```bash
pnpm test:docker
git diff --check
git diff -- .github/workflows/release.yml
```

Expected: Docker tests pass, whitespace is clean, and the final command prints nothing because the desktop release workflow is untouched.

If `actionlint` is already installed, also run:

```bash
actionlint .github/workflows/server-release.yml
```

Expected: PASS. Do not add an actionlint installer or dependency solely for this phase.

- [ ] **Step 6: Commit the independent server release workflow**

```bash
git add .github/workflows/server-release.yml scripts/docker/server-release-workflow.test.mjs
git commit -m "ci: publish exact GHCR server images"
```

- [ ] **Step 7: Run the full Phase 2 local gate**

Run:

```bash
pnpm test:docker
pnpm test:server
pnpm -C apps/daemon test
pnpm -C apps/daemon typecheck
pnpm -C apps/web test
pnpm -C apps/web typecheck
pnpm -C packages/protocol test
pnpm -C packages/protocol typecheck
pnpm lint
pnpm typecheck
git diff --check
git status --short --branch
```

Expected: all commands pass and the worktree is clean after the five implementation commits. The web launcher may emit its existing warning that it binds `0.0.0.0` inside the isolated container when loopback-only exposure is enforced by Docker's published-port binding.

The local Docker daemon can additionally repeat the Task 3 build and both smoke commands before pushing this branch. The two external gates that cannot be completed from a local checkout are:

1. The normal `Production Docker image` CI job passes on the branch.
2. A canonical release tag causes the independent workflow to wait for the matching published desktop release, smoke both native platform digests, publish only `ghcr.io/zosmaai/zosma-cowork:<exact-tag>`, verify anonymous digest pull, and retain `image-reference.txt` as a workflow artifact.

If the first GHCR run fails only at anonymous pull, an organization owner must set package visibility to Public and rerun the failed job. A server workflow failure must not edit, retract, or block the desktop release.
