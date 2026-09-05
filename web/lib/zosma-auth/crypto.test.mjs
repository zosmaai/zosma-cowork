import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { generateState, generateCodeVerifier, sha256Base64url } =
  await jiti.import("./crypto.ts");

test("generateState returns 64 hex chars", () => {
  const s = generateState();
  assert.equal(s.length, 64);
  assert.match(s, /^[0-9a-f]{64}$/);
});

test("generateState values are unique across 100 draws", () => {
  const values = new Set(Array.from({ length: 100 }, () => generateState()));
  assert.equal(values.size, 100);
});

test("generateCodeVerifier returns 43 base64url chars", () => {
  const v = generateCodeVerifier();
  assert.equal(v.length, 43);
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
});

test("generateCodeVerifier values are unique across 100 draws", () => {
  const values = new Set(Array.from({ length: 100 }, () => generateCodeVerifier()));
  assert.equal(values.size, 100);
});

test("sha256Base64url is deterministic and input-sensitive", () => {
  assert.equal(sha256Base64url("abc"), sha256Base64url("abc"));
  assert.notEqual(sha256Base64url("abc"), sha256Base64url("abd"));
});

test("sha256Base64url matches the RFC 7636 appendix test vector", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(sha256Base64url(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("sha256Base64url output never contains padding or base64 special chars", () => {
  for (const input of ["a", "ab", "abc", "abcd"]) {
    assert.doesNotMatch(sha256Base64url(input), /[=+/]/);
  }
});
