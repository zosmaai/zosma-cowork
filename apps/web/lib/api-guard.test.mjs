import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { isZosmaAuthRoute, needsZosmaSession } = await jiti.import("./api-guard.ts");

test("oauth onboarding routes stay reachable without a session", () => {
  for (const pathname of [
    "/api/auth/zosma",
    "/api/auth/zosma/status",
    "/api/auth/zosma/start",
    "/api/auth/zosma/complete",
    "/api/auth/zosma/callback",
    "/api/auth/zosma/cancel",
  ]) {
    assert.equal(isZosmaAuthRoute(pathname), true, pathname);
    assert.equal(needsZosmaSession({ pathname, hasValidSession: false }), false, pathname);
  }
});

test("every other API route requires a session", () => {
  for (const pathname of [
    "/api",
    "/api/v1/sessions",
    "/api/agent/session",
    "/api/auth/providers",
    "/api/auth/providers/start",
  ]) {
    assert.equal(needsZosmaSession({ pathname, hasValidSession: false }), true, pathname);
    assert.equal(needsZosmaSession({ pathname, hasValidSession: true }), false, pathname);
  }
});

test("non-API paths are never blocked by the API guard", () => {
  assert.equal(needsZosmaSession({ pathname: "/", hasValidSession: false }), false);
  assert.equal(needsZosmaSession({ pathname: "/settings", hasValidSession: false }), false);
});

test("basic-auth callers bypass the session requirement", () => {
  assert.equal(
    needsZosmaSession({ pathname: "/api/v1/sessions", hasValidSession: false, basicAuthenticated: true }),
    false,
  );
});

test("a near-miss prefix is not treated as an auth route", () => {
  assert.equal(isZosmaAuthRoute("/api/auth/zosmaevil"), false);
  assert.equal(needsZosmaSession({ pathname: "/api/auth/zosmaevil", hasValidSession: false }), true);
});