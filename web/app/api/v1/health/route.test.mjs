import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/health returns the typed envelope and starts no Pi runtime", async () => {
  // A truly blank registry proves the adapter never constructs a runtime.
  globalThis.__piSessions = undefined;
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.apiVersion, "v1");
  assert.equal(typeof body.data.piVersion, "string");
  assert.equal(body.error, undefined);
  assert.equal(globalThis.__piSessions, undefined);
});