import assert from "node:assert/strict";
import { readFileSync, readdirSync, symlinkSync, readlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { makeHarness, INSTALL_SH, SH } from "./test-helpers.mjs";

const VERSION = "v1.2.3";

function baseHarness(t) {
  const h = makeHarness();
  t.after(() => h.cleanup());
  return h;
}

function delegateEnv(h) {
  return {
    ZOSMA_TEST_DELEGATE_LOG: join(h.root, "delegate-argv.log"),
    ZOSMA_TEST_DELEGATE_MANIFEST: join(h.root, "delegate-manifest.log"),
  };
}

function fixture(t, { cliBody, cli = {}, manifest = {} } = {}) {
  const h = baseHarness(t);
  h.makeCLI(VERSION, {
    scriptBody: cliBody ?? [
      'printf "%s\\n" "$@" > "$ZOSMA_TEST_DELEGATE_LOG"',
      '[ -n "${ZOSMA_INSTALL_MANIFEST:-}" ] || exit 9',
      'cat "$ZOSMA_INSTALL_MANIFEST" > "$ZOSMA_TEST_DELEGATE_MANIFEST"',
      "exit 0",
    ].join("\n"),
    ...cli,
  });
  const mf = h.makeManifest({ version: VERSION, overrides: manifest });
  h.write("fixtures/stable", h.read("fixtures/manifest.txt"));
  h.write("fixtures/install-manifest.txt", h.read("fixtures/manifest.txt"));
  return { h, mf };
}

function delegateArgs(h) {
  const p = join(h.root, "delegate-argv.log");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n") : [];
}

function manifestDelegated(h) {
  return readFileSync(join(h.root, "delegate-manifest.log"), "utf8");
}

function markerPath(h, name) {
  return join(h.root, name);
}

function assertNoActivation(h) {
  assert.equal(h.exists("data/zosma-cowork"), false);
  assert.equal(h.exists("config/zosma-cowork"), false);
  assert.equal(h.exists("state/zosma-cowork"), false);
}

function assertTmpClean(h) {
  assert.deepEqual(readdirSync(join(h.root, "tmpdir")), []);
}

function requireCurlFlags(args) {
  const joined = JSON.stringify(args);
  for (const flag of [
    "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2", "-f", "-L",
    "--connect-timeout", "--max-time",
  ]) {
    assert.ok(args.includes(flag), `missing curl flag ${flag} in ${joined}`);
  }
}

function symlinkRel(h, target, rel) {
  const segs = rel.split("/");
  mkdirSync(join(h.root, ...segs.slice(0, -1)), { recursive: true });
  symlinkSync(target, join(h.root, rel));
}

test("missing required commands return 3 before install paths exist", (t) => {
  for (const tool of ["curl", "uname", "mktemp", "tar"]) {
    const h = baseHarness(t);
    h.missingCommand(tool);
    const r = h.runInstallSh([], { env: delegateEnv(h) });
    assert.equal(r.status, 3, `${tool}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(tool));
    assertNoActivation(h);
  }
  const h = baseHarness(t);
  h.missingCommand("sha256sum");
  h.missingCommand("shasum");
  const r = h.runInstallSh([], { env: delegateEnv(h) });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /SHA-256/);
  assertNoActivation(h);
});

test("bootstrap only checks OS/architecture and delegates libc decisions to the candidate", (t) => {
  const { h } = fixture(t, {
    cliBody: [
      'case " $* " in *" local "*)',
      "  getconf GNU_LIBC_VERSION 2>/dev/null | grep -q glibc || exit 3",
      "  ;;",
      "esac",
      'printf "%s\\n" "$@" > "$ZOSMA_TEST_DELEGATE_LOG"',
      "exit 0",
    ].join("\n"),
  });
  h.plan("getconf", "exit 1"); // musl: getconf cannot report GNU libc

  const local = h.runInstallSh(["--mode", "local"], { env: delegateEnv(h) });
  assert.equal(local.status, 3, local.stderr);
  assertNoActivation(h);

  const docker = h.runInstallSh(["--mode", "docker"], { env: delegateEnv(h) });
  assert.equal(docker.status, 0, docker.stderr);
  assert.deepEqual(delegateArgs(h), ["install", "--mode", "docker"]);
});

test("stable and pinned installs request only their fixed manifest URLs", (t) => {
  const { h } = fixture(t);
  const stable = h.runInstallSh([], { env: delegateEnv(h) });
  assert.equal(stable.status, 0, stable.stderr);
  const [stableCall] = h.cmdLog("curl");
  assert.equal(stableCall.args[stableCall.args.length - 1], "https://install.zosma.ai/releases/stable");
  requireCurlFlags(stableCall.args);

  const { h: h2 } = fixture(t);
  const pinned = h2.runInstallSh(["--version", VERSION], { env: delegateEnv(h2) });
  assert.equal(pinned.status, 0, pinned.stderr);
  const [pinCall] = h2.cmdLog("curl");
  assert.equal(
    pinCall.args[pinCall.args.length - 1],
    `https://github.com/zosmaai/zosma-cowork/releases/download/${VERSION}/install-manifest.txt`,
  );
});

test("malformed, duplicate, incomplete, unknown-key, non-HTTPS, schema-mismatched manifests return 4", (t) => {
  const good = (() => {
    const h = baseHarness(t);
    h.makeCLI(VERSION);
    h.makeManifest({ version: VERSION });
    return h.read("fixtures/manifest.txt");
  })();
  const cases = {
    "malformed line": "this is not a manifest line\n",
    "duplicate key": "installer_schema=1\nversion=v1.2.3\nversion=v1.2.4\n" + good.slice(good.indexOf("installer_schema=1") + "installer_schema=1".length),
    "schema mismatch": good.replace("installer_schema=1", "installer_schema=2"),
    "unknown key": good + "evil_option=yes\n",
    "non-https cli_url": good.replace(
      `cli_url=https://github.com/zosmaai/zosma-cowork/releases/download/${VERSION}/zosma-${VERSION}`,
      `cli_url=http://insecure.example/zosma-${VERSION}`,
    ),
    "incomplete manifest": good.replace(/docker_image=.*\n/, ""),
  };
  for (const [name, content] of Object.entries(cases)) {
    const h = baseHarness(t);
    const badPath = h.write("fixtures/bad-manifest.txt", content, { mode: 0o600 });
    const r = h.runInstallSh([], {
      env: { ...delegateEnv(h), ZOSMA_TEST_MANIFEST_URL: `file://${badPath}` },
    });
    assert.equal(r.status, 4, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /error:/);
    assertNoActivation(h);
  }
});

test("a manifest containing shell syntax is treated as inert data", (t) => {
  const { h } = fixture(t);
  const sentinel = join(h.root, "shell-sentinel");
  const manifest = h.read("fixtures/manifest.txt")
    + `cli_sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; touch ${sentinel}\n`;
  const badPath = h.write("fixtures/evil-manifest.txt", manifest);
  const r = h.runInstallSh([], {
    env: { ...delegateEnv(h), ZOSMA_TEST_MANIFEST_URL: `file://${badPath}` },
  });
  assert.equal(r.status, 4);
  assert.equal(h.exists("shell-sentinel"), false);
});

test("fake curl enforces https-only flags and a refused redirect maps to 4", (t) => {
  const { h } = fixture(t);
  h.plan("curl", "exit 8");
  const r = h.runInstallSh([], { env: delegateEnv(h) });
  assert.equal(r.status, 4, r.stderr);
  assertNoActivation(h);
  const calls = h.cmdLog("curl");
  assert.ok(calls.length >= 1);
  requireCurlFlags(calls[0].args);
});

test("verification failures return 4 without changing any current target", (t) => {
  const h1 = fixture(t, { manifest: { cli_sha256: "0".repeat(64) } });
  assert.equal(h1.h.runInstallSh([], { env: delegateEnv(h1.h) }).status, 4);
  assertNoActivation(h1.h);

  const h2 = fixture(t);
  h2.h.write("fixtures/SHA256SUMS", h2.h.read("fixtures/SHA256SUMS").replace(
    /^[0-9a-f]{64} {2}zosma-v1\.2\.3$/m,
    `${"e".repeat(64)}  zosma-v1.2.3`,
  ));
  assert.equal(h2.h.runInstallSh([], { env: delegateEnv(h2.h) }).status, 4);

  const h3 = fixture(t);
  h3.h.write("fixtures/SHA256SUMS", `${h3.h.read("fixtures/SHA256SUMS")}${"f".repeat(64)}  zosma-v1.2.3\n`);
  assert.equal(h3.h.runInstallSh([], { env: delegateEnv(h3.h) }).status, 4);

  const h4 = fixture(t);
  h4.h.write("fixtures/SHA256SUMS", h4.h.read("fixtures/SHA256SUMS").replace(
    /^[0-9a-f]{64} {2}zosma-v1\.2\.3$/m,
    "not-a-checksum zosma-v1.2.3",
  ));
  assert.equal(h4.h.runInstallSh([], { env: delegateEnv(h4.h) }).status, 4);

  const h5 = fixture(t, {
    manifest: { cli_url: `https://github.com/zosmaai/zosma-cowork/releases/download/${VERSION}/zosma-wrongname` },
  });
  assert.equal(h5.h.runInstallSh([], { env: delegateEnv(h5.h) }).status, 4);

  const h6 = fixture(t);
  h6.h.makeCLI(VERSION, { scriptBody: "if [[ broken ]] then\n" });
  h6.h.makeManifest({ version: VERSION });
  h6.h.write("fixtures/stable", h6.h.read("fixtures/manifest.txt"));
  assert.equal(h6.h.runInstallSh([], { env: delegateEnv(h6.h) }).status, 4);

  const h7 = fixture(t);
  h7.h.makeCLI(VERSION, { machineVersion: "v9.9.9", scriptBody: "exit 0" });
  h7.h.makeManifest({ version: VERSION });
  h7.h.write("fixtures/stable", h7.h.read("fixtures/manifest.txt"));
  assert.equal(h7.h.runInstallSh([], { env: delegateEnv(h7.h) }).status, 4);

  for (const fx of [h1, h2, h3, h4, h5, h6, h7]) assertNoActivation(fx.h);
});

test("a valid CLI is invoked directly from the temporary directory with no prior activation", (t) => {
  const { h } = fixture(t);
  const r = h.runInstallSh([], { env: delegateEnv(h) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(delegateArgs(h), ["install"]);
  assertNoActivation(h);
  assertTmpClean(h);
});

test("a no-mode candidate that rejects local leaves no roots; Docker proceeds to candidate-owned activation", (t) => {
  const { h } = fixture(t, {
    cliBody: [
      'case " $* " in *" local "*) exit 3 ;; esac',
      'printf "%s\\n" "$@" > "$ZOSMA_TEST_DELEGATE_LOG"',
      "exit 0",
    ].join("\n"),
  });
  assert.equal(h.runInstallSh(["--mode", "local"], { env: delegateEnv(h) }).status, 3);
  assertNoActivation(h);
  assert.equal(h.runInstallSh(["--mode", "docker"], { env: delegateEnv(h) }).status, 0);
  assert.deepEqual(delegateArgs(h), ["install", "--mode", "docker"]);
  assertTmpClean(h);
});

test("bootstrap dry-run validates only release selection and the manifest", (t) => {
  const { h } = fixture(t);
  const r = h.runInstallSh(["--dry-run"], { env: delegateEnv(h) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /zosma-v1\.2\.3/);
  assert.match(r.stdout, /zosma install --dry-run/);
  const requested = h.cmdLog("curl").map((c) => c.args[c.args.length - 1]);
  assert.deepEqual(requested, ["https://install.zosma.ai/releases/stable"]);
  assertTmpClean(h);
  assertNoActivation(h);
});

test("temporary downloads disappear on success and failure", (t) => {
  const { h } = fixture(t);
  assert.equal(h.runInstallSh([], { env: delegateEnv(h) }).status, 0);
  assertTmpClean(h);

  const { h: hf } = fixture(t);
  hf.plan("curl", "exit 8");
  assert.equal(hf.runInstallSh([], { env: delegateEnv(hf) }).status, 4);
  assertTmpClean(hf);
  assertNoActivation(hf);
});

test("the bootstrap forwards INT and TERM to the delegated child and cleans up", async (t) => {
  for (const sig of ["SIGINT", "SIGTERM"]) {
    const { h } = fixture(t, {
      cliBody: [
        'printf started > "$ZOSMA_TEST_START_MARKER"',
        'trap \'printf stopped > "$ZOSMA_TEST_STOP_MARKER"; exit 0\' TERM',
        "while :; do sleep 1; done",
      ].join("\n"),
    });
    const sm = markerPath(h, "candidate-started");
    const sp = markerPath(h, "candidate-stopped");
    const proc = spawn(SH, [INSTALL_SH], {
      env: h.env({ ...delegateEnv(h), ZOSMA_TEST_START_MARKER: sm, ZOSMA_TEST_STOP_MARKER: sp }),
      stdio: ["ignore", "ignore", "pipe"],
    });
    const startedAt = Date.now();
    while (!existsSync(sm)) {
      if (Date.now() - startedAt > 15000) throw new Error(`candidate never started (${sig})`);
      await new Promise((r) => setTimeout(r, 50));
    }
    proc.kill(sig);
    const exit = await new Promise((r) => proc.once("exit", (code, signal) => r({ code, signal })));
    assert.equal(exit.code, sig === "SIGTERM" ? 143 : 130, `${sig}: ${exit.signal}`);
    assert.ok(existsSync(sp), `${sig} did not forward a catchable termination signal`);
    assertTmpClean(h);
  }
});

test("delegation preserves the exact candidate argv and supplies the manifest by environment", (t) => {
  const { h } = fixture(t);
  const r = h.runInstallSh(
    ["--mode", "local", "--port", "1234", "--workspace", "/a b/c"],
    { env: delegateEnv(h) },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(delegateArgs(h), ["install", "--mode", "local", "--port", "1234", "--workspace", "/a b/c"]);
  assert.equal(manifestDelegated(h), h.read("fixtures/manifest.txt"));
  assert.doesNotMatch(r.stdout + r.stderr, /zosma-install\./);
});

test("an existing installation stays active while the temporary candidate runs", (t) => {
  const { h } = fixture(t);
  const oldGen = "data/zosma-cowork/cli/versions/v1.2.3/generations/generation-0001";
  h.write(`${oldGen}/zosma`, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  h.write(`${oldGen}/.zosma-cowork-owned`, "ZOSMA_COWORK_INSTALLER_SCHEMA=1\n");
  h.write("data/zosma-cowork/cli/versions/v1.2.3/.zosma-cowork-owned", "ZOSMA_COWORK_INSTALLER_SCHEMA=1\n");
  h.write("data/zosma-cowork/cli/.zosma-cowork-owned", "ZOSMA_COWORK_INSTALLER_SCHEMA=1\n");
  h.write("data/zosma-cowork/.zosma-cowork-owned", "ZOSMA_COWORK_INSTALLER_SCHEMA=1\n");
  symlinkRel(h, "versions/v1.2.3/generations/generation-0001", "data/zosma-cowork/cli/current");
  symlinkSync(join(h.root, "data", "zosma-cowork", "cli", "current", "zosma"), join(h.root, "home", ".local", "bin", "zosma"));

  const r = h.runInstallSh([], { env: delegateEnv(h) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(delegateArgs(h), ["install"]);
  assert.equal(readlinkSync(join(h.root, "data/zosma-cowork/cli/current")), "versions/v1.2.3/generations/generation-0001");
  assert.ok(h.exists(`${oldGen}/zosma`));
  assert.ok(h.exists("home/.local/bin/zosma"));
  assertTmpClean(h);
});

test("every truncation before the final main line performs no write or command invocation", (t) => {
  const h = baseHarness(t);
  const source = readFileSync(INSTALL_SH, "utf8");
  const lines = source.split("\n");
  const cuts = new Set();
  lines.forEach((line, i) => {
    if (/^[a-z_][a-zA-Z_0-9]*\(\)\s*\{/.test(line)) cuts.add(i + 1);
    if (line.trim() === 'main "$@"') cuts.add(i); // stop before the final dispatch
  });
  cuts.add(1);
  const sentinel = h.write("sentinel-marker", "alive", { mode: 0o600 });
  for (const cut of cuts) {
    const prefix = lines.slice(0, cut).join("\n");
    spawnSync(SH, ["-c", prefix], { env: h.env() });
    assert.equal(readFileSync(join(h.root, "sentinel-marker"), "utf8"), "alive", `cut at line ${cut}`);
  }
  assert.equal(h.exists("logs/cmd.log"), false);
  assert.deepEqual(readdirSync(join(h.root, "tmpdir")), []);
  assert.equal(h.exists("data/zosma-cowork"), false);
});

// Keep a reference to randomHex imported so tree-shaking linters are quiet.
