import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { NextRequest } = await jiti.import("next/server");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");

/**
 * The session-root gate relays through the daemon (`listAllSessions` →
 * `piRead("list-sessions")`), so this route test serves a minimal fake IPC
 * backend instead of requiring a live daemon. The supervisor always sets
 * ZOSMA_DAEMON_URL/ZOSMA_DAEMON_TOKEN in production; the fake mirrors that
 * contract with an empty session list.
 */
async function startFakeDaemon() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, status: 200, data: { sessions: [] } }));
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

test("GET /api/git/status returns git_unavailable when Git is absent", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "zosma-web-no-git-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const daemon = await startFakeDaemon();
  t.after(() => daemon.close());
  const previousEnv = {
    PATH: process.env.PATH,
    daemonUrl: process.env.ZOSMA_DAEMON_URL,
    daemonToken: process.env.ZOSMA_DAEMON_TOKEN,
  };
  process.env.ZOSMA_DAEMON_URL = daemon.url;
  process.env.ZOSMA_DAEMON_TOKEN = "test-token";
  process.env.PATH = path.join(os.tmpdir(), "zosma-no-git-path");
  allowFileRoot(cwd);
  try {
    const request = new NextRequest(`http://localhost/api/git/status?cwd=${encodeURIComponent(cwd)}`);
    const response = await GET(request);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "git_unavailable" });
  } finally {
    for (const key of ["PATH", "ZOSMA_DAEMON_URL", "ZOSMA_DAEMON_TOKEN"]) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});