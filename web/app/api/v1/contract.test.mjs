import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "./test-helper.mjs";

// ZOS-81: /api/v1 wire-format contract matrix.
//
// asserts.ts (packages/pi-backend/contracts.ts) is type-only, so it cannot
// catch a route that drifts on the WIRE shape. This test asserts every tested
// route returns the transport-neutral envelope: 2xx => { data } (+ json
// content-type), and never a bare object. A route returning the wrong shape
// breaks the suite, not just the build.
const routes = [
  "health/route.ts",
  "agent/running/route.ts",
  "capabilities/route.ts",
  "sessions/[id]/model/route.ts",
  "sessions/[id]/context/route.ts",
  "skills/route.ts",
  "plugins/route.ts",
];

// Facade methods every tested GET route calls through getPiBackend().
const STUB = {
  getHealth: async () => ({ version: "pi-test", runtime: "node" }),
  getCapabilities: async () => ({ name: "pi", supported: ["health"] }),
  getRunningSessionIds: async () => ["sess_1"],
  getAgentState: async () => ({ running: false }),
  getSessionModel: async () => ({ model: "claude-sonnet", thinkingLevel: "medium" }),
  getSessionContext: async () => ({ entries: [], thinking: [] }),
  listSkills: async () => ({ skills: [], diagnostics: [], projectResourcesLoaded: true }),
  listPlugins: async () => ({ packages: [], totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 }, diagnostics: [], projectResourcesLoaded: true }),
};

let original;
function stub() { original = globalThis.__piBackend; globalThis.__piBackend = STUB; }
function unstub() { globalThis.__piBackend = original; }

const jiti = createV1Jiti();

for (const rel of routes) {
  test(`contract: GET /${rel} returns the { data } envelope`, async () => {
    const { GET } = await jiti.import(new URL(rel, import.meta.url).href);
    assert.equal(typeof GET, "function");
    stub();
    try {
      const res = await GET(new Request(`http://localhost/api/v1/${rel}`), { params: Promise.resolve({ id: "s1" }) });
      assert.equal(res.status, 200, `${rel} status`);
      const ct = res.headers.get("content-type") || "";
      assert.match(ct, /application\/json/, `${rel} content-type`);
      const body = await res.json();
      assert.ok("data" in body, `${rel} envelope has data`);
      assert.equal(body.error, undefined, `${rel} no error key on 2xx`);
      assert.equal(typeof body.data, "object", `${rel} data is object`);
      assert.notEqual(body.data, null, `${rel} data not null`);
    } finally { unstub(); }
  });
}
