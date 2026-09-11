import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/health relays to the daemon and returns the typed envelope", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: { status: "ok", apiVersion: "v1", piVersion: "0.84.2" } } };
    },
  ]);
  t.after(restore);
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ type: "read:health" }]);
  const body = await res.json();
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.apiVersion, "v1");
  assert.equal(typeof body.data.piVersion, "string");
  assert.equal(body.error, undefined);
});
