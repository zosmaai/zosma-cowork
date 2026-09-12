// jiti factory for /api/v1 route tests. The `server-only` package is a
// Next.js build alias that does not resolve under plain node/jiti; alias it
// to an empty module so routes can import `getPiBackend()` unchanged.
import { createJiti } from "jiti";

const EMPTY_SERVER_ONLY = new URL("./empty-server-only.mjs", import.meta.url).href;

export function createV1Jiti() {
  return createJiti(import.meta.url, {
    alias: { "@": process.cwd(), "server-only": EMPTY_SERVER_ONLY },
    interopDefault: true,
    moduleCache: false,
  });
}

/**
 * Stub the daemon `/ipc` boundary for route tests (roadmap item 6: the v1
 * read routes relay through daemon-client → fetch).
 *
 * Sets ZOSMA_DAEMON_URL/TOKEN, replaces globalThis.fetch with a dispatcher.
 * `handlers` is either an array of `(body) => ({ status?, body })` consumed
 * in call order (one per daemon call), or a single function used as a
 * persistent router for every call. Returns a restore function (pass it to
 * `t.after`).
 */
export function stubDaemon(handlers) {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.ZOSMA_DAEMON_URL;
  const oldToken = process.env.ZOSMA_DAEMON_TOKEN;
  process.env.ZOSMA_DAEMON_URL = "http://127.0.0.1:64713";
  process.env.ZOSMA_DAEMON_TOKEN = "tok";
  let i = 0;
  const isRouter = typeof handlers === "function";
  globalThis.fetch = async (_url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    // A single function is a persistent router; an array is consumed in
    // call order (one handler per daemon call).
    const handler = isRouter ? handlers : handlers[i++];
    if (!handler) throw new Error(`unexpected daemon call ${i + 1}: ${JSON.stringify(body)}`);
    const reply = handler(body);
    return new Response(JSON.stringify(reply.body ?? reply), {
      status: reply.status ?? 200,
    });
  };
  return () => {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.ZOSMA_DAEMON_URL;
    else process.env.ZOSMA_DAEMON_URL = oldUrl;
    if (oldToken === undefined) delete process.env.ZOSMA_DAEMON_TOKEN;
    else process.env.ZOSMA_DAEMON_TOKEN = oldToken;
  };
}
