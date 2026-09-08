import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createV1Jiti } from "../../../../../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(
  new URL("./route.ts", import.meta.url).href,
);
const { cacheSessionPath } = await jiti.import(
  "../../../packages/pi-backend/sessions.ts",
);

function writeSessionJsonl(dir, id, lines) {
  const filePath = join(dir, "session.jsonl");
  const header = `${JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
  })}\n`;
  const body = lines.map((line) => `${JSON.stringify(line)}\n`).join("");
  writeFileSync(filePath, header + body);
  cacheSessionPath(id, filePath);
  return filePath;
}

test("GET .../thinking returns the deferred thinking block under { data }", async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-v1-thinking-"));
  const filePath = writeSessionJsonl(
    dir,
    "thinking-session",
    [
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.100Z",
        message: { role: "user", content: "hi" },
      },
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-01-01T00:00:00.200Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "deferred text" },
            { type: "text", text: "answer" },
          ],
        },
      },
    ],
  );
  try {
    const res = await GET(
      new Request(
        "http://localhost/api/v1/sessions/thinking-session/entries/m2/thinking?blockIndex=0",
      ),
      { params: Promise.resolve({ id: "thinking-session", entryId: "m2" }) },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.thinking, "deferred text");
    assert.equal(body.error, undefined);
  } finally {
    rmSync(filePath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET .../thinking maps a missing thinking block to thinking_block_not_found 404", async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-v1-thinking-"));
  const filePath = writeSessionJsonl(
    dir,
    "thinking-session",
    [
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.100Z",
        message: { role: "user", content: "hi" },
      },
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-01-01T00:00:00.200Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "answer" }],
        },
      },
    ],
  );
  try {
    const res = await GET(
      new Request(
        "http://localhost/api/v1/sessions/thinking-session/entries/m2/thinking?blockIndex=0",
      ),
      { params: Promise.resolve({ id: "thinking-session", entryId: "m2" }) },
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, "thinking_block_not_found");
  } finally {
    rmSync(filePath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
