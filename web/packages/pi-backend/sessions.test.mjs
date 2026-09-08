import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  autoNameSession,
  deleteSession,
  getSessionContext,
  getSessionDetails,
  getSessionThinking,
  listSessions,
  renameSession,
  cacheSessionPath,
} = await jiti.import("./sessions.ts");
const { createRuntimeManager } = await jiti.import("./runtime-manager.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

// A fresh registry: the services under test only read the path cache and the
// live wrapper for the sessions they touch, so a factory that throws is a
// sentinel — any real session startup would surface as a failure here.
function freshRuntime() {
  const state = {
    registry: new Map(),
    startLocks: new Map(),
    startingSessionCwds: new Map(),
    runningListeners: new Set(),
  };
  const runtime = createRuntimeManager(state, async () => {
    throw new Error("fake factory must not be called in these tests");
  });
  return { state, runtime };
}

// Clear the process-wide session-list cache keys so each test starts from an
// empty scan snapshot (the same recipe session-reader.test.mjs uses).
function resetListState() {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListPromise = undefined;
  globalThis.__piSessionListPromiseGeneration = undefined;
  globalThis.__piSessionListGeneration = 0;
}

// Writes a valid session JSONL (header + one user message) that the real
// SessionManager can parse; never calls SessionManager.create/mkdir.
function writeSession(dir, fileName, id, parentSession) {
  const filePath = join(dir, fileName);
  writeFileSync(
    filePath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: dir,
      ...(parentSession ? { parentSession } : {}),
    })}\n${JSON.stringify({
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: "hello" },
    })}\n`,
  );
  return filePath;
}

test("listSessions merges the persisted list with an empty runtime snapshot", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  const originalListAll = SessionManager.listAll;
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-list-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "list-session");
    cacheSessionPath("list-session", filePath);
    SessionManager.listAll = async () => [
      {
        path: filePath,
        id: "list-session",
        cwd: dir,
        name: "Session",
        created: new Date("2026-01-01T00:00:00.000Z"),
        modified: new Date("2026-01-01T00:00:01.000Z"),
        messageCount: 1,
        firstMessage: "hello",
        parentSessionPath: undefined,
      },
    ];
    const result = await listSessions({ }, runtime);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].id, "list-session");
    assert.deepEqual(result.runningSessionIds, []);
  } finally {
    SessionManager.listAll = originalListAll;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionDetails reads a cold session from its cached path", async () => {
  const { runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-details-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "cold-session");
    cacheSessionPath("cold-session", filePath);
    const details = await getSessionDetails({ sessionId: "cold-session" }, runtime);
    assert.equal(details.filePath, filePath);
    assert.equal(details.info?.id, "cold-session");
    assert.equal(details.context.messages.length, 1);
    assert.equal(details.context.messages[0].content, "hello");
    assert.ok(Number.isFinite(details.totalActiveMs));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionDetails serves a live runtime session from the registry", async () => {
  const { state, runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-live-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "live-session");
    const sm = SessionManager.open(filePath);
    state.registry.set("live-session", {
      isAlive: () => true,
      sessionFile: filePath,
      cwd: dir,
      sessionId: "live-session",
      isRunning: () => true,
      inner: { sessionManager: sm },
      shutdown: async () => {},
    });
    const details = await getSessionDetails({ sessionId: "live-session" }, runtime);
    assert.equal(details.filePath, filePath);
    assert.equal(details.info?.transient, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionDetails rejects unknown sessions as session_not_found", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  await assert.rejects(
    getSessionDetails({ sessionId: "no-such-session" }, runtime),
    (error) => error instanceof Error && error.code === "session_not_found" && error.message === "Session not found",
  );
});

test("getSessionContext returns context with the message content", async () => {
  const { runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-context-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "ctx-session");
    cacheSessionPath("ctx-session", filePath);
    const context = await getSessionContext({ sessionId: "ctx-session" }, runtime);
    assert.equal(context.messages.length, 1);
    assert.equal(context.messages[0].content, "hello");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionContext rejects unknown sessions as session_not_found", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  await assert.rejects(
    getSessionContext({ sessionId: "no-such-session" }, runtime),
    (error) => error instanceof Error && error.code === "session_not_found",
  );
});

test("getSessionContext defers assistant thinking when requested", async () => {
  const { runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-defer-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(
      filePath,
      `${JSON.stringify({ type: "session", version: 3, id: "ctx-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n${JSON.stringify({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", provider: "test", model: "m", content: [{ type: "thinking", thinking: "secret reasoning" }, { type: "text", text: "answer" }] } })}\n`,
    );
    cacheSessionPath("ctx-session", filePath);
    const context = await getSessionContext({ sessionId: "ctx-session", deferThinking: true }, runtime);
    const thinking = context.messages[0].content.find((block) => block.type === "thinking");
    assert.equal(thinking.thinking, "");
    assert.equal(thinking.deferred, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionThinking returns thinking for a real blockIndex", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-thinking-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(
      filePath,
      `${JSON.stringify({ type: "session", version: 3, id: "think-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n${JSON.stringify({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", provider: "test", model: "m", content: [{ type: "thinking", thinking: "deferred text" }, { type: "text", text: "answer" }] } })}\n`,
    );
    cacheSessionPath("think-session", filePath);
    const result = await getSessionThinking({ sessionId: "think-session", entryId: "a1", blockIndex: 0 });
    assert.deepEqual(result, { thinking: "deferred text" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionThinking rejects unknown sessions as session_not_found", async () => {
  resetListState();
  await assert.rejects(
    getSessionThinking({ sessionId: "no-such-session", entryId: "a1", blockIndex: 0 }),
    (error) => error instanceof Error && error.code === "session_not_found",
  );
});

test("getSessionThinking rejects a missing or non-integer blockIndex as invalid_request", async () => {
  resetListState();
  for (const blockIndex of [Number.NaN, 1.5, -1]) {
    await assert.rejects(
      getSessionThinking({ sessionId: "x", entryId: "a1", blockIndex }),
      (error) => error instanceof Error && error.code === "invalid_request" && error.message === "Valid blockIndex is required",
    );
  }
});

test("renameSession appends the new name and invalidates the list cache", async () => {
  resetListState();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-rename-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "rename-session");
    cacheSessionPath("rename-session", filePath);
    const result = await renameSession({ sessionId: "rename-session", name: "New Name" });
    assert.deepEqual(result, { success: true, sessionId: "rename-session" });
    assert.equal(SessionManager.open(filePath).getSessionName(), "New Name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renameSession rejects unknown sessions as session_not_found", async () => {
  resetListState();
  await assert.rejects(
    renameSession({ sessionId: "no-such-session", name: "x" }),
    (error) => error instanceof Error && error.code === "session_not_found",
  );
});

test("deleteSession re-parents children, shuts down the live wrapper, and unlinks", async () => {
  const { state, runtime } = freshRuntime();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-delete-"));
  try {
    const parentPath = writeSession(dir, "parent.jsonl", "parent-session");
    const childPath = writeSession(dir, "child.jsonl", "child-session", parentPath);
    cacheSessionPath("parent-session", parentPath);
    cacheSessionPath("child-session", childPath);
    let shutdownCalls = 0;
    state.registry.set("parent-session", {
      isAlive: () => true,
      shutdown: async () => { shutdownCalls += 1; },
    });
    const result = await deleteSession({ sessionId: "parent-session" }, runtime);
    assert.deepEqual(result, { success: true, sessionId: "parent-session" });
    assert.equal(shutdownCalls, 1);
    let parentStillExists = true;
    try { statSync(parentPath); } catch { parentStillExists = false; }
    assert.equal(parentStillExists, false);
    const childHeader = JSON.parse(readFileSync(childPath, "utf8").split("\n")[0]);
    assert.equal(childHeader.parentSession, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteSession rejects unknown sessions as session_not_found", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  await assert.rejects(
    deleteSession({ sessionId: "no-such-session" }, runtime),
    (error) => error instanceof Error && error.code === "session_not_found",
  );
});

test("autoNameSession rejects unknown sessions as session_not_found", async () => {
  resetListState();
  const { runtime } = freshRuntime();
  await assert.rejects(
    autoNameSession({ sessionId: "no-such-session" }, runtime),
    (error) => error instanceof Error && error.code === "session_not_found",
  );
});

test("getSessionThinking rejects a missing assistant entry as entry_not_found", async () => {
  resetListState();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-entry-"));
  try {
    const filePath = writeSession(dir, "session.jsonl", "thinking-session");
    cacheSessionPath("thinking-session", filePath);
    await assert.rejects(
      getSessionThinking({ sessionId: "thinking-session", entryId: "missing-entry", blockIndex: 0 }),
      (error) => error instanceof Error
        && error.code === "entry_not_found"
        && error.message === "Assistant message not found",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getSessionThinking rejects a non-thinking block as thinking_block_not_found", async () => {
  resetListState();
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-sessions-block-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(
      filePath,
      `${JSON.stringify({ type: "session", version: 3, id: "thinking-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n${JSON.stringify({
        type: "message",
        id: "a1",
        timestamp: "2026-01-01T00:00:00.100Z",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: "2026-01-01T00:00:00.100Z" },
      })}\n`,
    );
    cacheSessionPath("thinking-session", filePath);
    await assert.rejects(
      getSessionThinking({ sessionId: "thinking-session", entryId: "a1", blockIndex: 0 }),
      (error) => error instanceof Error
        && error.code === "thinking_block_not_found"
        && error.message === "Thinking block not found",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
