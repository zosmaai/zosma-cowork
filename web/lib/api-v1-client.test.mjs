import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { ApiV1Error, listSessions, getRunningSessionIds, getAgentState, getModels } = await jiti.import("./api-v1-client.ts");

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test("api-v1 client decodes { data } and unwraps it", async (t) => {
  t.after(mockFetch(async () => new Response(JSON.stringify({ data: { sessions: [], runningSessionIds: [] } }), { status: 200 })));
  const data = await listSessions();
  assert.deepEqual(data, { sessions: [], runningSessionIds: [] });
});

test("api-v1 client throws ApiV1Error with status and code on { error }", async (t) => {
  t.after(mockFetch(async () => new Response(JSON.stringify({ error: { code: "session_not_found", message: "Session not found" } }), { status: 404 })));
  await assert.rejects(
    listSessions(),
    (error) => error instanceof ApiV1Error && error.status === 404 && error.code === "session_not_found" && error.message === "Session not found",
  );
});

test("api-v1 client surfaces transport failures unchanged", async (t) => {
  const transportError = new TypeError("network down");
  t.after(mockFetch(async () => { throw transportError; }));
  await assert.rejects(listSessions(), (error) => error === transportError);
});

test("api-v1 client builds the correct URL and payloads", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => { seen.push([url, init]); return new Response(JSON.stringify({ data: { modelList: [] } }), { status: 200 }); }));
  await getModels("/home/me/project");
  await getModels();
  await getRunningSessionIds();
  await getAgentState("sid-1");
  assert.match(seen[0][0], /\/api\/v1\/models\?cwd=/);
  assert.equal(seen[1][0], "/api/v1/models");
  assert.equal(seen[2][0], "/api/v1/agent/running");
  assert.match(seen[3][0], /\/api\/v1\/agent\/sid-1\/state$/);
});
