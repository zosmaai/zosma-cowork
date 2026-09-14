import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { mkdirSync } from "node:fs";
import { makeHarness, randomHex } from "./test-helpers.mjs";

const TOKEN = randomHex(64);

function baseHarness(t) {
  const h = makeHarness();
  t.after(() => h.cleanup());
  return h;
}

function localOpts() {
  return ["--mode", "local", "--dry-run", "--yes"];
}

function dockerOpts(workspace, h) {
  return ["install", "--mode", "docker", "--workspace", workspace ?? join(h.root, "work"), "--dry-run", "--yes"];
}

test("no supplied mode reads the menu from the TTY and accepts only 1, 2, or 3", (t) => {
  const h = baseHarness(t);
  const canceled = h.runCLI(["install", "--dry-run"], { tty: { input: "3\n" } });
  assert.equal(canceled.status, 6);
  assert.match(h.ttyOut(), /Zosma Cowork Installer/);
  assert.match(h.ttyOut(), /1\s+Local server|2\s+Docker/);

  const h2 = baseHarness(t);
  const retry = h2.runCLI(["install", "--dry-run"], { tty: { input: "9\n3\n" } });
  assert.equal(retry.status, 6);
  assert.match(h2.ttyOut(), /Please enter 1, 2, or 3/);

  const h3 = baseHarness(t);
  const local = h3.runCLI(["install", "--dry-run"], { tty: { input: "1\n" } });
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /Mode: local/);

  const h4 = baseHarness(t);
  const ws = join(h4.root, "work");
  const docker = h4.runCLI(["install", "--dry-run"], { tty: { input: `2\n${ws}\n` } });
  assert.equal(docker.status, 0, docker.stderr);
  assert.match(docker.stdout, /Mode: docker/);
  assert.match(docker.stdout, /Workspace: /);
});

