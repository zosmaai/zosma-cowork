import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/agent/running returns the snapshot under { data }", async () => {
  // Fresh registry so the snapshot is deterministic (the route process has none).
  globalThis.__piSessions = new Map();
  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.ok(Array.isArray(body.data.runningSessionIds));
  assert.equal(body.data.runningSessionIds.length, 0);
  assert.equal(body.error, undefined);
  delete globalThis.__piSessions;
});
