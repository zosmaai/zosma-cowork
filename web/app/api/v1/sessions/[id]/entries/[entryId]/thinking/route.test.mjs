import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../../../../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET .../thinking relays to the daemon and returns the deferred block under { data }", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: { thinking: "deferred text" } } };
    },
  ]);
  t.after(restore);
  const res = await GET(
    new Request(
      "http://localhost/api/v1/sessions/thinking-session/entries/m2/thinking?blockIndex=0",
    ),
    { params: Promise.resolve({ id: "thinking-session", entryId: "m2" }) },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [
    { type: "read:session-thinking", sessionId: "thinking-session", entryId: "m2", blockIndex: 0 },
  ]);
  const body = await res.json();
  assert.equal(body.data.thinking, "deferred text");
  assert.equal(body.error, undefined);
});

test("GET .../thinking maps a daemon thinking_block_not_found to 404", async (t) => {
  const restore = stubDaemon([
    () => ({ status: 404, body: { ok: false, error: "Thinking block not found", code: "thinking_block_not_found" } }),
  ]);
  t.after(restore);
  const res = await GET(
    new Request(
      "http://localhost/api/v1/sessions/thinking-session/entries/m2/thinking?blockIndex=0",
    ),
    { params: Promise.resolve({ id: "thinking-session", entryId: "m2" }) },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "thinking_block_not_found");
});
