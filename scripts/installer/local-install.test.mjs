import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeHarness, randomHex, VERSION_RE } from "./test-helpers.mjs";

const VERSION = "v1.2.3";
const TOKEN = randomHex(64);

function baseHarness(t) {
  const h = makeHarness();
  t.after(() => h.cleanup());
  return h;
}

const TRUE_SYSTEMD = 'printf "PATH=%s\\n" "$HOME"/.local/bin\\nsystemctl --user show-environment\\n';
const TRUE_LAUNCHD = 'printf "gui/%s\\n" "$(id -u)"\\n';

function hostTuple() {
  return `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
}

function localFixture(t, { platform = hostTuple(), mode = "local", extra = {} } = {}) {
  const h = baseHarness(t);
  const archive = h.makeArchive({ version: VERSION, target: platform });
  const cli = h.makeCLI(VERSION, { scriptBody: "exit 0" });
  // makeManifest auto-defaults cli; overwrite with ours
  const mf = h.makeManifest({ version: VERSION });
  h.write("fixtures/stable", h.read("fixtures/manifest.txt"));
  h.write("fixtures/install-manifest.txt", h.read("fixtures/manifest.txt"));
  h.write("fixtures/SHA256SUMS", h.read("fixtures/SHA256SUMS"));
  return { h, mf, archive, cli };
}

const installArgs = [
  "install", "--mode", "local", "--yes", "--no-start",
];

function configPath(h) {
  return join(h.config, "zosma-cowork", "config");
}

function secretsPath(h) {
  return join(h.config, "zosma-cowork", "secrets");
}

function currentPath(h) {
  return join(h.data, "zosma-cowork", "cli", "current");
}

function runtimeCurrent(h) {
  return join(h.data, "zosma-cowork", "runtime", "current");
}

function launcherPath(h) {
  return join(h.home, ".local", "bin", "zosma");
}

test("fresh local install downloads, verifies, and activates a unique generation", (t) => {
  const { h, archive } = localFixture(t);
  const r = h.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(r.status, 0, r.stderr);
  // config is the sole active-mode record
  const config = h.read("config/zosma-cowork/config");
  assert.match(config, /^CONFIG_SCHEMA=1$/m);
  assert.match(config, /^MODE=local$/m);
  assert.match(config, /^VERSION=v1\.2\.3$/m);
  assert.match(config, /^PORT=30141$/m);
  assert.match(config, /^BIND_ADDRESS=127\.0\.0\.1$/m);
  assert.match(config, /^ALLOWED_HOST=127\.0\.0\.1$/m);
  assert.match(config, /^SERVICE_MANAGER=(none|systemd|launchd)$/m);
  // secrets: protected, generated daemon token, empty loopback password
  const secrets = readFileSync(secretsPath(h), "utf8");
  assert.match(secrets, /^DAEMON_TOKEN=[0-9a-f]{64}$/m);
  assert.match(secrets, /^WEB_PASSWORD=$/m);
  assert.equal(statSync(secretsPath(h)).mode & 0o777, 0o600);
  assert.equal(statSync(configPath(h)).mode & 0o777, 0o600);
  const dirs = [h.config, h.data, h.state].map((d) => statSync(join(d, "zosma-cowork")).mode & 0o777);
  assert.ok(dirs.every((m2) => m2 === 0o700), `dir modes: ${dirs}`);
  // generations + current + launcher
  const gens = readdirSync(join(h.data, "zosma-cowork", "cli", "versions", VERSION, "generations"))
    .filter((e) => /^generation-\d{4}$/.test(e));
  assert.equal(gens.length, 1);
  const expectedCli = join(h.data, "zosma-cowork", "cli", "versions", VERSION, "generations", gens[0]);
  assert.equal(readlinkSync(currentPath(h)), expectedCli);
  const rtGens = readdirSync(join(h.data, "zosma-cowork", "runtime", "versions", VERSION, "generations"))
    .filter((e) => /^generation-\d{4}$/.test(e));
  assert.equal(rtGens.length, 1);
  assert.equal(readlinkSync(runtimeCurrent(h)), join(h.data, "zosma-cowork", "runtime", "versions", VERSION, "generations", rtGens[0]));
  assert.equal(readlinkSync(launcherPath(h)), join(currentPath(h), "zosma"));
  // runtime tree extracted and valid
  assert.ok(existsSync(join(h.data, "zosma-cowork", "runtime", "versions", VERSION, "generations", gens[0], "runtime", "bin", "node")));
  // journal removed after commit
  assert.equal(h.exists("state/zosma-cowork/transaction/journal"), false);
  // no secrets in output or command logs
  assert.doesNotMatch(r.stdout + r.stderr, /[0-9a-f]{64}/);
  for (const call of h.cmdLogAll()) {
    assert.doesNotMatch(JSON.stringify(call.args), /[0-9a-f]{64}/);
  }
});

test("corrupt archives and wrong VERSION return 4 before activation", (t) => {
  const { h, mf } = localFixture(t);
  // Rebuild the archive with a wrong VERSION entry, then refresh digests.
  h.remove(`fixtures/zosma-cowork-server-${VERSION}-linux-x64.tar.gz`);
  const bad = h.makeArchive({
    version: VERSION,
    target: "linux-x64",
    overrides: { versionContent: "v9.9.9\n" },
  });
  h.makeManifest({ version: VERSION });
  h.write("fixtures/stable", h.read("fixtures/manifest.txt"));
  const r = h.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(r.status, 4, r.stderr);
  assert.equal(h.exists("data/zosma-cowork"), false);
});

test("port occupied before activation returns 5 and leaves no active mode", async (t) => {
  const { h } = localFixture(t);
  const http = await import("node:http");
  const server = http.createServer();
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  const r = h.runCLI([...installArgs, "--port", String(port)], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(r.status, 5, r.stderr);
  assert.match(r.stderr, /port|occupied|listener/i);
  assert.equal(h.exists("data/zosma-cowork/cli/current"), false);
  assert.equal(h.exists("config/zosma-cowork/config"), false);
  server.close();
});

test("--no-start commits a stopped installation without health or browser commands", (t) => {
  const { h } = localFixture(t);
  const r = h.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(h.cmdLog("xdg-open"), []);
  assert.deepEqual(h.cmdLog("open"), []);
  // Downloads happen through the fixture curl, but no health probes.
  const allArgs = JSON.stringify(h.cmdLogAll());
  assert.doesNotMatch(allArgs, /api\/v1\/health/);
});

test("systemd manager lifetime selects the SERVICE_MANAGER and links a custom-XDG unit", (t) => {
  const { h } = localFixture(t);
  h.plan("systemctl", TRUE_SYSTEMD + "exit 0\n");
  const r = h.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(h.read("config/zosma-cowork/config"), /^SERVICE_MANAGER=systemd$/m);
  const unit = h.read("config/systemd/user/zosma-cowork.service");
  assert.match(unit, /ZOSMA_COWORK_INSTALLER_SCHEMA=1/);
  assert.match(unit, /ExecStart=/);
  assert.match(unit, /serve --service/);
  assert.doesNotMatch(unit, /DAEMON_TOKEN|WEB_PASSWORD/);
  const cmds = h.cmdLog("systemctl").map((c) => c.args.join(" "));
  assert.ok(cmds.some((c) => c.includes("link")), cmds.join("\n"));
  assert.ok(cmds.some((c) => c.includes("daemon-reload")), cmds.join("\n"));
  assert.ok(cmds.some((c) => c.includes("enable")), cmds.join("\n"));
});

test("no manager records SERVICE_MANAGER=none and installs no service definition", (t) => {
  const { h } = localFixture(t);
  h.plan("systemctl", "exit 1\n"); // no user manager
  const r = h.runCLI([...installArgs], {
    env: {
      ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt`,
      WSL_DISTRO_NAME: "none-needed",
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(h.read("config/zosma-cowork/config"), /^SERVICE_MANAGER=none$/m);
  assert.equal(h.exists("config/systemd/user/zosma-cowork.service"), false, "no unit for SERVICE_MANAGER=none");
  assert.match(r.stdout, /zosma serve/);
});

