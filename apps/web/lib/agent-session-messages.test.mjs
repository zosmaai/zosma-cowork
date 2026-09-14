import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  asArray,
  assistantMessageText,
  commitAssistantReply,
  mergePersistedMessages,
  normalizeQueuedMessages,
} = await jiti.import("./agent-session-messages.ts");

const user = (text) => ({ role: "user", content: text, timestamp: 1 });
const assistant = (blocks, extra = {}) => ({ role: "assistant", content: blocks, ...extra });
const toolResult = (toolCallId) => ({
  role: "toolResult",
  toolCallId,
  content: [{ type: "toolResult", toolCallId, content: "out" }],
});

test("asArray coerces null/undefined/non-arrays", () => {
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray("x"), []);
  assert.deepEqual(asArray([1, 2]), [1, 2]);
});

test("normalizeQueuedMessages fills missing keys", () => {
  assert.deepEqual(normalizeQueuedMessages(undefined), { steering: [], followUp: [] });
  assert.deepEqual(normalizeQueuedMessages({ steering: ["a"] }), { steering: ["a"], followUp: [] });
});

test("assistantMessageText joins text blocks only", () => {
  const m = assistant([{ type: "text", text: "ab" }, { type: "text", text: "cd" }]);
  assert.equal(assistantMessageText(m), "abcd");
  assert.equal(assistantMessageText({ role: "assistant", content: "plain" }), "plain");
  // thinking blocks are excluded and do not break the join
  const withThinking = {
    role: "assistant",
    content: [{ type: "thinking", thinking: "skip me" }, { type: "text", text: "answer" }],
  };
  assert.equal(assistantMessageText(withThinking), "answer");
});

test("merge keeps live object identity when persisted copy matches", () => {
  const live = [user("hi"), assistant([{ type: "text", text: "hello" }])];
  const persisted = [user("hi"), assistant([{ type: "text", text: "hello" }])];
  const merged = mergePersistedMessages(persisted, live);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], live[0], "unchanged user bubble must keep identity");
  assert.equal(merged[1], live[1], "unchanged assistant bubble must keep identity");
});

test("merge yields to the persisted copy when it is strictly fuller", () => {
  // Live copy is missing the thinking block the session file has.
  const live = [user("hi"), assistant([{ type: "text", text: "hello" }])];
  const persisted = [user("hi"), assistant(
    [{ type: "text", text: "hello" }],
    { content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "hello" }] },
  )];
  const merged = mergePersistedMessages(persisted, live);
  assert.equal(merged[1], persisted[1], "fuller persisted copy must win");
  assert.equal(merged[0], live[0]);
});

test("merge pairs duplicate same-text messages positionally", () => {
  const live = [user("same"), user("same")];
  const persisted = [user("same"), user("same")];
  const merged = mergePersistedMessages(persisted, live);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], live[0]);
  assert.equal(merged[1], live[1]);
});

test("merge survives flush lag: file missing the just-committed tail", () => {
  const live = [user("hi"), assistant([{ type: "text", text: "hello" }])];
  const persisted = [user("hi")]; // pi hasn't flushed the reply yet
  const merged = mergePersistedMessages(persisted, live);
  assert.deepEqual(merged, live, "unflushed tail must survive (no ghost, no duplicate)");
});

test("merge drops stray live messages when the file is authoritative", () => {
  // Nothing matches (branch switch) → full replace, no suffix rescue.
  const live = [user("old-turn")];
  const persisted = [user("other-leaf")];
  assert.deepEqual(mergePersistedMessages(persisted, live), persisted);

  // File dropped a middle chunk (compaction) → file order wins.
  const live2 = [user("a"), assistant([{ type: "text", text: "old" }]), user("b")];
  const persisted2 = [user("a"), user("b")];
  assert.deepEqual(mergePersistedMessages(persisted2, live2), persisted2);
});

test("merge keeps the current list when the file is empty (session not flushed yet)", () => {
  const live = [user("hi")];
  assert.deepEqual(mergePersistedMessages([], live), live);
});

test("merge keeps toolResult identity by toolCallId", () => {
  const live = [user("hi"), toolResult("tc-1")];
  const persisted = [user("hi"), toolResult("tc-1")];
  const merged = mergePersistedMessages(persisted, live);
  assert.equal(merged[1], live[1]);
});
test("commitAssistantReply appends a fresh reply", () => {
  const next = commitAssistantReply([user("hi")], assistant([{ type: "text", text: "hello" }]));
  assert.equal(next.length, 2);
  assert.equal(next[1].content[0].text, "hello");
});

test("commitAssistantReply replaces a same-text tail instead of stacking", () => {
  const current = [user("hi"), assistant([{ type: "text", text: "hello" }])];
  const committed = assistant([{ type: "text", text: "hello" }], { extra: true });
  const next = commitAssistantReply(current, committed);
  assert.equal(next.length, 2, "no duplicate bubble");
  assert.equal(next[1], committed, "authoritative commit wins");
});

test("commitAssistantReply collapses stacked duplicates from a reload race", () => {
  const current = [
    user("hi"),
    assistant([{ type: "text", text: "hello" }]),
    assistant([{ type: "text", text: "hello" }]),
  ];
  const next = commitAssistantReply(current, assistant([{ type: "text", text: "hello" }], { final: true }));
  assert.equal(next.length, 2, "stacked same-text duplicates collapse to one");
  assert.equal(next[1].final, true);
});

test("commitAssistantReply drops a stale replay when a newer turn exists", () => {
  const current = [user("hi"), assistant([{ type: "text", text: "old" }]), user("next")];
  const next = commitAssistantReply(current, assistant([{ type: "text", text: "old" }], { stale: true }));
  assert.equal(next, current, "replay must not append into the newer turn");
});

test("commitAssistantReply still appends when the text is genuinely new", () => {
  const current = [user("hi"), assistant([{ type: "text", text: "old" }]), user("next")];
  const next = commitAssistantReply(current, assistant([{ type: "text", text: "fresh" }]));
  assert.equal(next.length, 4);
  assert.equal(next[3].content[0].text, "fresh");
});
