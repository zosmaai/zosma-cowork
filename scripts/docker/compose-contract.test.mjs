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