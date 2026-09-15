import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeHarness } from "./test-helpers.mjs";

const VERSION = "v1.2.3";

function fixture(t) {
  const h = makeHarness();
  t.after(() => h.cleanup());
  h.makeArchive({ version: VERSION, target: "linux-x64" });
  h.makeCLI(VERSION, { scriptBody: "exit 0" });
  h.makeManifest({ version: VERSION });
  h.write("fixtures/stable", h.read("fixtures/manifest.txt"));
  h.write("fixtures/install-manifest.txt", h.read("fixtures/manifest.txt"));
  return h;
}

async function installLocal(h) {
  return h.runCLI(["install", "--mode", "local", "--yes", "--no-start"], {
    env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` },
  });
}

test("ordinary local uninstall removes only installer files and preserves Pi data", async (t) => {
  const h = fixture(t);
  const pi = join(h.root, "pi");
  mkdirSync(pi, { recursive: true });
  writeFileSync(join(pi, "keep.txt"), "keep");
  const r = await installLocal(h);
  assert.equal(r.status, 0, r.stderr);
  const uninstall = h.runCLI(["uninstall", "--yes"]);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(existsSync(join(h.config, "zosma-cowork", "config")), false);
  assert.equal(existsSync(join(h.data, "zosma-cowork", "cli", "current")), false);
  assert.equal(readFileSync(join(pi, "keep.txt"), "utf8"), "keep");
});

test("uninstall dry-run prints an allowlist without deleting", (t) => {
  const h = fixture(t);
  const r = h.runCLI(["uninstall", "--dry-run"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /config|generations|allowlist/i);
  assert.equal(existsSync(join(h.config, "zosma-cowork", "config")), false);
});

test("purge-data requires explicit TTY confirmation even with --yes", (t) => {
  const h = fixture(t);
  h.writeConfig({ MODE: "docker", VERSION, PORT: "30141", BIND_ADDRESS: "127.0.0.1", ALLOWED_HOST: "127.0.0.1", PI_DIR: join(h.data, "docker", "pi-agent"), WORKSPACE: h.root, IMAGE: `ghcr.io/zosmaai/zosma-cowork@sha256:${"d".repeat(64)}`, SERVICE_MANAGER: "none" });
  h.writeSecrets({ DAEMON_TOKEN: "a".repeat(64), WEB_PASSWORD: "" });
  mkdirSync(join(h.data, "docker", "pi-agent"), { recursive: true });
  writeFileSync(join(h.data, "docker", "pi-agent", "keep"), "keep");
  const r = h.runCLI(["uninstall", "--purge-data", "--yes"]);
  assert.equal(r.status, 6);
  assert.equal(existsSync(join(h.data, "docker", "pi-agent", "keep")), true);
});

test("no-config recovery removes only a marked CLI generation", (t) => {
  const h = fixture(t);
  const gen = join(h.data, "zosma-cowork", "cli", "versions", VERSION, "generations", "generation-0001");
  mkdirSync(gen, { recursive: true });
  writeFileSync(join(h.data, "zosma-cowork", "cli", "versions", VERSION, ".zosma-cowork-owned"), "ZOSMA_COWORK_INSTALLER_SCHEMA=1\n");
  writeFileSync(join(gen, ".zosma-cowork-owned"), "ZOSMA_COWORK_INSTALLER_SCHEMA=1\n");
  writeFileSync(join(gen, "zosma"), "#!/bin/sh\nexit 0\n");
  const current = join(h.data, "zosma-cowork", "cli", "current");
  mkdirSync(join(h.data, "zosma-cowork", "cli"), { recursive: true });
  symlinkSync(gen, current);
  const r = h.runCLI(["uninstall", "--yes"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(gen), false);
  assert.equal(existsSync(current), false);
});
