/**
 * PiSession advanced-control command dispatch tests (ZOS-95).
 *
 * Drives `PiSession.command()` with a duck-typed fake AgentSession — no live
 * Pi SDK, no model. Covers the parity surface: model/thinking/tools, slash
 * commands, compaction, bash guards, fork, and the extension-UI request flow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PiSession } from "./session.ts";

let seq = 0;
function next() {
  return `id${++seq}`;
}

/** Quiet fake inner exposing the AgentSession surface `command()` touches. */
function fakeInner(overrides = {}) {
  const state = {
    sessionId: "native-1",
    sessionFile: "/tmp/s1.json",
    model: { id: "m1", provider: "openai" },
    modelCalls: 0,
    thinkingLevel: undefined,
    activeTools: ["read", "write"],
    allTools: [
      { name: "read", description: "read a file" },
      { name: "write", description: "write a file" },
      { name: "bash", description: "run a command" },
    ],
    sessionName: undefined,
    stats: { messageCount: 4 },
    queuedSteering: ["q1"],
    queuedFollowUp: ["q2"],
  };
  const uiContext = {};
  const runner = {
    getRegisteredCommands() {
      return [{ invocationName: "ext-cmd", description: "ext", sourceInfo: "x" }];
    },
    setUIContext(ctx) {
      Object.assign(uiContext, ctx);
    },
  };
  const inner = {
    sessionId: "native-1",
    sessionFile: "/tmp/s1.json",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: false,
    pendingMessageCount: 0,
    model: state.model,
    get modelRuntime() {
      return {
        getModel(provider, modelId) {
          state.modelCalls += 1;
          return provider === "openai" && modelId === "m1" ? { id: "m1", provider: "openai" } : undefined;
        },
        refresh() {
          return Promise.resolve();
        },
      };
    },
    get agent() {
      return { state: { systemPrompt: "sp", thinkingLevel: state.thinkingLevel ?? "off" } };
    },
    getContextUsage() {
      return { percent: 0.2, contextWindow: 100000, tokens: 20000 };
    },
    getActiveToolNames() {
      return [...state.activeTools];
    },
    getAllTools() {
      return state.allTools.map((t) => ({ ...t }));
    },
    setActiveToolsByName(names) {
      state.activeTools = [...names];
    },
    setThinkingLevel(level) {
      state.thinkingLevel = level;
    },
    setModel(model) {
      state.model = model;
      return Promise.resolve();
    },
    clearQueue() {
      return { steering: [...state.queuedSteering], followUp: [...state.queuedFollowUp] };
    },
    getSteeringMessages() {
      return [...state.queuedSteering];
    },
    getFollowUpMessages() {
      return [...state.queuedFollowUp];
    },
    setAutoCompactionEnabled(enabled) {
      state.autoCompactionEnabled = enabled;
    },
    setAutoRetryEnabled(enabled) {
      state.autoRetryEnabled = enabled;
    },
    setSessionName(name) {
      state.sessionName = name;
    },
    getSessionStats() {
      return { ...state.stats };
    },
    getLastAssistantText() {
      return "last text";
    },
    compact(custom) {
      return Promise.resolve({ compacted: custom ?? true });
    },
    abortCompaction() {},
    navigateTree(targetId) {
      return Promise.resolve({ cancelled: false });
    },
    executeBash(cmd, _onChunk, opts) {
      return Promise.resolve({ exitCode: 0, stdout: `out:${cmd}`, stderr: "", includeInContext: !opts?.excludeFromContext });
    },
    abortBash() {},
    reload() {
      return Promise.resolve();
    },
    get extensionRunner() {
      return runner;
    },
    promptTemplates: [{ name: "ptpl", description: "pt", sourceInfo: "p" }],
    get resourceLoader() {
      return { getSkills() { return { skills: [{ name: "sk", description: "s", sourceInfo: "r" }] }; } };
    },
    get sessionManager() {
      return { getCwd() { return "/tmp"; }, getSessionName() { return state.sessionName; } };
    },
    subscribe() {
      return () => {};
    },
    prompt() { return Promise.resolve(); },
    steer() { return Promise.resolve(); },
    followUp() { return Promise.resolve(); },
    abort() { return Promise.resolve(); },
    dispose() {},
    ...overrides,
  };
  return { inner, state, uiContext };
}

test("session commands: get_state shape", async () => {
  const { inner } = fakeInner();
  const s = new PiSession(inner, "h1");
  const st = await s.command({ type: "get_state" });
  assert.equal(st.sessionId, "native-1");
  assert.equal(st.isStreaming, false);
  assert.equal(st.model.id, "m1");
  assert.equal(st.thinkingLevel, "off");
  assert.equal(st.queuedMessages.steering[0], "q1");
});

