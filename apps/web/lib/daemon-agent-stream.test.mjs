import assert from "node:assert/strict";
import { ReadableStream, TransformStream } from "node:stream/web";
import test from "node:test";
import { createDaemonAgentEventStream } from "./daemon-agent-stream.ts";

// Drive the bridge with normalized frames and collect the wire events it emits.
function runBridge(frames) {
  const encoder = new TextEncoder();
  let body = "";
  for (const frame of frames) {
    body += `data: ${JSON.stringify(frame)}\n\n`;
  }
  const upstream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  const req = new Request("http://localhost/events", { signal: new AbortController().signal });
  const out = createDaemonAgentEventStream(req, { sessionId: "s1" }, upstream);

  const { readable, writable } = new TransformStream();
  const sink = out.pipeTo(writable).catch(() => {});
  return (async () => {
    const reader = readable.getReader();
    const events = [];
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
    await sink;
    for (const line of buf.split("\n")) {
      const t = line.trim();
      if (t.startsWith("data:")) {
        try { events.push(JSON.parse(t.slice(5).trim())); } catch { /* skip */ }
      }
    }
    return events;
  })();
}

test("text deltas stream as contentIndex:0 after a text_start (real order)", async () => {
  const frames = [
    { cid: "c1", seq: 1, kind: "message", payload: { delta: "", text: "" } }, // message_start placeholder
    { cid: "c1", seq: 2, kind: "message", payload: { delta: "Hel", contentIndex: 0, deltaKind: "text" } },
    { cid: "c1", seq: 3, kind: "message", payload: { delta: "lo", contentIndex: 0, deltaKind: "text" } },
  ];
  const events = await runBridge(frames);
  const updates = events.filter((e) => e.type === "message_update");
  // First update must be a text_start at index 0, then the deltas at index 0.
  assert.equal(updates[0].assistantMessageEvent.type, "text_start");
  assert.equal(updates[0].assistantMessageEvent.contentIndex, 0);
  const deltas = updates.filter((u) => u.assistantMessageEvent.type === "text_delta");
  assert.equal(deltas.length, 2);
  assert.equal(deltas[0].assistantMessageEvent.contentIndex, 0);
  assert.equal(deltas[0].assistantMessageEvent.delta, "Hel");
  assert.equal(deltas[1].assistantMessageEvent.delta, "lo");
});

test("thinking block gets its own contentIndex start, not colliding with text", async () => {
  // pi orders assistant content [thinking, text], so thinking index 0, text 1.
  const frames = [
    { cid: "c1", seq: 1, kind: "message", payload: { delta: "", text: "" } },
    { cid: "c1", seq: 2, kind: "message", payload: { delta: "", thinking: "Reason", contentIndex: 0, deltaKind: "thinking" } },
    { cid: "c1", seq: 3, kind: "message", payload: { delta: "Ans", contentIndex: 1, deltaKind: "text" } },
  ];
  const events = await runBridge(frames);
  const updates = events.filter((e) => e.type === "message_update");
  const thinkingStart = updates.find((u) => u.assistantMessageEvent.type === "thinking_start");
  const thinkingDelta = updates.find((u) => u.assistantMessageEvent.type === "thinking_delta");
  const textStart = updates.find((u) => u.assistantMessageEvent.type === "text_start" && u.assistantMessageEvent.contentIndex === 1);
  assert.ok(thinkingStart, "thinking_start emitted");
  assert.equal(thinkingStart.assistantMessageEvent.contentIndex, 0);
  assert.equal(thinkingDelta.assistantMessageEvent.contentIndex, 0);
  assert.ok(textStart, "text_start at index 1 emitted");
});

test("message_end frame emits a terminal text message", async () => {
  const frames = [
    { cid: "c1", seq: 1, kind: "message", payload: { text: "Final answer." } },
  ];
  const events = await runBridge(frames);
  const end = events.find((e) => e.type === "message_end");
  assert.ok(end, "message_end emitted");
  assert.equal(end.message.role, "assistant");
  assert.equal(end.message.content[0].text, "Final answer.");
});

test("user message_end is bridged as role:user, not a phantom assistant echo", async () => {
  // pi emits message_end for the user prompt too; the bridge must preserve
  // the role or the hook appends the user's own text as a false assistant.
  const frames = [
    { cid: "c1", seq: 1, kind: "message", payload: { text: "say hi", role: "user", content: [{ type: "text", text: "say hi" }] } },
  ];
  const events = await runBridge(frames);
  const end = events.find((e) => e.type === "message_end");
  assert.ok(end, "message_end emitted");
  assert.equal(end.message.role, "user");
  assert.equal(end.message.content[0].text, "say hi");
});

test("assistant message_end preserves thinking block when present", async () => {
  const frames = [
    { cid: "c1", seq: 1, kind: "message", payload: { text: "Ans", role: "assistant", content: [{ type: "thinking", thinking: "Reason" }, { type: "text", text: "Ans" }] } },
  ];
  const events = await runBridge(frames);
  const end = events.find((e) => e.type === "message_end");
  assert.ok(end, "message_end emitted");
  assert.equal(end.message.content.length, 2);
  assert.equal(end.message.content[0].type, "thinking");
  assert.equal(end.message.content[1].text, "Ans");
});

test("agent_end + settled synthesize the wire end event", async () => {
  const frames = [
    { cid: "c1", seq: 1, kind: "end", payload: { stopReason: "end_turn" } },
    { cid: "c1", seq: 2, kind: "end", payload: { stopReason: "settled" } },
  ];
  const events = await runBridge(frames);
  const kinds = events.filter((e) => e.type === "agent_end" || e.type === "agent_settled").map((e) => e.type);
  // The bridge also synthesizes an end-on-close after the reader ends; the
  // two frames we sent must appear first, in order.
  assert.deepEqual(kinds.slice(0, 2), ["agent_end", "agent_settled"]);
});
