import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const stateModule = await jiti.import("../../../../../lib/zosma-auth/state.ts");

function seedPending(dir, state = "s1") {
  stateModule.savePending(
    { state, codeVerifier: "v1", deviceId: "cowork-d1", expiresAt: Date.now() + 600_000 },
    dir,
  );
}

function stubRegistryAndNetwork(t) {
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "m1", provider: pid }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/v1/cowork/token")) return Response.json({ access_token: "sk-new" });
    if (String(url).endsWith("/v1/models")) return Response.json({ data: [{ id: "m1" }] });
    throw new Error(`unexpected ${url}`);
  };
  t.after(() => {
    delete globalThis.__zosmaAuthDepsForTests;
    globalThis.fetch = realFetch;
  });
}

// The route returns a plain 302 Response with an absolute Location header;
// the test just parses that header — no actual navigation in a unit test.

test("GET /callback completes and redirects to / with success params", withAgentDir(async (dir, t) => {
  seedPending(dir);
  stubRegistryAndNetwork(t);
  const res = await GET(new Request("http://localhost/api/auth/zosma/callback?code=c1&state=s1"));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.pathname, "/");
  assert.equal(loc.searchParams.get("zosma"), "success");
  assert.equal(loc.searchParams.get("models"), "1");
}));

test("GET /callback redirects with an error message on failure", withAgentDir(async (dir, t) => {
  seedPending(dir, "other-state");
  stubRegistryAndNetwork(t);
  const res = await GET(new Request("http://localhost/api/auth/zosma/callback?code=c1&state=s1"));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.pathname, "/");
  assert.equal(loc.searchParams.get("zosma"), "error");
  assert.ok(loc.searchParams.get("message").length > 0);
}));

test("GET /callback without code+state redirects to an error", withAgentDir(async (_dir, t) => {
  stubRegistryAndNetwork(t);
  const res = await GET(new Request("http://localhost/api/auth/zosma/callback?code=c1"));
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.searchParams.get("zosma"), "error");
}));
