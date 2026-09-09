import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

// The skills route lists installed skills through the transport-neutral
// pi-backend facade (ZOS-82). Stub the facade so the route's call resolves
// without a real skill loader, then assert the list is wrapped under { data }.
function stubFacade() {
  const original = globalThis.__piBackend;
  globalThis.__piBackend = {
    listSkills: async () => ({
      skills: [{ name: "a", description: "d", filePath: "/x", baseDir: "/y", disableModelInvocation: false, sourceInfo: {} }],
      diagnostics: [],
      projectResourcesLoaded: true,
    }),
  };
  return () => { globalThis.__piBackend = original; };
}

test("GET /api/v1/skills returns the installed skills under { data }", async () => {
  const restore = stubFacade();
  try {
    const res = await GET(new Request("http://localhost/api/v1/skills"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.error, undefined);
    assert.deepEqual(body.data.skills, [
      { name: "a", description: "d", filePath: "/x", baseDir: "/y", disableModelInvocation: false, sourceInfo: {} },
    ]);
    assert.equal(body.data.projectResourcesLoaded, true);
  } finally { restore(); }
});
