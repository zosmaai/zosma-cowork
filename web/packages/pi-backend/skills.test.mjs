import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createV1Jiti } from "../../app/api/v1/test-helper.mjs";

// jiti loads the sibling .ts service (bare extensionless import won't resolve
// under --experimental-strip-types, same as the streaming/session-model tests).
const jiti = createV1Jiti();
const svc = await jiti.import(new URL("./skills.ts", import.meta.url).href);
const { installSkillFromServices, checkSkillUpdatesFromServices } = svc;

// A cwd outside the allowed file roots deterministically fails the file-access
// gate — the test never spawns npx or hits the network.
function nonRootedCwd() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-backend-skills-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("installSkillFromServices rejects an untrusted project cwd with access_denied", async () => {
  const { cwd, cleanup } = nonRootedCwd();
  try {
    await assert.rejects(
      () => installSkillFromServices({ package: "acme/skill", scope: "project", cwd }),
      (e) => e.code === "access_denied",
    );
  } finally {
    cleanup();
  }
});

test("installSkillFromServices rejects a missing package with invalid_request", async () => {
  await assert.rejects(
    () => installSkillFromServices({ package: "", scope: "project", cwd: "/tmp" }),
    (e) => e.code === "invalid_request",
  );
});

test("installSkillFromServices rejects a project scope with no cwd with cwd_required", async () => {
  await assert.rejects(
    () => installSkillFromServices({ package: "acme/skill", scope: "project" }),
    (e) => e.code === "cwd_required",
  );
});

test("checkSkillUpdatesFromServices rejects a project scope with no cwd with cwd_required", async () => {
  await assert.rejects(
    () => checkSkillUpdatesFromServices({ package: "acme/skill", scope: "project" }),
    (e) => e.code === "cwd_required",
  );
});

test("checkSkillUpdatesFromServices rejects an untrusted project cwd with access_denied", async () => {
  const { cwd, cleanup } = nonRootedCwd();
  try {
    await assert.rejects(
      () => checkSkillUpdatesFromServices({ package: "acme/skill", scope: "project", cwd }),
      (e) => e.code === "access_denied",
    );
  } finally {
    cleanup();
  }
});
