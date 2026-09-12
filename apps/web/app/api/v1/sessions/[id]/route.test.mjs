import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

function rebuildParams(sessionId) {
  return { params: Promise.resolve({ id: sessionId }) };
}

test("GET /api/v1/sessions/[id] relays to the daemon and returns details with defer flags", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return {
        body: {
          ok: true,
          data: {
            sessionId: body.sessionId,
            info: { id: body.sessionId },
            context: { messages: [] },
          },
        },
      };
    },
  ]);
  t.after(restore);
  const res = await GET(
    new Request("http://localhost/api/v1/sessions/detail-session?deferThinking=1&deferMedia=1"),
    rebuildParams("detail-session"),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [
    { type: "read:session-details", sessionId: "detail-session", deferThinking: true, deferMedia: true },
  ]);
  const body = await res.json();
  assert.equal(body.data.sessionId, "detail-session");
  assert.equal(body.data.info.id, "detail-session");
  assert.ok(Array.isArray(body.data.context.messages));
  assert.equal(body.error, undefined);
});

test("GET /api/v1/sessions/[id] maps a daemon session_not_found to 404", async (t) => {
  const restore = stubDaemon([
    () => ({ status: 404, body: { ok: false, error: "Session not found", code: "session_not_found" } }),
  ]);
  t.after(restore);
  const res = await GET(
    new Request("http://localhost/api/v1/sessions/nope"),
    rebuildParams("nope"),
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
  assert.equal(body.error.message, "Session not found");
});
