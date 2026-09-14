/**
 * ZOS-94 — approval broker: routing, ownership, timeout/cancel, reconnect,
 * capability-gated dispatch, no auto-approval.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalBroker } from "./broker.ts";

function perm(id, session, extra = {}) {
  return { correlationId: id, sessionId: session, kind: "permission", prompt: "commit?", options: ["yes", "no"], ...extra };
}
function ask(id, session, extra = {}) {
  return { correlationId: id, sessionId: session, kind: "ask-user", prompt: "which model?", ...extra };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("request queues a pending approval bound to its session", async () => {
  const broker = new ApprovalBroker();
  const r = await broker.request(perm("c1", "s1"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.pending.status, "pending");
  assert.equal(r.pending.sessionId, "s1");
  assert.deepEqual(broker.list().map((p) => p.correlationId), ["c1"]);
  assert.deepEqual(broker.list("s1").map((p) => p.correlationId), ["c1"]);
  assert.deepEqual(broker.list("s2"), []);
});

test("resolve routes the reply to the owner and drops it from pending", async () => {
  const broker = new ApprovalBroker();
  await broker.request(perm("c1", "s1"));
  const r = broker.resolve("s1", "c1", { action: "allow", value: "yes" });
  assert.equal(r.ok, true);
  assert.equal(broker.list().length, 0);
  const h = broker.history("s1");
  assert.equal(h.length, 1);
  assert.equal(h[0].result?.action, "allow");
  assert.equal(h[0].result?.value, "yes");
});

test("resolve deny routes a free-text value", async () => {
  const broker = new ApprovalBroker();
  await broker.request(ask("c2", "s1"));
  const r = broker.resolve("s1", "c2", { action: "allow", value: "claude-3.7" });
  assert.equal(r.ok, true);
  assert.equal(broker.history("s1")[0].result?.value, "claude-3.7");
});

test("cross-session replies are rejected and the pending request survives", async () => {
  const broker = new ApprovalBroker();
  await broker.request(perm("c1", "s1"));
  const r = broker.resolve("s2", "c1", { action: "allow" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "cross_session_reply");
  assert.equal(broker.list().length, 1, "pending request must not be dropped by a foreign reply");
});

test("unknown, duplicate, and malformed requests are rejected explicitly", async () => {
  const broker = new ApprovalBroker();
  const unknown = broker.resolve("s1", "nope", { action: "allow" });
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.equal(unknown.code, "unknown_request");

  assert.equal((await broker.request(perm("c1", "s1"))).ok, true);
  const dup = await broker.request(perm("c1", "s1"));
  assert.equal(dup.ok, false);
  if (dup.ok) return;
  assert.equal(dup.code, "duplicate_request");

  const badKind = await broker.request({ ...perm("c9", "s1"), kind: "sudo" });
  assert.equal(badKind.ok, false);
  if (badKind.ok) return;
  assert.equal(badKind.code, "invalid_request");

  const noOptions = await broker.request({ ...perm("c10", "s1"), options: undefined });
  assert.equal(noOptions.ok, false);
});

test("timeout auto-resolves the native request as timeout, never allow", async () => {
  const broker = new ApprovalBroker();
  await broker.request(perm("c1", "s1", { timeoutMs: 20 }));
  await sleep(80);
  assert.equal(broker.list().length, 0);
  const h = broker.history("s1");
  assert.equal(h.length, 1);
  assert.equal(h[0].result?.action, "timeout");
});

test("cancel resolves the native request; foreign session cannot cancel", async () => {
  const broker = new ApprovalBroker();
  await broker.request(perm("c1", "s1"));
  const foreign = broker.cancel("s2", "c1");
  assert.equal(foreign.ok, false);
  if (foreign.ok) return;
  assert.equal(foreign.code, "cross_session_reply");
  assert.equal(broker.list().length, 1);

  const ok = broker.cancel("s1", "c1", "user walked away");
  assert.equal(ok.ok, true);
  assert.equal(broker.history("s1")[0].result?.action, "cancel");
});

test("adapter ask dispatch is capability-gated and never fabricates approval", async () => {
  const asked = [];
  const surface = {
    canAsk: () => false,
    ask: (request) => { asked.push(request.correlationId); return { action: "allow" }; },
    complete: () => {},
  };
  const broker = new ApprovalBroker(surface);
  await broker.request(perm("c1", "s1"));
  assert.deepEqual(asked, [], "cannot-ask adapter must not be asked");
  assert.equal(broker.list().length, 1, "request stays pending without an explicit client reply");
});

test("an adapter decision resolves immediately; null keeps the request pending", async () => {
  const syncSurface = {
    canAsk: () => true,
    ask: () => ({ action: "deny", reason: "headless" }),
    complete: () => {},
  };
  const syncBroker = new ApprovalBroker(syncSurface);
  await syncBroker.request(perm("c1", "s1"));
  assert.equal(syncBroker.list().length, 0, "sync adapter decision must resolve the request");
  assert.equal(syncBroker.history("s1")[0].result?.action, "deny");

  const pendingSurface = {
    canAsk: () => true,
    ask: () => null,
    complete: () => {},
  };
  const pendingBroker = new ApprovalBroker(pendingSurface);
  await pendingBroker.request(perm("c2", "s1"));
  assert.equal(pendingBroker.list().length, 1, "no decision means pending");
  const r = pendingBroker.resolve("s1", "c2", { action: "allow", value: "yes" });
  assert.equal(r.ok, true);
});

test("an async adapter decision also resolves immediately", async () => {
  const surface = {
    canAsk: () => true,
    ask: async () => ({ action: "allow" }),
    complete: () => {},
  };
  const broker = new ApprovalBroker(surface);
  await broker.request(perm("c1", "s1"));
  assert.equal(broker.list().length, 0);
  assert.equal(broker.history("s1")[0].result?.action, "allow");
});

test("a failing adapter ask keeps the request pending and resolvable by the client", async () => {
  const surface = {
    canAsk: () => true,
    ask: () => { throw new Error("offline"); },
    complete: () => {},
  };
  const broker = new ApprovalBroker(surface);
  await broker.request(perm("c1", "s1"));
  assert.equal(broker.list().length, 1);
  assert.equal(broker.resolve("s1", "c1", { action: "allow" }).ok, true);
});

test("pending requests survive disconnect and reconnect re-serves them", async () => {
  let asks = 0;
  const surface = {
    canAsk: () => true,
    ask: () => { asks += 1; return null; },
    complete: () => {},
  };
  const broker = new ApprovalBroker(surface);
  await broker.request(perm("c1", "s1"));
  await broker.request(perm("c2", "s2"));
  assert.equal(asks, 2);
  // client disconnect: nothing clears the registry; re-serve on reconnect.
  const reServed = await broker.reconnect("s1");
  assert.equal(reServed, 1);
  assert.equal(asks, 3);
  assert.deepEqual(broker.list("s1").map((p) => p.correlationId), ["c1"]);
  assert.equal(broker.resolve("s1", "c1", { action: "deny" }).ok, true);
});

test("no request is ever auto-approved: unanswered requests stay pending or resolve as timeout", async () => {
  const broker = new ApprovalBroker();
  await broker.request(perm("c1", "s1", { timeoutMs: 20 }));
  await sleep(80);
  const h = broker.history("s1");
  assert.equal(h.length, 1);
  assert.notEqual(h[0].result?.action, "allow");
  assert.equal(h[0].result?.action, "timeout");
});

test("dispose clears timers and is idempotent", async () => {
  const broker = new ApprovalBroker();
  await broker.request(perm("c1", "s1", { timeoutMs: 10_000 }));
  broker.dispose();
  broker.dispose();
  assert.equal(new ApprovalBroker().dispose(), undefined);
});
