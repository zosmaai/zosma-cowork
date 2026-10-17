import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  archiveName,
  assertPortableTree,
  assertRuntimeTree,
  nodeDistribution,
  parseSha256Sums,
  targetFor,
} from "./package-server-release.mjs";

test("targetFor normalizes the four supported host tuples", () => {
  assert.equal(targetFor("linux", "x64"), "linux-x64");
  assert.equal(targetFor("linux", "arm64"), "linux-arm64");
  assert.equal(targetFor("darwin", "x64"), "darwin-x64");
  assert.equal(targetFor("darwin", "arm64"), "darwin-arm64");
});

test("targetFor rejects unsupported hosts", () => {
  assert.throws(() => targetFor("win32", "x64"), /unsupported server target/);
});

test("nodeDistribution selects the expected official archive", () => {
  assert.deepEqual(nodeDistribution("v24.15.0", "linux-arm64"), {
    directory: "node-v24.15.0-linux-arm64",
    filename: "node-v24.15.0-linux-arm64.tar.xz",
  });
  assert.deepEqual(nodeDistribution("v24.15.0", "darwin-x64"), {
    directory: "node-v24.15.0-darwin-x64",
    filename: "node-v24.15.0-darwin-x64.tar.gz",
  });
});

test("parseSha256Sums returns only exact filenames", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const sums = parseSha256Sums(`${a}  node-a.tar.gz\n${b}  node-b.tar.gz\n`);
  assert.equal(sums.get("node-a.tar.gz"), a);
  assert.equal(sums.get("node-a"), undefined);
});

test("archiveName requires a v-prefixed semantic version", () => {
  assert.equal(
    archiveName("v0.19.0", "linux-x64"),
    "zosma-cowork-server-v0.19.0-linux-x64.tar.gz",
  );
  assert.throws(() => archiveName("latest", "linux-x64"), /v-prefixed semantic version/);
});

test("assertPortableTree rejects symlinks outside the staged bundle", () => {
  const temp = mkdtempSync(join(tmpdir(), "zosma-link-"));
  const root = join(temp, "root");
  try {
    mkdirSync(root);
    writeFileSync(join(temp, "workspace-file"), "outside");
    symlinkSync(join(temp, "workspace-file"), join(root, "escaped-link"));
    assert.throws(() => assertPortableTree(root), /symlink escapes runtime tree/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("assertPortableTree rejects first-party daemon tests", () => {
  const root = mkdtempSync(join(tmpdir(), "zosma-policy-"));
  try {
    mkdirSync(join(root, "daemon/src"), { recursive: true });
    writeFileSync(join(root, "daemon/src/example.test.mjs"), "test");
    assert.throws(() => assertPortableTree(root), /forbidden first-party test entry/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertPortableTree rejects Next cache output", () => {
  const root = mkdtempSync(join(tmpdir(), "zosma-policy-"));
  try {
    mkdirSync(join(root, "web/dist-server/.next/cache"), { recursive: true });
    writeFileSync(join(root, "web/dist-server/.next/cache/item"), "cache");
    assert.throws(() => assertPortableTree(root), /forbidden Next cache entry/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertRuntimeTree rejects a bundle without npm", () => {
  const root = mkdtempSync(join(tmpdir(), "zosma-tree-"));
  try {
    for (const path of ["runtime/bin", "web/dist-server", "daemon/src", "supervisor"]) {
      mkdirSync(join(root, path), { recursive: true });
    }
    writeFileSync(join(root, "runtime/bin/node"), "node");
    writeFileSync(join(root, "web/dist-server/server.js"), "server");
    writeFileSync(join(root, "daemon/src/index.ts"), "entry");
    writeFileSync(join(root, "supervisor/run-server.mjs"), "entry");
    writeFileSync(join(root, "supervisor/healthcheck.mjs"), "entry");
    writeFileSync(join(root, "VERSION"), "v0.19.0\n");
    assert.throws(() => assertRuntimeTree(root), /npm-cli\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});