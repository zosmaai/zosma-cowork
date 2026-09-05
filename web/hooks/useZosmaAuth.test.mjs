import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { parseCallbackUrl, safeError, isTauri } = await jiti.import("./useZosmaAuth.ts");

// ── parseCallbackUrl ────────────────────────────────────────────────
// Accepts: deep links, loopback redirect URLs, full pasted URLs, bare code.
// Rejects: anything else. Returns { code, state? } | null.

test("parseCallbackUrl accepts the Tauri deep link", () => {
  assert.deepEqual(
    parseCallbackUrl("ai.zosma.cowork://oauth/callback?code=c1&state=s1"),
    { code: "c1", state: "s1" },
  );
});

test("parseCallbackUrl accepts the loopback callback URL", () => {
  assert.deepEqual(
    parseCallbackUrl("http://127.0.0.1:30141/api/auth/zosma/callback?code=c2&state=s2"),
    { code: "c2", state: "s2" },
  );
});

test("parseCallbackUrl accepts any https URL carrying code+state", () => {
  assert.deepEqual(
    parseCallbackUrl("https://router.zosma.ai/done?code=c3&state=s3"),
    { code: "c3", state: "s3" },
  );
});

test("parseCallbackUrl accepts a bare code", () => {
  assert.deepEqual(parseCallbackUrl("just-a-code"), { code: "just-a-code" });
});

test("parseCallbackUrl rejects duplicate params", () => {
  assert.equal(parseCallbackUrl("http://127.0.0.1:30141/x?code=a&code=b&state=s"), null);
});

test("parseCallbackUrl rejects unknown deep-link schemes", () => {
  assert.equal(parseCallbackUrl("evil://oauth/callback?code=c&state=s"), null);
});

test("parseCallbackUrl rejects missing code", () => {
  assert.equal(parseCallbackUrl("http://127.0.0.1:30141/x?state=s"), null);
});

// ── safeError ───────────────────────────────────────────────────────

test("safeError maps expired/mismatched pending sessions", () => {
  assert.match(safeError(new Error("no pending auth transaction (expired or never started)")), /expired/i);
  assert.match(safeError(new Error("state mismatch — possible CSRF")), /signing in again/i);
});

test("safeError passes through other messages", () => {
  assert.equal(safeError(new Error("Auth server returned 503")), "Auth server returned 503");
  assert.equal(safeError("plain string"), "plain string");
});

// ── isTauri ─────────────────────────────────────────────────────────

test("isTauri is false outside Tauri", () => {
  assert.equal(isTauri({}), false);
});

test("isTauri is true when __TAURI_INTERNALS__ exists", () => {
  assert.equal(isTauri({ __TAURI_INTERNALS__: { invoke: () => {} } }), true);
});
