import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false, alias: { "@": process.cwd() } });
const { createPiBackend } = await jiti.import("./index.ts");
const { createRuntimeManager } = await jiti.import("./runtime-manager.ts");
const { cacheSessionPath } = await jiti.import("./sessions.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

test("PiBackend reports health without starting a runtime", async () => {
  const backend = createPiBackend({ piVersion: "0.84.2" });

  assert.deepEqual(await backend.getHealth(), {
    status: "ok",
    apiVersion: "v1",
    piVersion: "0.84.2",
  });
});

test("PiBackend advertises only the transports and preserved capabilities in scope", async () => {
  const backend = createPiBackend({ piVersion: "0.84.2" });

  assert.deepEqual(await backend.getCapabilities(), {
    apiVersion: "v1",
    commandTransports: ["http"],
    eventTransports: ["sse"],
    features: {
      concurrentSessions: true,
      prompt: true,
      abort: true,
      steering: true,
      followUp: true,
      sessionBranches: true,
      bash: true,
      extensions: true,
    },
  });
});

test("PiBackend.listSessions delegates to the session service with the injected runtime", async () => {
  const state = { registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() };
  const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager(state, async () => { throw new Error("factory unused"); }) });
  const originalListAll = SessionManager.listAll;
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-facade-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({ type: "session", version: 3, id: "facade-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n`);
    cacheSessionPath("facade-session", filePath);
    globalThis.__piSessionListCache = undefined;
    globalThis.__piSessionListGeneration = 0;
    SessionManager.listAll = async () => [{
      path: filePath, id: "facade-session", cwd: dir, name: "S",
      created: new Date("2026-01-01T00:00:00.000Z"), modified: new Date("2026-01-01T00:00:00.000Z"),
      messageCount: 0, firstMessage: "(no messages)", parentSessionPath: undefined,
    }];
    const result = await backend.listSessions({ });
    assert.deepEqual(result.runningSessionIds, []);
    assert.equal(result.sessions[0].id, "facade-session");
  } finally {
    SessionManager.listAll = originalListAll;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PiBackend.getModels delegates to the model service", async () => {
  const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager({ registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() }, async () => { throw new Error("factory unused"); }) });
  const cwd = mkdtempSync(join(tmpdir(), "pi-backend-facade-models-"));
  try {
    const data = await backend.getModels({ cwd });
    assert.ok(Array.isArray(data.modelList));
    assert.equal(typeof data.models, "object");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("PiBackend.getRunningSessionIds delegates to the runtime manager", async () => {
  const state = { registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() };
  state.registry.set("idle-session", { isAlive: () => true, isRunning: () => true, sessionId: "idle-session", cwd: "/tmp" });
  const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager(state, async () => { throw new Error("factory unused"); }) });
  assert.deepEqual(await backend.getRunningSessionIds(), ["idle-session"]);
});

test("PiBackend.getAgentState reports live state, running:false, or session_not_found", async () => {
  const state = { registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() };
  state.registry.set("live-session", {
    isAlive: () => true,
    send: async () => ({ model: { id: "m", provider: "p" }, messageCount: 3 }),
    sessionId: "live-session",
  });
  const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager(state, async () => { throw new Error("factory unused"); }) });
  const live = await backend.getAgentState({ sessionId: "live-session" });
  assert.equal(live.running, true);
  assert.equal(live.state.messageCount, 3);
});

test("PiBackend.getAgentState uses path existence to distinguish idle from missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-backend-state-"));
  try {
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, `${JSON.stringify({ type: "session", version: 3, id: "cold-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n`);
    cacheSessionPath("cold-session", filePath);
    globalThis.__piSessionListCache = undefined;
    globalThis.__piSessionListGeneration = 0;
    const backend = createPiBackend({ piVersion: "0.84.2", runtime: createRuntimeManager({ registry: new Map(), startLocks: new Map(), startingSessionCwds: new Map(), runningListeners: new Set() }, async () => { throw new Error("factory unused"); }) });
    const idle = await backend.getAgentState({ sessionId: "cold-session" });
    assert.deepEqual(idle, { running: false });
    await assert.rejects(
      backend.getAgentState({ sessionId: "no-such-session" }),
      (error) => error instanceof Error && error.code === "session_not_found" && error.message === "Session not found",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
