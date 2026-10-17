import assert from "node:assert/strict";
import test from "node:test";
import { healthTimeoutMessage } from "./smoke-diagnostics.mjs";

test("health timeout includes bounded child diagnostics", () => {
  assert.equal(
    healthTimeoutMessage("http://127.0.0.1:1234/health", "daemon failed\nsecret-token"),
    "health timeout: http://127.0.0.1:1234/health\nchild output:\ndaemon failed\nsecret-token",
  );
  assert.equal(
    healthTimeoutMessage("http://127.0.0.1:1234/health", ""),
    "health timeout: http://127.0.0.1:1234/health",
  );
});
