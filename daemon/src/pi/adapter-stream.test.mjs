/**
 * PiAdapter streaming transport tests (roadmap item 4).
 *
 * Drives `streamTurn` with a fake inner session (no live model): combined
 * one-shot streaming (turn embedded) and watch mode (resolve on the next
 * turn's terminal event). Agent dir is redirected to a temp dir so
 * SessionManager.create stays off `$HOME`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter } from "./adapter.ts";

/** Fake SDK AgentSession that emits native events on prompt/steer/followUp. */
function fakeInner() {
  const listeners = new Set();
  const emitAll = () => {
    for (const listener of [...listeners]) listener({ type: "message_start", message: { role: "assistant" } });
    for (const listener of [...listeners]) listener({ type: "agent_settled" });
  };
  const inner = {
    sessionId: "native-1",
    sessionFile: "/tmp/fake-s1.json",
    isStreaming: false,
    get sessionManager() {
      return { getCwd: () => "/tmp" };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt() {
      emitAll();
    },
    async steer() {
      emitAll();
    },
    async followUp() {
      emitAll();
    },
    abort() {
      return Promise.resolve();
    },
    clearQueue() {
      return { steering: [], followUp: [] };
    },
    dispose() {},
  };
  return inner;
}

function makeAdapter() {
  const agentDir = mkdtempSync(join(tmpdir(), "zosma-pi-agent-"));
  const storeDir = mkdtempSync(join(tmpdir(), "zosma-pi-store-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const inner = fakeInner();
  const adapter = new PiAdapter({
    storeDir,
    cwd: "/tmp",
    sessionFactory: async (sessionId, _manager, _opts) => ({ inner, realSessionId: sessionId }),
  });
  return { adapter, agentDir, storeDir, inner };
}

function cleanup({ agentDir, storeDir }) {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
}

test("streamTurn streams normalized events live with an embedded turn", async () => {
  const env = makeAdapter();
  try {
    const handle = await env.adapter.start("s1", "/tmp");
    const sink = [];
    const result = await env.adapter.streamTurn(handle.sessionId, { text: "hi", cid: "c9" }, (e) => sink.push(e));
    assert.equal(result.error, undefined);
    assert.equal(sink.length, 2, "live message + end frames");
    assert.equal(sink[0].kind, "message");
    assert.equal(sink[1].kind, "end");
  } finally {
    cleanup(env);
  }
});

test("streamTurn watch mode resolves on the next turn's terminal event", async () => {
  const env = makeAdapter();
  try {
    const handle = await env.adapter.start("s1", "/tmp");
    const sink = [];
    // Watch first: subscription is installed synchronously before the first await.
    const watch = env.adapter.streamTurn(handle.sessionId, undefined, (e) => sink.push(e));
    const result = await env.adapter.prompt(handle.sessionId, { text: "hello", cid: "c1" });
    assert.equal(result.error, undefined);
    const watched = await watch;
    assert.equal(watched.error, undefined);
    assert.equal(sink.length, 2, "watch sink saw the whole turn");
    assert.equal(sink[1].kind, "end");
  } finally {
    cleanup(env);
  }
});

test("streamTurn errors normalize: unknown session, empty turn", async () => {
  const env = makeAdapter();
  try {
    const missing = await env.adapter.streamTurn("nope", { text: "hi" }, () => {});
    assert.equal(missing.error?.code, "adapter_error");
    assert.equal(missing.error?.operation, "stream");
    const handle = await env.adapter.start("s1", "/tmp");
    const empty = await env.adapter.streamTurn(handle.sessionId, { text: "" }, () => {});
    assert.equal(empty.error?.operation, "stream");
  } finally {
    cleanup(env);
  }
});