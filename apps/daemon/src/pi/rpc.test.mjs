/**
 * Pi adapter RPC dispatch tests (ZOS-93 wiring B).
 *
 * Drives `handlePiRpc` with a fake adapter — no live Pi SDK, no model. Covers
 * the security gate (cwd must be an allowed root), each `pi:*` op mapping,
 * error normalization, and the server-level 501 when no adapter is wired.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { allowFileRoot, getAdditionalAllowedRoots } from "../git/allowed-roots.ts";
import { getAllowedFileRoots } from "../git/file-access.ts";
import { handlePiRpc, handlePiStream } from "./rpc.ts";

/** Minimal in-memory fake of the PiAdapter surface used by handlePiRpc. */
function fakeAdapter() {
  const calls = [];
  const adapter = {
    calls,
    probe() {
      calls.push(["probe"]);
    },
    async start(sessionId, cwd, options) {
      calls.push(["start", sessionId, cwd, options]);
      return { sessionId: sessionId ?? "s1", state: "running", nativeSessionId: "n1" };
    },
    async resume(sessionId, sessionFile) {
      calls.push(["resume", sessionId, sessionFile]);
      return { sessionId, state: "running", nativeSessionId: "n1" };
    },
    async prompt(sessionId, turn) {
      calls.push(["prompt", sessionId, turn]);
      return {
        events: [{ cid: turn.cid ?? "c", seq: 1, kind: "end", payload: {} }],
        ...(turn.text === "boom" ? { error: { code: "pi.prompt", message: "oom" } } : {}),
      };
    },
    async command(sessionId, command) {
      calls.push(["command", sessionId, command]);
      if (command.type === "boom") throw new Error("command boom");
      return { ok: true, type: command.type };
    },
    async streamTurn(sessionId, turn, sink) {
      calls.push(["stream", sessionId, turn]);
      if (turn?.text === "boom") return { error: { code: "pi.stream", message: "boom" } };
      sink({ cid: "c1", seq: 1, kind: "message", payload: { text: turn?.text ?? "" } });
      sink({ cid: "c1", seq: 2, kind: "end", payload: {} });
      return { events: [] };
    },
    async update(sessionId, patch) {
      calls.push(["update", sessionId, patch]);
      return { sessionId, state: patch.status ?? "running", nativeSessionId: "n1" };
    },
    async cancel(sessionId) {
      calls.push(["cancel", sessionId]);
      return { sessionId, state: "idle", nativeSessionId: "n1" };
    },
    async close(sessionId) {
      calls.push(["close", sessionId]);
    },
    health() {
      calls.push(["health"]);
      return { ready: true };
    },
    async dispose() {
      calls.push(["dispose"]);
    },
  };
  return adapter;
}

async function gateRoots() {
  const dir = mkdtempSync(join(tmpdir(), "zosma-pi-rpc-"));
  const roots = getAdditionalAllowedRoots();
  roots.clear();
  allowFileRoot(dir);
  await getAllowedFileRoots(() => Promise.resolve([]), true);
  return dir;
}

async function noRoots() {
  getAdditionalAllowedRoots().clear();
  await getAllowedFileRoots(() => Promise.resolve([]), true);
}

test("pi:start outside allowed roots is 403", async () => {
  await noRoots();
  const res = await handlePiRpc(fakeAdapter(), { type: "pi:start", cwd: "/etc" });
  assert.equal(res.status, 403);
});

