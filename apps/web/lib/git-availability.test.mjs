import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { isGitAvailable } = await jiti.import("./git-availability.ts");

test("isGitAvailable returns true when git --version succeeds", () => {
  const calls = [];
  assert.equal(isGitAvailable((command, args) => {
    calls.push({ command, args });
    return { status: 0 };
  }), true);
  assert.deepEqual(calls, [{ command: "git", args: ["--version"] }]);
});

test("isGitAvailable returns false when Git cannot be spawned", () => {
  assert.equal(isGitAvailable(() => ({ status: null, error: { code: "ENOENT" } })), false);
});