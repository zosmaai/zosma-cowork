import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// moduleCache stays ON (default) so the BackendError class imported here is the
// same instance the mapper's isBackendError checks (jiti builds a fresh graph
// per import() when moduleCache=false). This test mutates no global state, so
// cross-test caching is harmless.
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { apiSuccess, apiErrorResponse } = await jiti.import("./api-envelope.ts");
const { BackendError } = await jiti.import("../packages/pi-backend/errors.ts");
const { STATUS_BY_CODE } = await jiti.import("./backend-error-response.ts");

test("apiSuccess wraps any payload in { data } and forwards status/headers", async () => {
  const res = apiSuccess({ sessions: [], runningSessionIds: [] }, { headers: { "Cache-Control": "no-store" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.deepEqual(body, { data: { sessions: [], runningSessionIds: [] } });
});

test("apiErrorResponse maps every backend code to the documented status", async () => {
  const cases = [
    ["invalid_request", 400],
    ["access_denied", 403],
    ["session_not_found", 404],
    ["model_not_found", 404],
    ["entry_not_found", 404],
    ["thinking_block_not_found", 404],
    ["session_not_running", 409],
    ["session_busy", 409],
    ["prompt_rejected", 409],
    ["startup_failed", 500],
    ["internal_error", 500],
  ];
  for (const [code, status] of cases) {
    const res = apiErrorResponse(new BackendError(code, "boom"));
    assert.equal(res.status, status, code);
    const body = await res.json();
    assert.deepEqual(body, { error: { code, message: "boom" } }, code);
  }
});

test("apiErrorResponse emits details only when present", async () => {
  const withDetails = apiErrorResponse(new BackendError("internal_error", "boom", { retryable: false }));
  assert.deepEqual(await withDetails.json(), { error: { code: "internal_error", message: "boom", details: { retryable: false } } });
  const without = apiErrorResponse(new BackendError("internal_error", "boom"));
  assert.deepEqual(await without.json(), { error: { code: "internal_error", message: "boom" } });
});

test("apiErrorResponse maps unknown failures to internal_error 500", async () => {
  const res = apiErrorResponse(new Error("raw"));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: "internal_error", message: "raw" } });
});

test("STATUS_BY_CODE is total over the contract code union", () => {
  const expectedCodes = new Set([
    "invalid_request", "cwd_required", "access_denied", "session_not_found", "session_not_running",
    "session_busy", "prompt_rejected", "model_not_found", "entry_not_found",
    "thinking_block_not_found", "startup_failed", "skill_not_found",
    "skill_install_failed", "skill_update_failed", "skill_check_failed", "skill_search_failed",
    "internal_error",
  ]);
  assert.deepEqual(new Set(Object.keys(STATUS_BY_CODE)), expectedCodes);
});