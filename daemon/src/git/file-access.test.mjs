import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isFilePathAllowed,
  isExistingFilePathAllowed,
  getAllowedFileRoots,
  allowFileRoot,
  normalizeSlashes,
} from "./file-access.ts";

test("rejects an existing path that escapes an allowed root through a symlink", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "zosma-daemon-file-access-"));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isFilePathAllowed(target, roots), true);
  assert.equal(isExistingFilePathAllowed(target, roots), false);
});

test("getAllowedFileRoots returns injected session roots normalized", async () => {
  const roots = await getAllowedFileRoots(async () => [
    "/sessions/cwd-one",
    "/sessions/project-root-two",
  ], true);
  assert.ok(roots.has("/sessions/cwd-one"), "session cwd included");
  assert.ok(roots.has("/sessions/project-root-two"), "session project root included");
});

test("getAllowedFileRoots adds config roots registered via allowFileRoot", async () => {
  allowFileRoot("/extra/browseable");
  const roots = await getAllowedFileRoots(async () => [], true);
  assert.ok(roots.has("/extra/browseable"), "config root registered via allowFileRoot is browsable");
});

test("getAllowedFileRoots caches its result within the TTL", async () => {
  // First call warms the cache; a later call within the TTL returns the
  // exact same Set object (no recompute).
  const first = await getAllowedFileRoots();
  const second = await getAllowedFileRoots();
  assert.ok(second === first, "cached within TTL should be the same object");
});

test("getAllowedFileRoots recomputes once forceRefresh is set", async () => {
  const before = await getAllowedFileRoots(async () => [], true);
  const after = await getAllowedFileRoots(async () => [], true);
  assert.ok(after !== before, "forceRefresh should recompute and return a new Set");
});
