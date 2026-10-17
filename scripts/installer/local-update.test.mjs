import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeHarness } from "./test-helpers.mjs";

const VERSION = "v1.2.3";
const installArgs = ["install", "--mode", "local", "--yes", "--no-start"];

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

function install(h) {
  return h.runCLI([...installArgs], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
}

function curlWithHealth() {
  return [
    'url=""; out=""; prev=""',
    'for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; prev=""; continue; fi; case "$a" in -o) prev="-o" ;; -*) : ;; *) url="$a" ;; esac; done',
    'case "$url" in *api/v1/health) exit 0 ;; esac',
    'b=$(basename "$url")',
    'cat "$ZOSMA_FIXTURE_DIR/$b" > "$out"',
    "exit 0",
  ].join("\n");
}

test("update rejects install-only options before mutation", (t) => {
  const h = fixture(t);
  const r = h.runCLI(["update", "--no-start"]);
  assert.equal(r.status, 2);
  assert.equal(h.exists("config/zosma-cowork/config"), false);
});

test("invalid update metadata leaves the active installation unchanged", (t) => {
  const h = fixture(t);
  const first = install(h);
  assert.equal(first.status, 0, first.stderr);
  const before = readFileSync(join(h.config, "zosma-cowork", "config"), "utf8");
  h.write("fixtures/bad-update.txt", "installer_schema=999\nversion=v9.9.9\n");
  const r = h.runCLI(["update", "--yes"], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/bad-update.txt` } });
  assert.equal(r.status, 4);
  assert.equal(readFileSync(join(h.config, "zosma-cowork", "config"), "utf8"), before);
});

test("successful local update retains the current and previous generations", (t) => {
  const h = fixture(t);
  const first = install(h);
  assert.equal(first.status, 0, first.stderr);
  h.plan("curl", curlWithHealth());
  const r = h.runCLI(["update", "--yes"], { env: { ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` } });
  assert.equal(r.status, 0, r.stderr);
  const gens = readdirSync(join(h.data, "zosma-cowork", "runtime", "versions", VERSION, "generations"))
    .filter((name) => /^generation-\d{4}$/.test(name));
  assert.ok(gens.length >= 2);
  assert.match(readFileSync(join(h.data, "zosma-cowork", "cli", "current", "zosma"), "utf8"), /installer_schema=1/);
});
