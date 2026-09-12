import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { daemonConfig, daemonIpc, daemonStream, piStart, piResume, piPrompt, piCommand, piList, piClose, piRead, piAllowRoot, DaemonError } = await jiti.import("./daemon-client.ts");

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test("daemonConfig reads the env contract", () => {
  const cfg = daemonConfig({ ZOSMA_DAEMON_URL: "http://127.0.0.1:64713/", ZOSMA_DAEMON_TOKEN: "tok" });
  assert.equal(cfg.url, "http://127.0.0.1:64713");
  assert.equal(cfg.token, "tok");
  assert.equal(daemonConfig({}), null);
  assert.equal(daemonConfig({ ZOSMA_DAEMON_URL: "http://x" }), null);
});

test("daemonIpc posts an envelope with Bearer auth and returns status+body", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push([url, init]);
    return new Response(JSON.stringify({ ok: true, type: "pi:list", sessions: [] }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const res = await daemonIpc({ type: "pi:list" }, cfg);
  assert.equal(seen[0][0], "http://127.0.0.1:64713/ipc");
  assert.equal(seen[0][1].method, "POST");
  assert.equal(seen[0][1].headers.Authorization, "Bearer tok");
  assert.equal(seen[0][1].headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(seen[0][1].body).type, "pi:list");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("daemonIpc carries the daemon's status through (no throw on non-2xx)", async (t) => {
  t.after(mockFetch(async () => new Response(JSON.stringify({ ok: false, error: "unknown session" }), { status: 400 })));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const res = await daemonIpc({ type: "pi:prompt" }, cfg);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "unknown session");
});

test("daemonIpc throws DaemonError when the daemon is unreachable", async (t) => {
  t.after(mockFetch(async () => { throw new TypeError("connection refused"); }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  await assert.rejects(daemonIpc({ type: "pi:list" }, cfg), (e) => e instanceof DaemonError && e.status === 503 && e.code === "daemon_unreachable");
});

test("daemonIpc without config throws daemon_not_configured 503", async () => {
  await assert.rejects(daemonIpc({ type: "pi:list" }, null ?? undefined), (e) => e instanceof DaemonError && e.status === 503 && e.code === "daemon_not_configured");
});

test("piStart builds pi:start and unwraps the handle", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, type: "pi:start", sessionId: "native-1", state: "running", nativeSessionId: "native-1" }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const handle = await piStart("/workspace", undefined, undefined, cfg);
  assert.equal(seen[0].type, "pi:start");
  assert.equal(seen[0].cwd, "/workspace");
  assert.equal(handle.sessionId, "native-1");
});

test("piStart forwards model scope and thinking level", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, sessionId: "native-1", state: "running" }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  await piStart("/workspace", "__new__1", { model: { provider: "anthropic", modelId: "claude-opus-4-5" }, thinkingLevel: "xhigh" }, cfg);
  assert.deepEqual(seen[0], {
    type: "pi:start", cwd: "/workspace", sessionId: "__new__1",
    model: { provider: "anthropic", modelId: "claude-opus-4-5" }, thinkingLevel: "xhigh",
  });
});

test("piResume forwards sessionFile and unwraps", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, sessionId: "s1", state: "running" }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const handle = await piResume("s1", "/ws/.pi/sessions/s1.md", cfg);
  assert.deepEqual(seen[0], { type: "pi:resume", sessionId: "s1", sessionFile: "/ws/.pi/sessions/s1.md" });
  assert.equal(handle.sessionId, "s1");
});

test("piPrompt maps to pi:prompt with the turn and returns events", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, events: [{ cid: "c1", seq: 1, kind: "end", payload: {} }] }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const events = await piPrompt("s1", { text: "hi", cid: "c9", mode: "steer" }, cfg);
  assert.equal(seen[0].type, "pi:prompt");
  assert.equal(seen[0].sessionId, "s1");
  assert.equal(seen[0].text, "hi");
  assert.equal(seen[0].mode, "steer");
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "end");
});

test("piCommand maps to pi:command and unwraps result", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, result: { ok: true, type: "get_state" } }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const result = await piCommand("s1", { type: "get_state" }, cfg);
  assert.deepEqual(seen[0], { type: "pi:command", sessionId: "s1", command: { type: "get_state" } });
  assert.equal(result.type, "get_state");
});

test("piList returns the sessions array", async (t) => {
  t.after(mockFetch(async () => new Response(JSON.stringify({ ok: true, sessions: [{ sessionId: "s1", state: "running" }] }), { status: 200 })));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const sessions = await piList(cfg);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, "s1");
});

test("piClose maps to pi:close with the session id", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, type: "pi:close" }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  await piClose("s1", cfg);
  assert.deepEqual(seen[0], { type: "pi:close", sessionId: "s1" });
});

test("daemonStream opens /ipc/stream with auth and returns the raw Response", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push([url, init]);
    return new Response("data: {}\n\n", { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const res = await daemonStream({ type: "pi:stream", sessionId: "s1" }, cfg);
  assert.equal(seen[0][0], "http://127.0.0.1:64713/ipc/stream");
  assert.equal(seen[0][1].headers.Authorization, "Bearer tok");
  assert.equal(res.status, 200);
});
test("piRead builds a read: envelope and unwraps data", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, type: "read:list-sessions", data: { sessions: [], runningSessionIds: [] } }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  const data = await piRead("list-sessions", { force: true }, cfg);
  assert.deepEqual(seen[0], { type: "read:list-sessions", force: true });
  assert.deepEqual(data, { sessions: [], runningSessionIds: [] });
});

test("piRead surfaces daemon error code as a DaemonError", async (t) => {
  t.after(mockFetch(async () => new Response(JSON.stringify({ ok: false, error: "Session not found", code: "session_not_found" }), { status: 404 })));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  await assert.rejects(
    () => piRead("session-details", { sessionId: "nope" }, cfg),
    (e) => e instanceof DaemonError && e.status === 404 && e.code === "session_not_found",
  );
});

test("piAllowRoot posts read:allow-root", async (t) => {
  const seen = [];
  t.after(mockFetch(async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, type: "read:allow-root", data: { ok: true } }), { status: 200 });
  }));
  const cfg = { url: "http://127.0.0.1:64713", token: "tok" };
  await piAllowRoot("/tmp/proj", cfg);
  assert.deepEqual(seen[0], { type: "read:allow-root", root: "/tmp/proj" });
});
