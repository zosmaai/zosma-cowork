import assert from "node:assert/strict";
import test from "node:test";
import { makeHarness } from "./test-helpers.mjs";

// Enabled with ZOSMA_NATIVE_PROBE=1: uses the actual runner uname plus libc
// or sw_vers output through the curated safe command links in the harness,
// verifying the detected local tuple through `install --dry-run` output.
const NATIVE = process.env.ZOSMA_NATIVE_PROBE === "1";

const expected = {
  arch: process.arch === "arm64" ? "arm64" : "x64",
  os: process.platform === "darwin" ? "darwin" : "linux",
};

test("native platform probe reports the runner tuple through dry-run output", { skip: !NATIVE }, () => {
  const h = makeHarness();
  try {
    const r = h.runCLI(["install", "--mode", "local", "--dry-run", "--yes"]);
    assert.equal(r.status, 0, r.stderr);
    const m = r.stdout.match(/Platform: ([a-z]+)-([a-z0-9]+)/);
    assert.ok(m, `no platform line in ${r.stdout}`);
    assert.equal(m[1], expected.os);
    assert.equal(m[2], expected.arch);
  } finally {
    h.cleanup();
  }
});

test("native probe detects Linux libc through real getconf/ldd links", { skip: !NATIVE || process.platform !== "linux" }, () => {
  const h = makeHarness();
  try {
    const r = h.runCLI(["install", "--mode", "local", "--dry-run", "--yes"]);
    assert.equal(r.status, 0, r.stderr);
    // The local gate is reachable: no glibc rejection on this runner.
    assert.doesNotMatch(r.stderr, /libc/);
  } finally {
    h.cleanup();
  }
});

test("native probe parses the macOS version on Darwin hosts", { skip: !NATIVE || process.platform !== "darwin" }, () => {
  const h = makeHarness();
  try {
    const r = h.runCLI(["install", "--mode", "local", "--dry-run", "--yes"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /macOS 13/);
  } finally {
    h.cleanup();
  }
});