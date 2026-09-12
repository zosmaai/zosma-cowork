import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

const oldUrl = process.env.ZOSMA_DAEMON_URL;
const oldToken = process.env.ZOSMA_DAEMON_TOKEN;

test("GET /api/v1/agent/running returns the snapshot under { data }", async (t) => {
  const originalFetch = globalThis.fetch;
  process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
  process.env.ZOSMA_DAEMON_TOKEN = "tok";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, sessions: [] }), { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
    process.env.ZOSMA_DAEMON_URL = oldUrl;
    process.env.ZOSMA_DAEMON_TOKEN = oldToken;
  });

  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.ok(Array.isArray(body.data.runningSessionIds));
  assert.equal(body.data.runningSessionIds.length, 0);
  assert.equal(body.error, undefined);
});