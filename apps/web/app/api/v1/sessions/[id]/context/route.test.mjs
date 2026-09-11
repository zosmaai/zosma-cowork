import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/sessions/[id]/context relays to the daemon and returns context under { data }", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return {
        body: {
          ok: true,
          data: { messages: [], entryIds: [], sessionId: body.sessionId },
        },
      };
    },
  ]);
  t.after(restore);
  const res = await GET(
    new Request("http://localhost/api/v1/sessions/context-session/context"),
    { params: Promise.resolve({ id: "context-session" }) },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [
    { type: "read:session-context", sessionId: "context-session", deferThinking: false, deferMedia: false },
  ]);
  const body = await res.json();
  assert.ok(Array.isArray(body.data.messages));
  assert.ok(Array.isArray(body.data.entryIds));
  assert.equal(body.error, undefined);
});

test("GET /api/v1/sessions/[id]/context maps a daemon session_not_found to 404", async (t) => {
  const restore = stubDaemon([
    () => ({ status: 404, body: { ok: false, error: "Session not found", code: "session_not_found" } }),
  ]);
  t.after(restore);
  const res = await GET(
    new Request("http://localhost/api/v1/sessions/missing/context"),
    { params: Promise.resolve({ id: "missing" }) },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
});
