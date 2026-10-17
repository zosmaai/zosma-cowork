import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMachineIdentity, identityPaths } from "./identity.ts";

function freshDir() {
  return mkdtempSync(join(tmpdir(), "zosma-identity-"));
}

test("fresh install creates a durable machine.json with a generated id", () => {
  const dir = freshDir();
  try {
    const id = loadMachineIdentity(dir, {});
    assert.match(id.machineId, /^machine-[0-9a-f]{8}$/);
    assert.equal(id.version, 1);
    assert.ok(id.installId.length > 8);
    assert.ok(!Number.isNaN(Date.parse(id.createdAt)));
    assert.ok(id.name.length > 0);
    const { json } = identityPaths(dir);
    assert.ok(existsSync(json), "machine.json written");
    assert.equal(statSync(json).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(json, "utf8")).machineId, id.machineId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restart returns the same identity (id, installId, createdAt)", () => {
  const dir = freshDir();
  try {
    const a = loadMachineIdentity(dir, {});
    const b = loadMachineIdentity(dir, {});
    assert.deepEqual({ ...a }, { ...b });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy machine.id is migrated without rotating the id", () => {
  const dir = freshDir();
  try {
    const legacy = join(dir, "machine.id");
    writeFileSync(legacy, "machine-legacy1\n", { mode: 0o600 });
    const id = loadMachineIdentity(dir, {});
    assert.equal(id.machineId, "machine-legacy1");
    assert.ok(existsSync(identityPaths(dir).json), "machine.json created on migration");
    // and it sticks across a reload
    assert.equal(loadMachineIdentity(dir, {}).machineId, "machine-legacy1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("env machine id is adopted and persisted when no identity exists", () => {
  const dir = freshDir();
  try {
    const id = loadMachineIdentity(dir, { ZOSMA_MACHINE_ID: "alpha" });
    assert.equal(id.machineId, "alpha");
    assert.equal(loadMachineIdentity(dir, {}).machineId, "alpha");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("env machine id conflicting with the persisted identity fails loud", () => {
  const dir = freshDir();
  try {
    const persisted = loadMachineIdentity(dir, {});
    assert.throws(
      () => loadMachineIdentity(dir, { ZOSMA_MACHINE_ID: "alpha" }),
      (err) => {
        assert.match(err.message, /ZOSMA_MACHINE_ID_RESET/);
        assert.match(err.message, new RegExp(persisted.machineId));
        return true;
      },
    );
    // the persisted identity is untouched by the rejected call
    assert.equal(loadMachineIdentity(dir, {}).machineId, persisted.machineId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("conflict + ZOSMA_MACHINE_ID_RESET rotates to the env id with a new installId", () => {
  const dir = freshDir();
  try {
    const before = loadMachineIdentity(dir, {});
    const after = loadMachineIdentity(dir, { ZOSMA_MACHINE_ID: "alpha", ZOSMA_MACHINE_ID_RESET: "1" });
    assert.equal(after.machineId, "alpha");
    assert.notEqual(after.installId, before.installId);
    assert.equal(after.version, 1);
    assert.equal(loadMachineIdentity(dir, {}).machineId, "alpha");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reset alone generates a new id distinct from the previous one", () => {
  const dir = freshDir();
  try {
    const before = loadMachineIdentity(dir, {});
    const after = loadMachineIdentity(dir, { ZOSMA_MACHINE_ID_RESET: "1" });
    assert.notEqual(after.machineId, before.machineId);
    assert.notEqual(after.installId, before.installId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reset to the identity already persisted is a no-op (no churn on a stuck flag)", () => {
  const dir = freshDir();
  try {
    const before = loadMachineIdentity(dir, { ZOSMA_MACHINE_ID: "alpha" });
    const after = loadMachineIdentity(dir, { ZOSMA_MACHINE_ID: "alpha", ZOSMA_MACHINE_ID_RESET: "1" });
    assert.deepEqual({ ...after }, { ...before });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a machine.name left over from the default hostname is untouched by an id-only load", () => {
  const dir = freshDir();
  try {
    const a = loadMachineIdentity(dir, { ZOSMA_MACHINE_NAME: "workstation" });
    assert.equal(a.name, "workstation");
    assert.equal(statSync(identityPaths(dir).json).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
