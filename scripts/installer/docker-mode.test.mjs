import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeHarness } from "./test-helpers.mjs";

const VERSION = "v1.2.3";
const IMAGE = `ghcr.io/zosmaai/zosma-cowork@sha256:${"a".repeat(64)}`;

function fixture(t) {
  const h = makeHarness();
  t.after(() => h.cleanup());
  const workspace = join(h.root, "workspace");
  mkdirSync(workspace, { recursive: true });
  h.makeCLI(VERSION, { scriptBody: "exit 0" });
  h.makeManifest({ version: VERSION, overrides: { docker_image: IMAGE } });
  h.write("fixtures/stable", h.read("fixtures/manifest.txt"));
  h.write("fixtures/install-manifest.txt", h.read("fixtures/manifest.txt"));
  return { h, workspace };
}

function dockerPlan() {
  return [
    'case "$1 $2" in',
    '  "compose version") printf "Docker Compose version v2.30.0\\n" ;;',
    '  "image inspect") printf "%s\\n" "$ZOSMA_TEST_IMAGE" ;;',
    'esac',
    "exit 0",
  ].join("\n");
}

test("docker install requires Docker and Compose before writing mode files", (t) => {
  const { h, workspace } = fixture(t);
  h.plan("docker", "exit 1\n");
  const r = h.runCLI(["install", "--mode", "docker", "--workspace", workspace, "--yes", "--no-start"], {
    env: { ZOSMA_TEST_IMAGE: IMAGE, ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` },
  });
  assert.equal(r.status, 3);
  assert.equal(existsSync(join(h.config, "zosma-cowork", "config")), false);
});

test("docker no-start pulls and verifies the exact digest, then emits private Compose", (t) => {
  const { h, workspace } = fixture(t);
  h.plan("docker", dockerPlan());
  const r = h.runCLI(["install", "--mode", "docker", "--workspace", workspace, "--yes", "--no-start"], {
    env: { ZOSMA_TEST_IMAGE: IMAGE, ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` },
  });
  assert.equal(r.status, 0, r.stderr);
  const calls = h.cmdLog("docker").map((c) => c.args.join(" ")).join("\n");
  assert.match(calls, new RegExp(`pull.*${IMAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(calls, /image inspect/);
  assert.equal(existsSync(join(h.config, "zosma-cowork", "docker", "compose.yml")), true);
  const compose = readFileSync(join(h.config, "zosma-cowork", "docker", "compose.yml"), "utf8");
  assert.match(readFileSync(join(h.config, "zosma-cowork", "config"), "utf8"), new RegExp(IMAGE));
  assert.match(compose, /target: \/workspace/);
  assert.match(readFileSync(join(h.config, "zosma-cowork", "config"), "utf8"), /^MODE=docker$/m);
  assert.doesNotMatch(calls, /latest|docker run/);
});

test("docker lifecycle uses one fixed Compose project and file", (t) => {
  const { h, workspace } = fixture(t);
  h.plan("docker", dockerPlan());
  const env = { ZOSMA_TEST_IMAGE: IMAGE, ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` };
  const install = h.runCLI(["install", "--mode", "docker", "--workspace", workspace, "--yes", "--no-start"], { env });
  assert.equal(install.status, 0, install.stderr);
  h.plan("docker", dockerPlan());
  h.plan("curl", "exit 0\n");
  const start = h.runCLI(["start"], { env: {} });
  assert.equal(start.status, 0, start.stderr);
  const calls = h.cmdLog("docker").map((c) => c.args.join(" ")).join("\n");
  assert.match(calls, /compose -p zosma-cowork -f .*compose\.yml up -d/);
});

test("docker serve is rejected with guidance", (t) => {
  const { h, workspace } = fixture(t);
  h.writeConfig({ MODE: "docker", VERSION: VERSION, PORT: "30141", BIND_ADDRESS: "127.0.0.1", ALLOWED_HOST: "127.0.0.1", PI_DIR: join(h.data, "docker", "pi-agent"), WORKSPACE: workspace, IMAGE, SERVICE_MANAGER: "none" });
  h.writeSecrets({ DAEMON_TOKEN: "a".repeat(64), WEB_PASSWORD: "" });
  const r = h.runCLI(["serve"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /docker|start/i);
});
