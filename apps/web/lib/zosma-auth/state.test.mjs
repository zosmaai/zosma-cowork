import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { savePending, loadPending, deletePending, pendingFilePath } =
  await jiti.import("./state.ts");

function withTempDir(run) {
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-auth-pending-"));
    try {
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

const tx = (over = {}) => ({
  state: "s-state",
  codeVerifier: "v-verifier",
  deviceId: "cowork-123",
  expiresAt: Date.now() + 600_000,
  ...over,
});

test("savePending then loadPending roundtrips", withTempDir(async (dir) => {
  const t = tx();
  savePending(t, dir);
  assert.deepEqual(loadPending(dir), t);
}));

test("loadPending returns null when no file exists", withTempDir(async (dir) => {
  assert.equal(loadPending(dir), null);
}));

test("loadPending returns null and deletes an expired transaction", withTempDir(async (dir) => {
  savePending(tx({ expiresAt: Date.now() - 1 }), dir);
  assert.equal(loadPending(dir), null);
  const missing = await readFile(pendingFilePath(dir), "utf-8").then(
    () => false,
    () => true,
  );
  assert.equal(missing, true);
}));

test("loadPending returns null on corrupt JSON (file left in place)", withTempDir(async (dir) => {
  await writeFile(pendingFilePath(dir), "{not json", { mode: 0o600 });
  assert.equal(loadPending(dir), null);
  assert.match(await readFile(pendingFilePath(dir), "utf-8"), /\{not json/);
}));

test("loadPending rejects missing fields", withTempDir(async (dir) => {
  for (const missing of ["state", "codeVerifier", "deviceId", "expiresAt"]) {
    const bad = tx();
    delete bad[missing];
    await rm(pendingFilePath(dir), { force: true });
    savePending(bad, dir);
    assert.equal(loadPending(dir), null, `should reject missing ${missing}`);
  }
}));

test("loadPending rejects wrong field types", withTempDir(async (dir) => {
  savePending(tx({ expiresAt: "soon" }), dir);
  assert.equal(loadPending(dir), null);
}));

test("savePending overwrites a previous transaction", withTempDir(async (dir) => {
  savePending(tx({ state: "old" }), dir);
  savePending(tx({ state: "new" }), dir);
  assert.equal(loadPending(dir).state, "new");
}));

test("deletePending removes the file and is a no-op when absent", withTempDir(async (dir) => {
  savePending(tx(), dir);
  deletePending(dir);
  assert.equal(loadPending(dir), null);
  deletePending(dir); // must not throw
}));

test("saved file has 0600 permissions", withTempDir(async (dir) => {
  savePending(tx(), dir);
  assert.equal((await stat(pendingFilePath(dir))).mode & 0o777, 0o600);
}));