test("pre-existing unmarked collisions are refused without overwrite", (t) => {
  const { h } = localFixture(t);
  h.write("data/zosma-cowork/cli/.zosma-cowork-owned", "WRONG MARKER!\n");
  const r = h.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(r.status, 1, "unmarked collision must be refused");
  assert.equal(h.read("data/zosma-cowork/cli/.zosma-cowork-owned"), "WRONG MARKER!\n");
  assert.equal(h.exists("config/zosma-cowork/config"), false);
});

test("serve exposes the exact runtime environment and maps non-zero exits to 5", (t) => {
  const { h } = localFixture(t);
  h.plan("systemctl", "exit 1\n");
  const install = h.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(install.status, 0, install.stderr);
  // The fixture supervisor captures its environment.
  const capture = join(h.root, "serve-capture");
  const serveArgs = ["serve"];
  const r = h.runCLI(serveArgs, { env: { ZOSMA_FIXTURE_CAPTURE_DIR: capture }, timeoutMs: 15000 });
  assert.equal(r.status, 0, r.stderr);
  const captured = readFileSync(join(capture, "env"), "utf8");
  const field = (k) => captured.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1);
  assert.equal(field("PORT"), "30141");
  assert.equal(field("PI_WEB_HOSTNAME"), "127.0.0.1");
  assert.equal(field("PI_WEB_ALLOWED_HOSTS"), "127.0.0.1");
  assert.equal(field("PI_WEB_PASSWORD"), "");
  assert.equal(field("PI_CODING_AGENT_DIR"), join(h.home, ".pi", "agent"));
  assert.equal(field("PI_WEB_NO_OPEN"), "1");
  assert.equal(field("ZOSMA_DAEMON_PORT"), "64713");
  assert.match(field("ZOSMA_DAEMON_TOKEN"), /^[0-9a-f]{64}$/);
  assert.ok(field("ZOSMA_DAEMON_DATA_DIR"));

  // Any non-zero supervisor exit maps to 5.
  const { h: h2 } = localFixture(t);
  h2.plan("systemctl", "exit 1\n");
  const install2 = h2.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h2.fixtures}/manifest.txt` } });
  assert.equal(install2.status, 0, install2.stderr);
  const r2 = h2.runCLI(["serve"], { env: { ZOSMA_FIXTURE_EXIT: "7" }, timeoutMs: 15000 });
  assert.equal(r2.status, 5, r2.stderr);
});

test("process death after every fresh-local journal phase recovers to no active mode", async (t) => {
  const fs = await import("node:fs");
  for (const phase of ["prepared", "old_stopped", "runtime_switched", "cli_switched", "config_switched"]) {
    const { h } = localFixture(t);
    h.plan("systemctl", "exit 1\n");
    // Let the install proceed until the journal exists at the target phase by
    // killing the process after the journal file appears with that phase.
    const child = h.spawnCLI([...installArgs], {
      env: {
        ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt`,
        ZOSMA_TEST_PHASE_DELAY: "0.15",
      },
    });
    const childExit = new Promise((resolve) => child.once("exit", resolve));
    const journal = join(h.state, "zosma-cowork", "transaction", "journal");
    const versionDir = join(h.data, "zosma-cowork", "runtime", "versions", VERSION);
    const deadline = Date.now() + 15000;
    let killed = false;
    while (Date.now() < deadline) {
      let sawPhase = false;
      if (existsSync(journal)) {
        const text = readFileSync(journal, "utf8");
        sawPhase = new RegExp(`^PHASE=${phase}$`, "m").test(text);
        if (sawPhase) {
          child.kill("SIGKILL");
          killed = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    await childExit;
    assert.ok(killed, `journal phase ${phase} was never observed`);
    // Recovery on the next invocation returns to no active mode.
    const next = h.runCLI(["status"], { env: {} });
    assert.equal(next.status, 5, `phase ${phase}: ${next.stderr}`);
    assert.equal(h.exists("config/zosma-cowork/config"), false, `phase ${phase}`);
    assert.equal(h.exists(runtimeCurrent(h)), false, `phase ${phase}`);
  }
});

