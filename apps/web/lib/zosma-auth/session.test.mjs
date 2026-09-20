import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  SESSION_COOKIE,
  createSessionToken,
  currentRouterKey,
  isHttpsRequest,
  readSessionCookie,
  sessionClearCookie,
  sessionFingerprint,
  sessionSetCookie,
  verifySessionToken,
} = await jiti.import("./session.ts");

const KEY = "zk_live_abc123";

async function tmpAgentDir(models) {
  const dir = await mkdtemp(join(tmpdir(), "zosma-session-test-"));
  if (models !== undefined) {
    await writeFile(join(dir, "models.json"), JSON.stringify(models));
  }
  return dir;
}

test("session token round-trips for the key that issued it", () => {
  const token = createSessionToken(KEY);
  assert.equal(verifySessionToken(token, KEY), true);
});

test("session token is rejected for a different router key", () => {
  const token = createSessionToken(KEY);
  assert.equal(verifySessionToken(token, "zk_other"), false);
});

test("session token expires", () => {
  const now = 1_000_000;
  const token = createSessionToken(KEY, now);
  assert.equal(verifySessionToken(token, KEY, now + 1000), true);
  assert.equal(verifySessionToken(token, KEY, now + 31 * 24 * 60 * 60 * 1000), false);
});

test("session token rejects a tampered signature", () => {
  const token = createSessionToken(KEY);
  const forged = `${token.slice(0, -2)}xy`;
  assert.equal(verifySessionToken(forged, KEY), false);
});

test("session token rejects a tampered fingerprint", () => {
  const token = createSessionToken(KEY);
  const [, exp, sig] = token.split(".");
  assert.equal(verifySessionToken(`${sessionFingerprint("other")}.${exp}.${sig}`, KEY), false);
});

test("session token rejects malformed input without throwing", () => {
  for (const bad of ["", "a", "a.b", "a.b.c.d", "a.b.c", "..", "fp.notanumber.sig"]) {
    assert.equal(verifySessionToken(bad, KEY), false, `expected ${JSON.stringify(bad)} to fail`);
  }
  assert.equal(verifySessionToken(undefined, KEY), false);
  assert.equal(verifySessionToken(null, null), false);
});

test("readSessionCookie extracts only the named cookie", () => {
  const header = `other=1; ${SESSION_COOKIE}=tok.en.sig; trailing=2`;
  assert.equal(readSessionCookie(header), "tok.en.sig");
  assert.equal(readSessionCookie("other=1"), null);
  assert.equal(readSessionCookie(null), null);
  assert.equal(readSessionCookie(""), null);
});

test("session cookie attributes are httpOnly, lax and scoped to /", () => {
  const cookie = sessionSetCookie("tok", false);
  assert.match(cookie, /^zosma_session=tok; /);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Secure/);
  assert.match(sessionSetCookie("tok", true), /Secure/);
});

test("clear cookie expires the session", () => {
  const cookie = sessionClearCookie(false);
  assert.match(cookie, /^zosma_session=;/);
  assert.match(cookie, /Max-Age=0/);
});

test("isHttpsRequest only trusts https origins", () => {
  assert.equal(isHttpsRequest(new Request("https://example.com/")), true);
  assert.equal(isHttpsRequest(new Request("http://127.0.0.1:30141/")), false);
});

test("currentRouterKey returns the configured router key", async () => {
  const dir = await tmpAgentDir({
    providers: {
      "zosma-router": { id: "zosma-router", apiKey: KEY, models: [] },
    },
  });
  assert.equal(currentRouterKey(dir), KEY);
});

test("currentRouterKey is null when unconfigured or the key is empty", async () => {
  assert.equal(currentRouterKey(await tmpAgentDir()), null);
  assert.equal(currentRouterKey(await tmpAgentDir({ providers: {} })), null);
  assert.equal(
    currentRouterKey(await tmpAgentDir({ providers: { "zosma-router": { apiKey: "" } } })),
    null,
  );
});