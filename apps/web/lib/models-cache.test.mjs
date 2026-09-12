import assert from "node:assert/strict";
import test from "node:test";

// Roadmap item 6: the web models cache died with pi-backend — the daemon owns
// the 60s catalog cache (daemon/src/read/models.ts). The web keeps only the
// invalidate relay so credential changes (auth routes) bust the daemon cache
// immediately.

const { invalidateModelsCache } = await import("./models-cache.ts");

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test("invalidateModelsCache fires read:invalidate-models at the daemon", async () => {
  const seen = [];
  const restoreFetch = mockFetch(async (_url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, data: { ok: true } }), { status: 200 });
  });
  const oldUrl = process.env.ZOSMA_DAEMON_URL;
  const oldToken = process.env.ZOSMA_DAEMON_TOKEN;
  process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
  process.env.ZOSMA_DAEMON_TOKEN = "tok";
  try {
    invalidateModelsCache();
    // fire-and-forget — let the microtask + fetch settle
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(seen, [{ type: "read:invalidate-models" }]);
  } finally {
    process.env.ZOSMA_DAEMON_URL = oldUrl;
    process.env.ZOSMA_DAEMON_TOKEN = oldToken;
    restoreFetch();
  }
});

test("invalidateModelsCache is a no-op when the daemon is not configured", async () => {
  let fetchCalled = false;
  const restoreFetch = mockFetch(async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  });
  const oldUrl = process.env.ZOSMA_DAEMON_URL;
  const oldToken = process.env.ZOSMA_DAEMON_TOKEN;
  delete process.env.ZOSMA_DAEMON_URL;
  delete process.env.ZOSMA_DAEMON_TOKEN;
  try {
    invalidateModelsCache();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fetchCalled, false);
  } finally {
    if (oldUrl === undefined) delete process.env.ZOSMA_DAEMON_URL;
    else process.env.ZOSMA_DAEMON_URL = oldUrl;
    if (oldToken === undefined) delete process.env.ZOSMA_DAEMON_TOKEN;
    else process.env.ZOSMA_DAEMON_TOKEN = oldToken;
    restoreFetch();
  }
});
