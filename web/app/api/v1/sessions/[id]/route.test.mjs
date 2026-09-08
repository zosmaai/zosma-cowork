import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createV1Jiti } from "../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);
const { cacheSessionPath } = await jiti.import(
  "../../../packages/pi-backend/sessions.ts",
);

function rebuildParams(sessionId) {
  return { params: Promise.resolve({ id: sessionId }) };
}

test("GET /api/v1/sessions/[id] returns details in { data } with defer flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-v1-detail-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(
      filePath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "detail-session",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: dir,
      })}\n${JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-01-01T00:00:00.100Z",
        message: { role: "user", content: "hello" },
      })}\n`,
    );
    cacheSessionPath("detail-session", filePath);
    const res = await GET(
      new Request(
        "http://localhost/api/v1/sessions/detail-session?deferThinking=1&deferMedia=1",
      ),
      rebuildParams("detail-session"),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.sessionId, "detail-session");
    assert.equal(body.data.info.id, "detail-session");
    assert.ok(Array.isArray(body.data.context.messages));
    assert.equal(body.error, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/v1/sessions/[id] maps a missing session to session_not_found 404", async () => {
  const res = await GET(
    new Request("http://localhost/api/v1/sessions/nope"),
    rebuildParams("nope"),
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "session_not_found");
  assert.equal(body.error.message, "Session not found");
});
