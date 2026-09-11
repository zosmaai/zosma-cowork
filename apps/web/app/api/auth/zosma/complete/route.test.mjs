import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const stateModule = await jiti.import("../../../../../lib/zosma-auth/state.ts");

function seedPending(dir) {
  stateModule.savePending(
    { state: "s1", codeVerifier: "v1", deviceId: "cowork-d1", expiresAt: Date.now() + 600_000 },
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

test("POST /complete exchanges and returns the result", withAgentDir(async (dir, t) => {
  seedPending(dir);
  stubRegistryAndNetwork(t);
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c1", state: "s1" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    providerId: "zosma-router",
    selectedModelId: "m1",
    modelCount: 1,
  });
}));

test("POST /complete rejects state mismatch with 400", withAgentDir(async (dir, t) => {
  seedPending(dir);
  stubRegistryAndNetwork(t);
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c1", state: "nope" }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /state mismatch/);
}));

test("POST /complete maps expired-pending to 400", withAgentDir(async (_dir, t) => {
  stubRegistryAndNetwork(t);
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c1", state: "s1" }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no pending auth transaction/);
}));

test("POST /complete rejects a missing body field with 400", withAgentDir(async (_dir, t) => {
  stubRegistryAndNetwork(t);
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c1" }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /code and state required/);
}));