test("pi:start with allowed cwd dispatches start(cwd)", async () => {
  const dir = await gateRoots();
  try {
    const a = fakeAdapter();
    const res = await handlePiRpc(a, { type: "pi:start", cwd: dir, sessionId: "sx" });
    assert.equal(res.status, 200);
    const [, sid, cwd] = a.calls.find((c) => c[0] === "start");
    assert.equal(sid, "sx");
    assert.equal(cwd, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pi:probe and pi:health map to adapter calls", async () => {
  const a = fakeAdapter();
  assert.equal((await handlePiRpc(a, { type: "pi:probe" })).status, 200);
  const h = await handlePiRpc(a, { type: "pi:health" });
  assert.equal(h.status, 200);
  assert.equal(h.body.ready, true);
});

test("pi:start forwards model scope and thinking to the adapter", async () => {
  const dir = await gateRoots();
  try {
    const a = fakeAdapter();
    const res = await handlePiRpc(a, {
      type: "pi:start",
      cwd: dir,
      sessionId: "sx",
      model: { provider: "anthropic", modelId: "claude-opus-4-5" },
      thinkingLevel: "xhigh",
      toolNames: ["read", "bash"],
    });
    assert.equal(res.status, 200);
    const [, , , options] = a.calls.find((c) => c[0] === "start");
    assert.deepEqual(options.model, { provider: "anthropic", modelId: "claude-opus-4-5" });
    assert.equal(options.thinkingLevel, "xhigh");
    assert.deepEqual(options.toolNames, ["read", "bash"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pi:start forwards model config even without cwd (adapter default workspace)", async () => {
  await noRoots();
  const a = fakeAdapter();
  const res = await handlePiRpc(a, { type: "pi:start", model: { provider: "openai", modelId: "gpt-5" }, thinkingLevel: "low" });
  assert.equal(res.status, 200);
  const [, , , options] = a.calls.find((c) => c[0] === "start");
  assert.deepEqual(options.model, { provider: "openai", modelId: "gpt-5" });
  assert.equal(options.thinkingLevel, "low");
});

test("pi:start without cwd is allowed (adapter default workspace)", async () => {
  await noRoots();
  const a = fakeAdapter();
  const res = await handlePiRpc(a, { type: "pi:start" });
  assert.equal(res.status, 200);
  assert.ok(a.calls.some((c) => c[0] === "start"));
});

test("pi:prompt passes text/cid/mode through", async () => {
  const a = fakeAdapter();
  const res = await handlePiRpc(a, { type: "pi:prompt", sessionId: "s1", text: "hi", cid: "c9", mode: "steer" });
  assert.equal(res.status, 200);
  const [, , turn] = a.calls.find((c) => c[0] === "prompt");
  assert.equal(turn.text, "hi");
  assert.equal(turn.cid, "c9");
  assert.equal(turn.mode, "steer");
  assert.equal(res.body.events.length, 1);
});

test("pi:prompt passes base64 images through", async () => {
  const a = fakeAdapter();
  const res = await handlePiRpc(a, {
    type: "pi:prompt", sessionId: "s1", text: "see this",
    images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
  });
  assert.equal(res.status, 200);
  const [, , turn] = a.calls.find((c) => c[0] === "prompt");
  assert.equal(turn.images.length, 1);
  assert.equal(turn.images[0].mimeType, "image/png");
});

test("pi:command dispatches sessionId + command and returns result", async () => {
  const a = fakeAdapter();
  const res = await handlePiRpc(a, { type: "pi:command", sessionId: "s1", command: { type: "set_thinking_level", level: "high" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.ok, true);
  assert.equal(res.body.result.type, "set_thinking_level");
  const [, sid, command] = a.calls.find((c) => c[0] === "command");
  assert.equal(sid, "s1");
  assert.equal(command.type, "set_thinking_level");
  assert.equal(command.level, "high");
});

test("pi:command requires sessionId and command.type", async () => {
  assert.equal((await handlePiRpc(fakeAdapter(), { type: "pi:command" })).status, 400);
  assert.equal((await handlePiRpc(fakeAdapter(), { type: "pi:command", sessionId: "s1" })).status, 400);
  assert.equal((await handlePiRpc(fakeAdapter(), { type: "pi:command", sessionId: "s1", command: { nope: 1 } })).status, 400);
});

test("pi:command adapter error normalizes to 400", async () => {
  const a = fakeAdapter();
  const res = await handlePiRpc(a, { type: "pi:command", sessionId: "s1", command: { type: "boom" } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "command boom");
});

test("pi:stream combined streams events to sink then resolves", async () => {
  const a = fakeAdapter();
  const seen = [];
  const res = await handlePiStream(a, {
    type: "pi:stream",
    sessionId: "s1",
    turn: { text: "hi", cid: "c9", mode: "steer", images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }] },
  }, (e) => seen.push(e));
  assert.equal(res.status, 200);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].kind, "message");
  assert.equal(seen[1].kind, "end");
  const [, sid, turn] = a.calls.find((c) => c[0] === "stream");
  assert.equal(sid, "s1");
  assert.equal(turn.text, "hi");
  assert.equal(turn.mode, "steer");
  assert.equal(turn.images[0].mimeType, "image/png");
});

test("pi:stream watch mode passes no turn", async () => {
  const a = fakeAdapter();
  const seen = [];
  const res = await handlePiStream(a, { type: "pi:stream", sessionId: "s1" }, (e) => seen.push(e));
  assert.equal(res.status, 200);
  const [, , turn] = a.calls.find((c) => c[0] === "stream");
  assert.equal(turn, undefined);
});

test("pi:stream normalizes errors and missing fields to 400", async () => {
  const a = fakeAdapter();
  assert.equal((await handlePiStream(a, { type: "pi:stream", sessionId: "s1", turn: { text: "boom" } }, () => {})).status, 400);
  assert.equal((await handlePiStream(a, { type: "pi:stream", sessionId: "s1", turn: {} }, () => {})).status, 400);
  assert.equal((await handlePiStream(a, { type: "pi:stream", sessionId: "s1", turn: { text: "" } }, () => {})).status, 400);
});

test("pi:prompt normalizes adapter error to 400", async () => {
  const a = fakeAdapter();
  const res = await handlePiRpc(a, { type: "pi:prompt", sessionId: "s1", text: "boom" });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test("pi:prompt rejects missing sessionId/text", async () => {
  assert.equal((await handlePiRpc(fakeAdapter(), { type: "pi:prompt", sessionId: "s" })).status, 400);
  assert.equal((await handlePiRpc(fakeAdapter(), { type: "pi:prompt", text: "hi" })).status, 400);
});

test("pi:resume, pi:update, pi:cancel, pi:close map through", async () => {
  const a = fakeAdapter();
  assert.equal((await handlePiRpc(a, { type: "pi:resume", sessionId: "s1" })).status, 200);
  const up = await handlePiRpc(a, { type: "pi:update", sessionId: "s1", status: "paused" });
  assert.equal(up.status, 200);
  assert.equal(up.body.state, "paused");
  const cancel = await handlePiRpc(a, { type: "pi:cancel", sessionId: "s1" });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.state, "idle");
  assert.equal((await handlePiRpc(a, { type: "pi:close", sessionId: "s1" })).status, 200);
  const names = a.calls.map((c) => c[0]);
  assert.deepEqual(names, ["resume", "update", "cancel", "close"]);
});

test("pi:resume/update/cancel/close require sessionId", async () => {
  for (const type of ["pi:resume", "pi:update", "pi:cancel", "pi:close"]) {
    const res = await handlePiRpc(fakeAdapter(), { type });
    assert.equal(res.status, 400, type);
  }
});

test("pi:dispose dispatches to the adapter", async () => {
  const a = fakeAdapter();
  assert.equal((await handlePiRpc(a, { type: "pi:dispose" })).status, 200);
  assert.ok(a.calls.some((c) => c[0] === "dispose"));
});

test("adapter throws normalize to 500; unknown op to 404", async () => {
  const exploding = {
    ...fakeAdapter(),
    async start() {
      throw new Error("kaboom");
    },
  };
  // No cwd → gate passes (undefined short-circuits), adapter throws → 500.
  assert.equal((await handlePiRpc(exploding, { type: "pi:start" })).status, 500);
  assert.equal((await handlePiRpc(fakeAdapter(), { type: "pi:nope" })).status, 404);
});

test("pi:list returns adapter session handles", async () => {
  const a = {
    ...fakeAdapter(),
    async listSessions() {
      a.calls.push(["list"]);
      return [{ sessionId: "s1", state: "running", nativeSessionId: "n1" }];
    },
  };
  const res = await handlePiRpc(a, { type: "pi:list" });
  assert.equal(res.status, 200);
  assert.equal(res.body.sessions[0].sessionId, "s1");
  assert.equal(res.body.sessions[0].state, "running");
  assert.ok(a.calls.some((c) => c[0] === "list"));
});

test("pi:resume forwards sessionFile when supplied", async () => {
  const dir = await gateRoots();
  try {
    mkdirSync(join(dir, "sessions"), { recursive: true });
    const file = join(dir, "sessions", "s1.json");
    writeFileSync(file, "{}");
    const a = fakeAdapter();
    const res = await handlePiRpc(a, { type: "pi:resume", sessionId: "s1", sessionFile: file });
    assert.equal(res.status, 200);
    const [, sid, sessionFile] = a.calls.find((c) => c[0] === "resume");
    assert.equal(sid, "s1");
    assert.equal(sessionFile, file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pi:resume with sessionFile outside allowed roots is 403", async () => {
  await noRoots();
  const res = await handlePiRpc(fakeAdapter(), { type: "pi:resume", sessionId: "s1", sessionFile: "/etc/passwd" });
  assert.equal(res.status, 403);
});
test("pi:resume accepts a sessionFile under the SDK agent dir without other roots", async () => {
  await noRoots();
  const agentDir = mkdtempSync(join(tmpdir(), "zosma-agentdir-"));
  const file = join(agentDir, "sessions", "s1.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "{}");
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const a = fakeAdapter();
    const res = await handlePiRpc(a, { type: "pi:resume", sessionId: "s1", sessionFile: file });
    assert.equal(res.status, 200);
    const [, sid, sessionFile] = a.calls.find((c) => c[0] === "resume");
    assert.equal(sid, "s1");
    assert.equal(sessionFile, file);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    await noRoots();
    rmSync(agentDir, { recursive: true, force: true });
  }
});
