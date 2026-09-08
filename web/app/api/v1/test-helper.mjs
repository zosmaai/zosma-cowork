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
