import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createV1Jiti } from "../../app/api/v1/test-helper.mjs";

// jiti loads the sibling .ts service (bare extensionless import won't resolve
// under --experimental-strip-types, same as the streaming/session-model tests).
const jiti = createV1Jiti();
const svc = await jiti.import(new URL("./plugins.ts", import.meta.url).href);
const { readPluginsFromServices, managePluginsFromServices } = svc;

// A cwd outside the allowed file roots deterministically fails the file-access
// gate — the test never reaches the SDK package manager.
function nonRootedCwd() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-backend-plugins-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("readPluginsFromServices rejects a missing cwd with cwd_required", async () => {
  await assert.rejects(
    () => readPluginsFromServices(undefined),
    (e) => e.code === "cwd_required",
  );
});

test("readPluginsFromServices rejects an untrusted project cwd with access_denied", async () => {
  const { cwd, cleanup } = nonRootedCwd();
  try {
    await assert.rejects(
      () => readPluginsFromServices(cwd),
      (e) => e.code === "access_denied",
    );
  } finally {
    cleanup();
  }
});

test("managePluginsFromServices rejects an unknown action with invalid_request", async () => {
  const { cwd, cleanup } = nonRootedCwd();
  try {
    await assert.rejects(
      () => managePluginsFromServices({ action: "explode", source: "npm:x", cwd }),
      (e) => e.code === "invalid_request",
    );
  } finally {
    cleanup();
  }
});

test("managePluginsFromServices rejects a project scope with no cwd with cwd_required", async () => {
  await assert.rejects(
    () => managePluginsFromServices({ action: "install", source: "npm:x", scope: "project" }),
    (e) => e.code === "cwd_required",
  );
});

test("managePluginsFromServices rejects an untrusted project cwd with access_denied", async () => {
  const { cwd, cleanup } = nonRootedCwd();
  try {
    await assert.rejects(
      () => managePluginsFromServices({ action: "install", source: "npm:x", scope: "project", cwd }),
      (e) => e.code === "access_denied",
    );
  } finally {
    cleanup();
  }
});

test("managePluginsFromServices rejects a project-scope update on an untrusted cwd before the SDK", async () => {
  const { cwd, cleanup } = nonRootedCwd();
  try {
    await assert.rejects(
      () => managePluginsFromServices({ action: "update", scope: "project", cwd }),
      (e) => e.code === "access_denied",
    );
  } finally {
    cleanup();
  }
});