test("no mode without a controlling TTY returns 2 and never guesses", (t) => {
  const h = baseHarness(t);
  const r = h.runCLI(["install", "--dry-run"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--mode/);
});

test("--yes forces non-interactive behavior even with a TTY; no-TTY installs require --yes", (t) => {
  const h = baseHarness(t);
  // TTY present but --yes: docker without workspace must not prompt.
  const r = h.runCLI(["install", "--mode", "docker", "--dry-run", "--yes"], { tty: { input: "whatever\n" } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--workspace/);
  assert.equal(h.ttyOut(), "", "no prompts should appear under --yes");

  const h2 = baseHarness(t);
  const withWs = h2.runCLI(["install", "--mode", "docker", "--workspace", join(h.root, "work"), "--dry-run", "--yes"], { tty: { input: "unused\n" } });
  assert.equal(withWs.status, 0, withWs.stderr);

  // No TTY + explicit mode but no --yes -> 2.
  const h3 = baseHarness(t);
  const noYes = h3.runCLI(["install", "--mode", "local", "--dry-run"]);
  assert.equal(noYes.status, 2);
  assert.match(noYes.stderr, /--yes/);

  // Explicit mode on a TTY without --yes remains interactive (prompts for
  // the docker workspace).
  const h4 = baseHarness(t);
  const interactive = h4.runCLI(["install", "docker", "--dry-run"], { tty: { input: `${join(h4.root, "work")}\n` } });
  assert.equal(interactive.status, 0, interactive.stderr);
  assert.match(interactive.stdout, /Workspace: /);
});

test("non-interactive Docker requires --workspace; LAN additionally requires --hostname", (t) => {
  const h = baseHarness(t);
  assert.equal(h.runCLI(["install", "--mode", "docker", "--dry-run", "--yes"]).status, 2);
  assert.equal(h.runCLI([...dockerOpts(undefined, h), "--lan"]).status, 2);
  assert.match(h.runCLI([...dockerOpts(undefined, h), "--lan"]).stderr, /--hostname/);
  const lan = h.runCLI([...dockerOpts(undefined, h), "--lan", "--hostname", "cowork.example.test"]);
  assert.equal(lan.status, 0, lan.stderr);
  assert.match(lan.stdout, /cowork\.example\.test/);
  const loopback = h.runCLI([...dockerOpts(undefined, h), "--hostname", "cowork.example.test"]);
  assert.equal(loopback.status, 2, "--hostname without --lan must fail");
});

test("port and workspace validation", (t) => {
  const h = baseHarness(t);
  for (const bad of ["0", "65536", "abc", "-1", "30141-extra"]) {
    const r = h.runCLI(["install", ...localOpts().slice(1), "--port", bad]);
    assert.equal(r.status, 2, `port ${bad}: ${r.stderr}`);
  }
  const ok = h.runCLI(["install", ...localOpts()]);
  assert.equal(ok.status, 0, ok.stderr);

  // Workspace: relative, missing, file, CR/LF.
  h2fail("relative/dir");
  h2fail(join(h.root, "does-not-exist"));
  const filePath = h.write("plain-file", "not a dir");
  h2fail(filePath);
  h2fail(`/tmp/zosma-crlf\r`);

  function h2fail(ws) {
    const rr = h.runCLI(["install", "--mode", "docker", "--dry-run", "--yes", "--workspace", ws]);
    assert.equal(rr.status, 2, `workspace ${JSON.stringify(ws)}: ${rr.stderr}`);
  }

  const real = join(h.root, "real-ws-dir");
  mkdirSync(real);
  const good = h.runCLI(["install", "--mode", "docker", "--dry-run", "--yes", "--workspace", real]);
  assert.equal(good.status, 0, good.stderr);
});

test("hostname validation rejects schemes, ports, paths, whitespace, metachars, and empty labels", (t) => {
  const h = baseHarness(t);
  for (const bad of [
    "http://evil", "evil:8080", "evil/path", "evil host", "ev$(il)", "evil`x`",
    "a..b", ".lead", "trail.", "", "a".repeat(300),
  ]) {
    const args = [...dockerOpts(undefined, h), "--lan", "--hostname", bad];
    const r = h.runCLI(args);
    assert.equal(r.status, 2, `hostname ${JSON.stringify(bad)}: ${r.stderr}`);
  }
  for (const good of ["cowork.example.test", "a-b.c.example"]) {
    const r = h.runCLI([...dockerOpts(undefined, h), "--lan", "--hostname", good]);
    assert.equal(r.status, 0, `${good}: ${r.stderr}`);
  }
});

test("conflicting or repeated scalars and install-only options elsewhere return 2", (t) => {
  const h = baseHarness(t);
  assert.equal(h.runCLI(["install", "local", "--mode", "docker", "--dry-run", "--yes"]).status, 2);
  assert.equal(h.runCLI(["install", "--mode", "local", "--mode", "docker", "--dry-run", "--yes"]).status, 2);
  assert.equal(h.runCLI(["install", "--port", "1", "--port", "2", "--dry-run", "--yes"]).status, 2);
  assert.equal(h.runCLI(["install", "--yes", "--bogus", "--dry-run"]).status, 2);
  assert.equal(h.runCLI(["status", "--port", "123"]).status, 2);
  assert.equal(h.runCLI(["serve", "--yes"]).status, 2);
});

test("stubbed probes: musl/old-glibc hosts can choose Docker but not local", (t) => {
  const h = baseHarness(t);
  h.plan("getconf", "exit 1"); // no GNU libc: musl-shaped host
  h.plan("ldd", 'printf "musl libc (x86_64)\\n"\n');

  const local = h.runCLI([...localOpts().slice(0, -1)]);
  // localOpts minus --yes is not how we call; use explicit args:
  const r1 = h.runCLI(["install", "--mode", "local", "--dry-run", "--yes"]);
  assert.equal(r1.status, 3, r1.stderr);
  assert.match(r1.stderr, /docker/);

  const r2 = h.runCLI([...dockerOpts(undefined, h)]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /Mode: docker/);

  // Interactive musl host can reach and pick the Docker menu entry.
  const { h: h2 } = { h: baseHarness(t) };
  h2.plan("getconf", "exit 1");
  const menu = h2.runCLI(["install", "--dry-run"], { tty: { input: `2\n${join(h2.root, "work")}\n` } });
  assert.equal(menu.status, 0, menu.stderr);
  assert.match(menu.stdout, /Mode: docker/);
  assert.doesNotMatch(menu.stderr, /libc/);
});

test("local dry-run resolves the Pi directory without reading or creating it", (t) => {
  const h = baseHarness(t);
  const custom = join(h.root, "custom-pi");
  const r = h.runCLI(["install", "--mode", "local", "--dry-run", "--yes"], { env: { PI_CODING_AGENT_DIR: custom } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(custom));
  assert.equal(h.exists("custom-pi"), false);

  const h2 = baseHarness(t);
  const def = h2.runCLI(["install", "--mode", "local", "--dry-run", "--yes"]);
  assert.equal(def.status, 0, def.stderr);
  assert.match(def.stdout, /\.pi\/agent/);
  assert.equal(h2.exists("home/.pi"), false);
});

test("install --dry-run is fully side-effect free and prints a redacted plan", (t) => {
  const h = baseHarness(t);
  const r = h.runCLI(
    ["install", "--mode", "docker", "--workspace", join(h.root, "work"), "--dry-run", "--yes"],
    { env: { ZOSMA_TEST_MANIFEST_URL: "https://example.invalid/never-fetched" } },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry run/i);
  assert.match(r.stdout, /nothing was written/);
  assert.deepEqual(h.cmdLog("curl"), []);
  assert.equal(h.exists("data/zosma-cowork"), false);
  assert.equal(h.exists("config/zosma-cowork"), false);
  assert.equal(h.exists("state/zosma-cowork"), false);
});