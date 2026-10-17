import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeHarness, randomHex, ZOSMA } from "./test-helpers.mjs";

const DAEMON_TOKEN = randomHex(64);

function validConfigFields() {
  return {
    MODE: "local",
    VERSION: "v1.2.3",
    PORT: "30141",
    BIND_ADDRESS: "127.0.0.1",
    ALLOWED_HOST: "127.0.0.1",
    PI_DIR: "/tmp/pi-agent-test",
    WORKSPACE: "",
    IMAGE: "",
    SERVICE_MANAGER: "none",
  };
}

function baseHarness(t) {
  const h = makeHarness();
  t.after(() => h.cleanup());
  return h;
}

function sourceParse(h, extra = "") {
  // Source-mode parse of the harness-written config/secrets files.
  return h.shSource(
    `parse_config_files "$ZS_CFG" "$ZS_SEC"\necho "rc=$?"\n${extra}`,
    { env: { ZS_CFG: join(h.config, "zosma-cowork", "config"), ZS_SEC: join(h.config, "zosma-cowork", "secrets") } },
  );
}

test("version prints the human-readable development version", (t) => {
  const h = baseHarness(t);
  const r = h.runCLI(["version"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Zosma Cowork CLI v0\.0\.0-dev/);
});

test("version --machine prints the exact machine contract", (t) => {
  const h = baseHarness(t);
  const r = h.runCLI(["version", "--machine"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "installer_schema=1\nversion=v0.0.0-dev\n");
});

test("unknown commands and options return 2 with concise usage", (t) => {
  const h = baseHarness(t);
  for (const args of [[], ["frobnicate"], ["version", "--bogus"], ["--totally-unknown"]]) {
    const r = h.runCLI(args);
    assert.equal(r.status, 2, `args=${JSON.stringify(args)}`);
    assert.match(r.stderr, /usage|unknown/, `args=${JSON.stringify(args)}`);
  }
  const help = h.runCLI(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /zosma <command>/);
});

test("absolute XDG variables select the fixed roots; relative values warn and fall back", (t) => {
  const h = baseHarness(t);
  const explicit = h.shSource(
    "resolve_roots\n"
    + "printf 'data=%s\\n' \"$ZM_DATA_ROOT\"\n"
    + "printf 'config=%s\\n' \"$ZM_CONFIG_ROOT\"\n"
    + "printf 'state=%s\\n' \"$ZM_STATE_ROOT\"\n"
    + "printf 'bin=%s\\n' \"$ZM_BIN_DIR\"\n"
    + "printf 'unit=%s\\n' \"$ZM_SYSTEMD_UNIT\"\n",
  );
  assert.equal(explicit.status, 0);
  assert.equal(explicit.stdout, [
    `data=${join(h.data, "zosma-cowork")}`,
    `config=${join(h.config, "zosma-cowork")}`,
    `state=${join(h.state, "zosma-cowork")}`,
    `bin=${join(h.home, ".local", "bin")}`,
    `unit=${join(h.config, "systemd", "user", "zosma-cowork.service")}`,
    "",
  ].join("\n"));

  const fallback = h.shSource(
    "resolve_roots\nprintf 'data=%s\\n' \"$ZM_DATA_ROOT\"\n",
    { env: { XDG_DATA_HOME: null, XDG_CONFIG_HOME: null, XDG_STATE_HOME: null, XDG_CACHE_HOME: null } },
  );
  assert.equal(fallback.status, 0);
  assert.equal(fallback.stdout, `data=${join(h.home, ".local", "share", "zosma-cowork")}\n`);

  const relative = h.shSource(
    "resolve_roots\nprintf 'data=%s\\n' \"$ZM_DATA_ROOT\"\n",
    { env: { XDG_DATA_HOME: "relative/data" } },
  );
  assert.equal(relative.status, 0);
  assert.match(relative.stderr, /ignoring relative XDG_DATA_HOME/);
  assert.equal(relative.stdout, `data=${join(h.home, ".local", "share", "zosma-cowork")}\n`);
});

test("empty or relative HOME and CR/LF in persisted values fail before writes", (t) => {
  const h = baseHarness(t);
  const empty = h.shSource("resolve_roots\n", { env: { HOME: "" } });
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /HOME/);
  // Resolution is pure: nothing was created by the CLI.
  assert.equal(h.exists("data/zosma-cowork"), false);
  assert.equal(h.exists("home/.local/bin/zosma"), false);

  const relative = h.shSource("resolve_roots\n", { env: { HOME: "somewhere" } });
  assert.equal(relative.status, 2);
  assert.match(relative.stderr, /absolute/);

  const crlfHome = h.shSource("resolve_roots\n", { env: { HOME: `/tmp/home\r` } });
  assert.equal(crlfHome.status, 2);

  h.writeConfig({ ...validConfigFields(), PI_DIR: "/tmp/pi\r" });
  h.writeSecrets({ DAEMON_TOKEN, WEB_PASSWORD: "" });
  const parsed = sourceParse(h);
  assert.equal(parsed.status, 2);
  assert.match(parsed.stderr, /PI_DIR/);
});

test("hostile config values stay literal and are never evaluated", (t) => {
  const h = baseHarness(t);
  const sentinel = join(h.root, "hostile-sentinel");
  h.writeConfig({ ...validConfigFields(), MODE: `$(touch ${sentinel})` });
  h.writeSecrets({ DAEMON_TOKEN, WEB_PASSWORD: "" });
  const parsed = sourceParse(h);
  assert.equal(parsed.status, 2);
  assert.match(parsed.stderr, /MODE/);
  assert.equal(h.exists("hostile-sentinel"), false);
});

test("required keys appear exactly once; malformed, duplicate, cross-mode, and unknown cases fail", (t) => {
  const h = baseHarness(t);
  h.writeConfig(validConfigFields());
  h.writeSecrets({ DAEMON_TOKEN, WEB_PASSWORD: "" });
  const ok = sourceParse(h, 'echo "mode=$CFG_MODE version=$CFG_VERSION port=$CFG_PORT"');
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "rc=0\nmode=local version=v1.2.3 port=30141\n");

  const malformed = h.shSource("", {});
  assert.equal(malformed.status, 0, "no-op source parse is not a CLI behavior check");

  // Duplicate known field (two MODE lines in the raw config).
  const valid = h.read("config/zosma-cowork/config");
  h.write("config/zosma-cowork/config", valid + "MODE=docker\n");
  const duplicate = h.shSource(
    `parse_config_files "${join(h.config, "zosma-cowork", "config")}" "${join(h.config, "zosma-cowork", "secrets")}"\necho rc=$?\n`,
  );
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /duplicate MODE/);

  // Malformed known field value.
  h.writeConfig({ ...validConfigFields(), MODE: "lxc" });
  const bad = sourceParse(h);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /invalid MODE/);

  // Missing required key.
  h.writeConfig({ ...validConfigFields(), SERVICE_MANAGER: undefined });
  const missing = sourceParse(h);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /missing required configuration key: service_manager/);

  // Cross-mode invariant: local with an image digest.
  h.writeConfig({ ...validConfigFields(), IMAGE: "ghcr.io/zosmaai/zosma-cowork@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  const crossLocal = sourceParse(h);
  assert.equal(crossLocal.status, 2);
  assert.match(crossLocal.stderr, /must be empty in local mode/);

  // Cross-mode invariant: docker with an empty image.
  h.writeConfig({ ...validConfigFields(), MODE: "docker", WORKSPACE: "/tmp/work", IMAGE: "" });
  const crossDocker = sourceParse(h);
  assert.equal(crossDocker.status, 2);
  assert.match(crossDocker.stderr, /IMAGE digest is required/);

  // Loopback binding with a non-loopback allowed host.
  h.writeConfig({ ...validConfigFields(), ALLOWED_HOST: "cowork.example.test" });
  h.writeSecrets({ DAEMON_TOKEN, WEB_PASSWORD: "" });
  const crossBind = sourceParse(h);
  assert.equal(crossBind.status, 2);
  assert.match(crossBind.stderr, /loopback binding requires ALLOWED_HOST=127.0.0.1/);

  // Unknown secrets key fails without printing values.
  h.writeSecrets({ DAEMON_TOKEN, WEB_PASSWORD: "", EVIL: "super-secret-value-abc" });
  const unknownSecret = sourceParse(h);
  assert.equal(unknownSecret.status, 2);
  assert.match(unknownSecret.stderr, /unknown secrets entry: EVIL/);
  assert.doesNotMatch(unknownSecret.stderr, /super-secret-value-abc/);
});

