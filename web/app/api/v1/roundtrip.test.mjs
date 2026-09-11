import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "./test-helper.mjs";

// ZOS-81: end-to-end wire round-trip (roadmap item 6 edition).
//
// Exercises daemon read: op -> /api/v1 route -> web/lib/api-v1-client parse
// for real (no hand-built fixtures): the route relays the daemon envelope,
// wraps `data`, and the client's apiFetch consumes the wire Response. Covers
// both the success and the daemon error -> ApiV1Error path.

const { GET: skillsGET } = await createV1Jiti().import(new URL("./skills/route.ts", import.meta.url).href);

const clientJiti = createV1Jiti();
const { listSkills, ApiV1Error } = await clientJiti.import(new URL("../../../lib/api-v1-client.ts", import.meta.url).href);

function installClientFetch(wire) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => wire;
  return () => { globalThis.fetch = originalFetch; };
}

test("round-trip success: daemon data -> route Response -> client model", async (t) => {
  const data = { skills: [{ name: "acme/tool", description: "a tool" }], diagnostics: [], projectResourcesLoaded: true };
  const restoreDaemon = stubDaemon([
    (body) => {
      assert.equal(body.type, "read:skills-list");
      return { body: { ok: true, data } };
    },
  ]);
  t.after(restoreDaemon);
  const res = await skillsGET(new Request("http://localhost/api/v1/skills"));
  assert.equal(res.status, 200);
  const wire = res.clone(); // client consumes a fresh body
  assert.deepEqual(await res.json(), { data }); // route wrapped the daemon data
  const restoreFetch = installClientFetch(wire);
  t.after(restoreFetch);
  const parsed = await listSkills();
  assert.deepEqual(parsed, data); // client parsed route output identically
});

test("round-trip error: daemon error -> api-envelope -> ApiV1Error", async (t) => {
  const restoreDaemon = stubDaemon([
    () => ({ status: 403, body: { ok: false, error: "no access", code: "access_denied" } }),
  ]);
  t.after(restoreDaemon);
  const res = await skillsGET(new Request("http://localhost/api/v1/skills"));
  assert.equal(res.status, 403);
  const wire = res.clone(); // client consumes a fresh body
  assert.deepEqual(await res.json(), { error: { code: "access_denied", message: "no access" } });
  const restoreFetch = installClientFetch(wire);
  t.after(restoreFetch);
  await assert.rejects(
    () => listSkills(),
    (e) => e instanceof ApiV1Error && e.status === 403 && e.code === "access_denied",
  );
});
