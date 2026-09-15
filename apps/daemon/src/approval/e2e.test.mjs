/**
 * ZOS-94 — end-to-end approval flow through the wired daemon stack.
 *
 * Drives the FULL flow with a fake SDK inner session: `broker.request()` →
 * adapter ask surface → PiSession extension-UI select/editor → the web's
 * `pi:command extension_ui_response` → mapped ApprovalResult → broker
 * resolution. Acceptance: Pi Ask-User flows work end-to-end, timeout/cancel
 * resolve the native request, and no reply ever auto-approves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiSession } from "../pi/session.ts";
import { PiAdapter } from "../pi/adapter.ts";
import { ApprovalBroker } from "./broker.ts";

/** Fake SDK AgentSession: captures the extension UI context + event taps. */
function fakeInner() {
  let uiContext = null;
  return {
    sessionId: "n1",
    sessionFile: undefined,
    isStreaming: false,
    extensionRunner: { setUIContext(ctx) { uiContext = ctx; } },
    subscribe() { return () => {}; },
    dispose() {},
    getUiContext: () => uiContext,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function uiRequestId(events, method) {
  const event = events.find(
    (e) => e?.kind === "status" && e.payload?.phase === "extension_ui_request" && e.payload?.method === method,
  );
  assert.ok(event, `expected extension_ui_request ${method}`);
  return event.payload.id;
}

/** A broker wired to one PiSession via the adapter-surface contract. */
function sessionBroker(inner) {
  let broker;
  const session = new PiSession(inner, "s1", () => {}, async (request) => {
    const outcome = await broker.request(request);
    return outcome.ok ? outcome.pending.result ?? null : null;
  });
  const events = [];
  session.onEvent((e) => events.push(e));
  broker = new ApprovalBroker({
    canAsk: () => true,
    ask: (request) => session.askApproval(request),
    complete: () => {},
  });
  return { session, broker, events };
}

test("ask-user with options flows broker → select → allow with the choice", async () => {
  const inner = fakeInner();
  const { session, broker, events } = sessionBroker(inner);
  const pending = broker.request({
    correlationId: "c1", sessionId: "s1", kind: "ask-user",
    prompt: "Write files?", options: ["Yes", "No"],
  });
  await tick();
  // The web answers the surfaced select over its existing command channel.
  const id = uiRequestId(events, "select");
  await session.command({ type: "extension_ui_response", id, response: { value: "Yes" } });
  const out = await pending;
  assert.equal(out.ok, true);
  assert.equal(broker.size, 0);
  assert.deepEqual(broker.history("s1")[0].result, { action: "allow", value: "Yes" });
});

test("native select flows through broker before returning its choice", async () => {
  const inner = fakeInner();
  const { session, broker, events } = sessionBroker(inner);
  const answer = inner.getUiContext().select("Pick", ["A", "B"]);
  await tick();
  const id = uiRequestId(events, "select");
  await session.command({ type: "extension_ui_response", id, response: { value: "B" } });
  assert.equal(await answer, "B");
  assert.equal(broker.history("s1").length, 1);
  assert.deepEqual(broker.history("s1")[0].result, { action: "allow", value: "B" });
});

test("free-text ask-user flows broker → editor → allow with the typed value", async () => {
  const inner = fakeInner();
  const { session, broker, events } = sessionBroker(inner);
  const pending = broker.request({
    correlationId: "c2", sessionId: "s1", kind: "ask-user",
    prompt: "Name the branch:", default: "feat/x",
  });
  await tick();
  const id = uiRequestId(events, "editor");
  await session.command({ type: "extension_ui_response", id, response: { value: "feat/y" } });
  await pending;
  assert.equal(broker.size, 0);
  assert.deepEqual(broker.history("s1")[0].result, { action: "allow", value: "feat/y" });
});

test("native cancel resolves the broker request as cancel, never allow", async () => {
  const inner = fakeInner();
  const { session, broker, events } = sessionBroker(inner);
  const pending = broker.request({
    correlationId: "c3", sessionId: "s1", kind: "ask-user", prompt: "Go?",
  });
  await tick();
  const id = uiRequestId(events, "editor");
  await session.command({ type: "extension_ui_response", id, response: { cancelled: true } });
  await pending;
  assert.equal(broker.size, 0);
  assert.deepEqual(broker.history("s1")[0].result, { action: "cancel" });
});

test("timeout resolves as timeout while the native ask also expires", async () => {
  const inner = fakeInner();
  const { broker } = sessionBroker(inner);
  const pending = broker.request({
    correlationId: "c4", sessionId: "s1", kind: "ask-user",
    prompt: "Hurry?", timeoutMs: 40,
  });
  await tick();
  // Never answered: the broker timer and the native ui timeout both expire.
  await new Promise((resolve) => setTimeout(resolve, 90));
  const out = await pending;
  assert.equal(out.ok, true);
  assert.equal(broker.size, 0);
  assert.deepEqual(broker.history("s1")[0].result, { action: "timeout" });
});

test("Pi native Ask-User requests enter the normalized broker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zosma-native-ask-"));
  const inner = fakeInner();
  const adapter = new PiAdapter({
    storeDir: dir,
    sessionFactory: async (sessionId) => ({ inner, realSessionId: sessionId }),
  });
  const broker = new ApprovalBroker(adapter);
  adapter.setApprovalRequester(async (request) => {
    const outcome = await broker.request(request);
    return outcome.ok ? outcome.pending.result ?? null : null;
  });
  try {
    await adapter.start("s1", "/tmp");
    const selected = inner.getUiContext().select("Pick one", ["A", "B"]);
    await tick();
    const [pending] = broker.list("s1");
    assert.equal(pending.prompt, "Pick one");
    assert.deepEqual(pending.options, ["A", "B"]);
    assert.equal(broker.resolve("s1", pending.correlationId, { action: "allow", value: "B" }).ok, true);
    assert.equal(await selected, "B");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PiAdapter is the broker's ask surface for live sessions (wired in index.ts)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zosma-approval-adapter-"));
  const inner = fakeInner();
  const adapter = new PiAdapter({
    storeDir: dir,
    sessionFactory: async (sessionId) => ({ inner, realSessionId: sessionId }),
  });
  try {
    await adapter.start("s1", "/tmp");
    assert.equal(adapter.canAsk("ask-user"), true);
    assert.equal(adapter.canAsk("permission"), true);
    const broker = new ApprovalBroker(adapter);
    const pending = broker.request({
      correlationId: "c5", sessionId: "s1", kind: "ask-user",
      prompt: "Pick one", options: ["A", "B"],
    });
    // The ask surfaced on the session's native UI context…
    await tick();
    assert.ok(inner.getUiContext(), "extension UI context bound");
    assert.ok(broker.list("s1").some((p) => p.correlationId === "c5"));
    // …and a foreign-session reply is still rejected (ownership holds).
    const foreign = broker.resolve("other", "c5", { action: "allow", value: "A" });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.code, "cross_session_reply");
    // A request for an unknown session surfaces nothing and stays pending —
    // the owning client can still resolve it explicitly.
    const ghost = await adapter.ask({ correlationId: "g", sessionId: "ghost", kind: "ask-user", prompt: "?" });
    assert.equal(ghost, null);
    // The in-flight request stays pending (never answered) — verify the
    // owning client can still resolve it explicitly.
    const client = broker.resolve("s1", "c5", { action: "deny" });
    assert.equal(client.ok, true);
    assert.deepEqual(broker.history("s1")[0].result, { action: "deny" });
    await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 30))]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
