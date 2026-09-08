import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  BACKEND_ERROR_CODES,
  BackendError,
  isBackendError,
} = await jiti.import("./errors.ts");

test("BackendError keeps a stable code, safe message, optional details, and cause", () => {
  const cause = new Error("SDK failure");
  const error = new BackendError(
    "startup_failed",
    "Unable to start the session",
    { retryable: true },
    { cause },
  );

  assert.equal(error.name, "BackendError");
  assert.equal(error.code, "startup_failed");
  assert.equal(error.message, "Unable to start the session");
  assert.deepEqual(error.details, { retryable: true });
  assert.equal(error.cause, cause);
  assert.equal(isBackendError(error), true);
  assert.equal(isBackendError(new Error("other")), false);
});

test("backend error codes match the approved v1 contract", () => {
  assert.deepEqual(BACKEND_ERROR_CODES, [
    "invalid_request",
    "access_denied",
    "session_not_found",
    "session_not_running",
    "session_busy",
    "prompt_rejected",
    "model_not_found",
    "entry_not_found",
    "thinking_block_not_found",
    "startup_failed",
    "internal_error",
  ]);
});
