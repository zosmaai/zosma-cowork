import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

function catalog(cwd) {
  return {
    cwd,
    models: {},
    modelList: [],
    defaultModel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
    thinkingLevelPins: {},
  };
}

test("GET /api/v1/models relays to the daemon and returns the catalog under { data } without a cwd probe", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: catalog(body.cwd) } };
    },
  ]);
  t.after(restore);
  const res = await GET(new Request("http://localhost/api/v1/models"));
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ type: "read:models", cwd: process.cwd() }]);
  const body = await res.json();
  assert.equal(body.error, undefined);
  assert.ok(Array.isArray(body.data.modelList));
  assert.equal(body.data.cwd, process.cwd());
});

test("GET /api/v1/models accepts an explicit cwd", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: catalog(body.cwd) } };
    },
  ]);
  t.after(restore);
  const res = await GET(new Request("http://localhost/api/v1/models?cwd=%2Fsome%2Fpath"));
  assert.equal(res.status, 200);
  assert.equal(seen[0].cwd, "/some/path");
  const body = await res.json();
  assert.equal(body.data.cwd, "/some/path");
});

test("GET /api/v1/models no longer rejects a missing cwd (cwd probe removed)", async (t) => {
  const restore = stubDaemon([
    (body) => ({ body: { ok: true, data: catalog(body.cwd) } }),
  ]);
  t.after(restore);
  const res = await GET(
    new Request("http://localhost/api/v1/models?cwd=" + encodeURIComponent("/definitely-not-a-dir-xyz")),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).error, undefined);
});
