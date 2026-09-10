import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../app/api/v1/test-helper.mjs";

const jiti = createV1Jiti();
const { getSessionStream } = await jiti.import(
  new URL("./stream.ts", import.meta.url).href,
);

const alive = {
  isAlive: () => true,
  isStreaming: false,
  streamingMessage: null,
  onEvent: () => () => {},
};
const dead = {
  isAlive: () => false,
  isStreaming: false,
  streamingMessage: null,
  onEvent: () => () => {},
};

test("getSessionStream resolves the live wrapper", async () => {
  const runtime = { getSession: (id) => (id === "live" ? alive : undefined) };
  assert.strictEqual(await getSessionStream("live", runtime), alive);
});

test("getSessionStream rejects with session_not_found when the wrapper is missing", async () => {
  const runtime = { getSession: () => undefined };
  await assert.rejects(
    () => getSessionStream("ghost", runtime),
    (error) => error.code === "session_not_found" && error.message === "Session not found",
  );
});

test("getSessionStream rejects with session_not_found when the wrapper is not alive", async () => {
  const runtime = { getSession: () => dead };
  await assert.rejects(
    () => getSessionStream("dead", runtime),
    (error) => error.code === "session_not_found",
  );
});
