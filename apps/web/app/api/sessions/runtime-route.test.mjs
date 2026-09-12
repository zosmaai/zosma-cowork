import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// Roadmap item 6: the session read surface left the web process. These routes
// are thin relays to the daemon's read:* ops — the JSONL parsing and live
// session registry now live in daemon/src/read/ (covered by daemon tests).
const listRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET: getSessionDetail } = await jiti.import("./[id]/route.ts");

test("session listing honors force refresh and relays to the daemon", () => {
  assert.match(listRoute, /searchParams\.get\("force"\) === "1"/);
  assert.match(listRoute, /"Cache-Control": "no-store"/);
  assert.match(listRoute, /piRead\("list-sessions"/);
  assert.doesNotMatch(listRoute, /getRunningSessionIds/);
});

test("session details relay read:session-details to the daemon", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.ZOSMA_DAEMON_URL;
  const oldToken = process.env.ZOSMA_DAEMON_TOKEN;
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ ok: true, data: { info: { id: "s1", transient: false }, context: { messages: [] } } }),
      { status: 200 },
    );
  };
  process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
  process.env.ZOSMA_DAEMON_TOKEN = "tok";
  t.after(() => {
    globalThis.fetch = originalFetch;
    process.env.ZOSMA_DAEMON_URL = oldUrl;
    process.env.ZOSMA_DAEMON_TOKEN = oldToken;
  });

  const res = await getSessionDetail(
    new Request("http://localhost/api/sessions/s1?deferThinking=1"),
    { params: Promise.resolve({ id: "s1" }) },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.info.id, "s1");
  assert.deepEqual(calls, [{ type: "read:session-details", sessionId: "s1", deferThinking: true, deferMedia: false }]);
});