test("session commands: set_model resolves + refreshes missing", async () => {
  const { inner } = fakeInner();
  const s = new PiSession(inner, "h1");
  const r = await s.command({ type: "set_model", provider: "openai", modelId: "m1" });
  assert.equal(r.id, "m1");
  // Unknown provider/model → refresh then Model not found error.
  await assert.rejects(s.command({ type: "set_model", provider: "anthropic", modelId: "x" }), /Model not found: anthropic\/x/);
});

test("session commands: set_thinking_level + set_tools/get_tools", async () => {
  const { inner, state } = fakeInner();
  const s = new PiSession(inner, "h1");
  await s.command({ type: "set_thinking_level", level: "high" });
  assert.equal(state.thinkingLevel, "high");
  await s.command({ type: "set_tools", toolNames: ["read"] });
  assert.deepEqual(state.activeTools, ["read"]);
  const tools = await s.command({ type: "get_tools" });
  assert.equal(tools.length, 3);
  assert.equal(tools[0].active, true);
  assert.equal(tools[2].active, false);
});

test("session commands: get_commands aggregates extension + prompt + skill", async () => {
  const { inner } = fakeInner();
  const s = new PiSession(inner, "h1");
  const { commands } = await s.command({ type: "get_commands" });
  const sources = commands.map((c) => c.source);
  assert.deepEqual(sources, ["extension", "prompt", "skill"]);
  assert.equal(commands[2].name, "skill:sk");
});

test("session commands: compact, session name, stats, last text, auto toggles, clear_queue", async () => {
  const { inner, state } = fakeInner();
  const s = new PiSession(inner, "h1");
  assert.equal((await s.command({ type: "compact", customInstructions: "c" })).compacted, "c");
  await s.command({ type: "set_session_name", name: "  my session  " });
  assert.equal(state.sessionName, "my session");
  const stats = await s.command({ type: "get_session_stats" });
  assert.equal(stats.messageCount, 4);
  assert.equal((await s.command({ type: "get_last_assistant_text" })).text, "last text");
  await s.command({ type: "set_auto_compaction", enabled: false });
  assert.equal(state.autoCompactionEnabled, false);
  await s.command({ type: "set_auto_retry", enabled: true });
  assert.equal(state.autoRetryEnabled, true);
  const cleared = await s.command({ type: "clear_queue" });
  assert.deepEqual(cleared, { steering: ["q1"], followUp: ["q2"] });
});

test("session commands: bash runs and is guarded while busy", async () => {
  const busy = fakeInner({ isBashRunning: true });
  await assert.rejects(new PiSession(busy.inner, "h1").command({ type: "bash", command: "ls" }), /session is busy/);
  const { inner } = fakeInner();
  const s = new PiSession(inner, "h1");
  const res = await s.command({ type: "bash", command: "ls", excludeFromContext: true });
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "out:ls");
  assert.equal(res.includeInContext, false);
  await s.command({ type: "abort_bash" });
});

test("session commands: navigate_tree + fork preconditions", async () => {
  const { inner } = fakeInner();
  const s = new PiSession(inner, "h1");
  assert.equal((await s.command({ type: "navigate_tree", targetId: "e1" })).cancelled, false);
  // Unpersisted session → fork cancelled.
  const up = fakeInner({ sessionFile: undefined, sessionManager: { getCwd() { return "/tmp"; }, getSessionName() { return undefined; }, isPersisted: () => false } });
  assert.deepEqual(await new PiSession(up.inner, "h1").command({ type: "fork", entryId: "e1" }), { cancelled: true });
});

test("session commands: extension UI select routes and resolves via response", async () => {
  const { inner, uiContext } = fakeInner();
  const s = new PiSession(inner, "h1");
  const events = [];
  s.onEvent((e) => events.push(e));

  const promise = uiContext.select("Pick", ["a", "b"]);
  // Event surfaced after a microtask.
  await new Promise((r) => setImmediate(r));
  const request = events.find((e) => e.payload?.phase === "extension_ui_request");
  assert.ok(request, "ui request event emitted");
  assert.equal(request.payload.method, "select");
  assert.equal(request.payload.title, "Pick");
  const id = request.payload.id;

  await s.command({ type: "extension_ui_response", id, response: { value: "b" } });
  assert.equal(await promise, "b");
});

test("session commands: unknown command throws", async () => {
  const { inner } = fakeInner();
  await assert.rejects(new PiSession(inner, "h1").command({ type: "nope" }), /Unsupported command: nope/);
});

test("session run: image validation rejects oversized/invalid attachments", async () => {
  const { inner } = fakeInner();
  const s = new PiSession(inner, "h1");
  await assert.rejects(s.run({ text: "x", images: [{ type: "jpeg", data: "aGVsbG8=", mimeType: "image/png" }] }), /Each attachment must be an image/);
  await assert.rejects(s.run({ text: "x", images: [{ type: "image", data: "abc", mimeType: "image/png" }] }), /valid base64/);
});
