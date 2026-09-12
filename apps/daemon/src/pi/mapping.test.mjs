import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPiEvent } from "./mapping.ts";

test("message_end carries role so the bridge does not echo the user prompt as assistant", () => {
  const userEnd = mapPiEvent(
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "say hi" }] } },
    "c1",
    1,
  );
  assert.equal(userEnd?.kind, "message");
  assert.equal(userEnd?.payload?.text, "say hi");
  assert.equal(userEnd?.payload?.role, "user");
  assert.deepEqual(userEnd?.payload?.content, [{ type: "text", text: "say hi" }]);
});

test("assistant message_end preserves role and full thinking+text content", () => {
  const asstEnd = mapPiEvent(
    { type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "Reason" }, { type: "text", text: "Ans" }] } },
    "c1",
    1,
  );
  assert.equal(asstEnd?.payload?.role, "assistant");
  assert.equal(asstEnd?.payload?.text, "Ans");
  const content = asstEnd?.payload?.content;
  assert.ok(Array.isArray(content), "content is an array");
  assert.equal(content.length, 2);
  assert.equal(content[0].type, "thinking");
  assert.equal(content[1].text, "Ans");
});

test("message_update carries contentIndex and deltaKind through", () => {
  const update = mapPiEvent(
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hel", contentIndex: 1 } },
    "c1",
    1,
  );
  assert.equal(update?.payload?.delta, "Hel");
  assert.equal(update?.payload?.contentIndex, 1);
  assert.equal(update?.payload?.deltaKind, "text");
});