test("unknown config fields produce one warning and are ignored", (t) => {
  const h = baseHarness(t);
  h.writeConfig({ ...validConfigFields(), FANCY_OPTION: "yes", ANOTHER_EXTRA: "x" });
  h.writeSecrets({ DAEMON_TOKEN, WEB_PASSWORD: "" });
  const r = sourceParse(h);
  assert.equal(r.status, 0);
  const warnings = r.stderr.split("\n").filter((line) => line.includes("ignoring unknown configuration key"));
  assert.equal(warnings.length, 2, r.stderr);
  assert.match(warnings[0], /FANCY_OPTION/);
  assert.match(warnings[1], /ANOTHER_EXTRA/);
});

test("source contains exactly one ZOSMA_CLI_VERSION assignment for Phase 4 stamping", (t) => {
  const source = readFileSync(ZOSMA, "utf8");
  const matches = source.match(/ZOSMA_CLI_VERSION=v0\.0\.0-dev/g) ?? [];
  assert.equal(matches.length, 1);
});

test("manifest parsing accepts a canonical manifest and rejects exactly once violations", (t) => {
  const h = baseHarness(t);
  const { path } = h.makeManifest({ version: "v1.2.3" });
  const parse = (manifestPath) => h.shSource(
    `parse_manifest_file "$ZMF"\necho "rc=$?"\nprintf 'version=%s\\n' "$ZM_MF_VERSION"\n`,
    { env: { ZMF: manifestPath } },
  );
  const ok = parse(path);
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "rc=0\nversion=v1.2.3\n");

  const manifest = h.read("fixtures/manifest.txt");
  const bad = manifest.replace("version=v1.2.3", "version=v1.2.3\nversion=v1.2.4");
  const dupPath = h.write("fixtures/dup-manifest.txt", bad);
  const dup = parse(dupPath);
  assert.match(dup.stdout, /rc=4/);
  assert.match(dup.stderr, /duplicate manifest key: version/);
});