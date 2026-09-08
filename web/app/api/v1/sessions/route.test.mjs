import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createV1Jiti } from "../test-helper.mjs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);
const { cacheSessionPath } = await jiti.import(
  "../../../packages/pi-backend/sessions.ts",
);

function resetListState() {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListPromise = undefined;
  globalThis.__piSessionListPromiseGeneration = undefined;
  globalThis.__piSessionListGeneration = 0;
}

test("GET /api/v1/sessions returns the list under { data } with no-store", async () => {
  resetListState();
  const dir = mkdtempSync(join(tmpdir(), "api-v1-sessions-"));
  const originalListAll = SessionManager.listAll;
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(
      filePath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "v1-list-session",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: dir,
      })}\n`,
    );
    cacheSessionPath("v1-list-session", filePath);
    SessionManager.listAll = async () => [
      {
        path: filePath,
        id: "v1-list-session",
        cwd: dir,
        name: "Session",
        created: new Date("2026-01-01T00:00:00.000Z"),
        modified: new Date("2026-01-01T00:00:01.000Z"),
        messageCount: 1,
        firstMessage: "hello",
        parentSessionPath: undefined,
      },
    ];
    const res = await GET(
      new Request("http://localhost/api/v1/sessions?force=1"),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const body = await res.json();
    assert.ok(Array.isArray(body.data.sessions));
    assert.ok(Array.isArray(body.data.runningSessionIds));
    assert.ok(body.data.sessions.some((s) => s.id === "v1-list-session"));
    assert.equal(body.error, undefined);
  } finally {
    SessionManager.listAll = originalListAll;
    rmSync(dir, { recursive: true, force: true });
  }
});
