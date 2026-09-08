import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createV1Jiti } from "../../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(
  new URL("./route.ts", import.meta.url).href,
);
const { cacheSessionPath } = await jiti.import(
  "../../../packages/pi-backend/sessions.ts",
);

const id = "state-route-test";

test("GET /api/v1/agent/[id]/state reports a live agent's state", async (t) => {
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isRunning: () => true,
    send: async () => ({ isStreaming: true }),
    sessionId: id,
    cwd: "/tmp",
  }]]);
  t.after(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const res = await GET(
    new Request(`http://localhost/api/v1/agent/${id}/state`),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.running, true);
  assert.deepEqual(body.data.state, { isStreaming: true });
  assert.equal(body.error, undefined);
});

test("GET /api/v1/agent/[id]/state reports a cold session as running:false", async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-v1-state-cold-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({
      type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: dir,
    })}\n${JSON.stringify({
      type: "message", id: "m1", timestamp: "2026-01-01T00:00:00.100Z",
      message: { role: "user", content: "hello" },
    })}\n`,
    );
    cacheSessionPath(id, filePath);
    const res = await GET(
      new Request(`http://localhost/api/v1/agent/${id}/state`),
      { params: Promise.resolve({ id }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.running, false);
    assert.equal(body.error, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/v1/agent/[id]/state maps an unknown session to session_not_found 404", async () => {
  const res = await GET(
    new Request("http://localhost/api/v1/agent/nope/state"),
    { params: Promise.resolve({ id: "nope" }) },
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
});
