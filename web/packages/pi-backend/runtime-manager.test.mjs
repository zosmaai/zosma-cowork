import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { createRuntimeManager } = await jiti.import("./runtime-manager.ts");

function freshState() {
  return { registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() };
}

// The default factory builds the inner Pi session, but here we substitute a fake
// SessionFactory so the manager's registry logic can be tested without the Pi SDK.
// Signature is (sessionId, sessionManager, options): `sessionManager` is the real
// SessionManager that RuntimeManager.startSession already constructed, and options
// is the { toolNames, initialModel, thinkingLevel } object the manager forwards.
function fakeFactory(calls, opts = {}) {
  return async (sessionId, sessionManager, options) => {
    calls.push({ sessionId, sessionManager, options });
    const inner = {
      sessionId,
      sessionFile: opts.sessionFile,
      sessionManager, // real SessionManager, has getCwd()
      extensionRunner: {},
      subscribe: () => () => {},
      dispose: () => {},
      isBashRunning: false,
      isStreaming: !!opts.running,
      isCompacting: false,
    };
    return { inner, realSessionId: sessionId };
  };
}

async function makeManager(calls = [], opts = {}) {
  const state = freshState();
  const manager = createRuntimeManager(state, fakeFactory(calls, opts));
  return { manager, state };
}

const all = (state) => Array.from(state.registry.values());

test("concurrent starts for one session resolve to one runtime", async () => {
  const calls = [];
  const { manager, state } = await makeManager(calls);
  try {
    const [a, b] = await Promise.all([
      manager.startSession("one", "", "/tmp", {}),
      manager.startSession("one", "", "/tmp", {}),
    ]);
    assert.equal(a.session, b.session);
    assert.equal(calls.length, 1);
  } finally {
    for (const s of all(state)) s.destroy();
  }
});

test("different session ids start independent runtimes", async () => {
  const calls = [];
  const { manager, state } = await makeManager(calls);
  try {
    const [a, b] = await Promise.all([
      manager.startSession("a", "", "/tmp", {}),
      manager.startSession("b", "", "/tmp", {}),
    ]);
    assert.equal(calls.length, 2);
    assert.notEqual(a.session, b.session);
    // Same sessionId but a different in-flight path is still deduplicated.
    const again = await manager.startSession("a", "", "/tmp", {});
    assert.equal(again.session, a.session);
  } finally {
    for (const s of all(state)) s.destroy();
  }
});

test("the running-session subscription unsubscribes cleanly", async () => {
  const { manager, state } = await makeManager();
  const seen = [];
  const unsubscribe = manager.subscribeRunningSessions((ids) => seen.push(ids));
  manager.notifyRunningChange();
  assert.ok(seen.length >= 1);
  unsubscribe();
  manager.notifyRunningChange();
  assert.equal(state.runningListeners.size, 0);
  assert.equal(seen.length, 1);
});

test("notifyRunningChange clears its snapshot when the last listener leaves", async () => {
  const { manager } = await makeManager();
  const first = [];
  const unsubscribe = manager.subscribeRunningSessions((ids) => first.push(ids));
  manager.notifyRunningChange();
  unsubscribe();
  manager.notifyRunningChange(); // no listeners -> snapshot resets
  const second = [];
  const unsubscribe2 = manager.subscribeRunningSessions((ids) => second.push(ids));
  manager.notifyRunningChange();
  assert.equal(second.length, 1); // fresh snapshot delivered, not skipped as stale
  unsubscribe2();
});

test("destroySessionsForCwd shuts down only matching sessions", async () => {
  const { manager, state } = await makeManager();
  try {
    await Promise.all([
      manager.startSession("a", "", "/tmp/a", {}),
      manager.startSession("b", "", "/tmp/b", {}),
    ]);
    assert.equal(await manager.destroySessionsForCwd("/tmp/a"), 1);
    assert.equal(state.registry.has("a"), false);
    assert.equal(state.registry.has("b"), true);
  } finally {
    for (const s of all(state)) s.destroy();
  }
});

test("getRunningSessionIds reports only sessions with a running inner", async () => {
  const idle = [];
  const { manager: idleManager } = await makeManager(idle);
  try {
    await idleManager.startSession("idle", "", "/tmp/idle", {});
    assert.deepEqual(idleManager.getRunningSessionIds(), []);
  } finally {
    for (const s of all(idleManager.state)) s.destroy();
  }

  const running = [];
  const { manager: runningManager } = await makeManager(running, { running: true });
  try {
    await runningManager.startSession("live", "", "/tmp/live", {});
    const ids = runningManager.getRunningSessionIds();
    assert.deepEqual([...ids].sort(), ["live"]);
  } finally {
    for (const s of all(runningManager.state)) s.destroy();
  }
});

test("hasBusySessionForCwd reports a running session in the cwd", async () => {
  const calls = [];
  const { manager, state } = await makeManager(calls, { running: true });
  try {
    await manager.startSession("a", "", "/tmp/xyz", {});
    assert.equal(manager.hasBusySessionForCwd("/tmp/xyz"), true);
    assert.equal(manager.hasBusySessionForCwd("/tmp/not-here"), false);
  } finally {
    for (const s of all(state)) s.destroy();
  }
});

test("getSession returns the registered wrapper by id", async () => {
  const calls = [];
  const { manager, state } = await makeManager(calls);
  try {
    const res = await manager.startSession("a", "", "/tmp", {});
    assert.equal(manager.getSession("a"), res.session);
    assert.equal(manager.getSession("missing"), undefined);
  } finally {
    for (const s of all(state)) s.destroy();
  }
});
