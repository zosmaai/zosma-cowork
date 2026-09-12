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

export function assertNoSecrets(text, secrets) {
  for (const secret of secrets.filter(Boolean)) {
    assert.equal(text.includes(secret), false, "secret material appeared in logs");
    assert.equal(text.includes(secret.slice(0, 6)), false, "secret material appeared in logs");
  }
}

export function assertContainerPolicy(container, {
  uid,
  gid,
  bindAddress,
  daemonToken,
  webPassword,
}) {
  if (!uid || !gid) throw new Error("container must not run as root");
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
    assertNoSecrets((await compose("logs", "--no-color", "cowork")).stdout, [daemonToken, webPassword]);
    await compose("down", "--remove-orphans");
    await compose("up", "-d", "--no-build");
    await waitForHealth({ port, host: allowedHost, authorization });
    assert.equal(await readFile(join(state, "persisted"), "utf8"), "kept");

    const logs = (await compose("logs", "--no-color", "cowork")).stdout;
    assertNoSecrets(logs, [daemonToken, webPassword]);
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