test("portable link replacement replaces an existing directory-target link rather than nesting", (t) => {
  const { h } = localFixture(t);
  const parent = join(h.data, "zosma-cowork", "cli");
  mkdirSync(parent, { recursive: true });
  // An existing `current` symlink pointing AT a directory.
  const oldTarget = join(h.data, "zosma-cowork", "cli", "old-dir");
  mkdirSync(oldTarget, { recursive: true });
  writeFileSync(join(oldTarget, "zosma"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  symlinkSync("old-dir", join(parent, "current"));
  const versionDir = join(h.data, "zosma-cowork", "cli", "versions", VERSION);
  mkdirSync(join(versionDir, "generations", "generation-0999"), { recursive: true });
  writeFileSync(join(versionDir, "generations", "generation-0999", "zosma"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(versionDir, ".zosma-cowork-owned"), "ZOSMA_COWORK_INSTALLER_SCHEMA=1\n");
  writeFileSync(join(h.data, "zosma-cowork", "cli", ".zosma-cowork-owned"), "ZOSMA_COWORK_INSTALLER_SCHEMA=1\n");
  // Run the CLI's own replacement helper through source mode.
  const script = [
    "resolve_roots",
    `cli_parent=$(dirname "$ZM_CLI_CURRENT")`,
    `replace_link "$ZM_CLI_VERSIONS/${VERSION}/generations/generation-0999" "$cli_parent" current`,
    "echo rc=$?",
  ].join("\n");
  const r = h.shSource(script);
  assert.equal(r.stdout.trim(), "rc=0");
  // The link must point at the new target, not a nested link inside old-dir.
  assert.equal(readlinkSync(join(parent, "current")), join(versionDir, "generations", "generation-0999"));
});

test("no secrets leak into output, logs, or service arguments", (t) => {
  const { h } = localFixture(t);
  h.plan("systemctl", "exit 1\n");
  const r = h.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(r.status, 0, r.stderr);
  const everything = r.stdout + r.stderr + h.envLog() + JSON.stringify(h.cmdLogAll());
  const secrets = readFileSync(secretsPath(h), "utf8");
  const token = secrets.match(/DAEMON_TOKEN=([0-9a-f]{64})/)[1];
  assert.doesNotMatch(everything, new RegExp(token));
});