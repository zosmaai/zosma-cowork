import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

// The /api/v1/models catalog no longer probes or validates the cwd (ZOS-80:
// headless clients list the catalog without pointing at a filesystem
// directory). Stub the facade so the route's catalog call resolves without a
// real model loader, then assert the cwd (or its absence) is never rejected.
function stubFacade() {
  const original = globalThis.__piBackend;
  globalThis.__piBackend = {
    getModels: async ({ cwd }) => ({
      cwd,
      models: {},
      modelList: [],
      defaultModel: null,
      thinkingLevels: {},
      thinkingLevelMaps: {},
      thinkingLevelPins: {},
    }),
  };
  return () => { globalThis.__piBackend = original; };
}

test("GET /api/v1/models returns the model catalog under { data } without a cwd probe", async () => {
  const restore = stubFacade();
  try {
    const res = await GET(new Request("http://localhost/api/v1/models"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.error, undefined);
    assert.ok(Array.isArray(body.data.modelList));
    assert.equal(body.data.cwd, process.cwd());
  } finally {
    restore();
  }
});

test("GET /api/v1/models accepts an explicit cwd", async () => {
  const restore = stubFacade();
  try {
    const res = await GET(new Request("http://localhost/api/v1/models?cwd=%2Fsome%2Fpath"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.cwd, "/some/path");
  } finally {
    restore();
  }
});

test("GET /api/v1/models no longer rejects a missing cwd (cwd probe removed)", async () => {
  const restore = stubFacade();
  try {
    // A path that does not exist is accepted — the invalid_request 400 probe
    // was dropped in ZOS-80.
    const res = await GET(new Request("http://localhost/api/v1/models?cwd=" + encodeURIComponent("/definitely-not-a-dir-xyz")));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).error, undefined);
  } finally {
    restore();
  }
});
