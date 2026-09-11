import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/sessions relays to the daemon and returns the list under { data } with no-store", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return {
        body: {
          ok: true,
          data: {
            sessions: [{ id: "v1-list-session", firstMessage: "hello" }],
            runningSessionIds: [],
          },
        },
      };
    },
  ]);
  t.after(restore);
  const res = await GET(new Request("http://localhost/api/v1/sessions?force=1"));
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ type: "read:list-sessions", force: true }]);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.ok(Array.isArray(body.data.sessions));
  assert.ok(Array.isArray(body.data.runningSessionIds));
  assert.ok(body.data.sessions.some((s) => s.id === "v1-list-session"));
  assert.equal(body.error, undefined);
});
