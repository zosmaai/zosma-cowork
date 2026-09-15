/**
 * ZOS-94 — approval↔Pi-extension-UI bridge mapping tests.
 *
 * `approvalToUiAsk` must pick the native ask method (choice list vs free-text)
 * from the normalized envelope; `mapUiReplyToApproval` must translate native
 * replies into explicit ApprovalResults — a cancelled/timeout/missing reply
 * never becomes an allow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalToUiAsk, mapUiReplyToApproval } from "./approval-bridge.ts";

const base = {
  correlationId: "c1",
  sessionId: "s1",
  prompt: "Write files?",
};

test("options/ask-user maps to a select with the same choices", () => {
  assert.deepEqual(
    approvalToUiAsk({ ...base, kind: "ask-user", options: ["Yes", "No"] }),
    { method: "select", title: "Write files?", options: ["Yes", "No"] },
  );
});

test("permission always maps to a select (schema guarantees options)", () => {
  assert.deepEqual(
    approvalToUiAsk({ ...base, kind: "permission", options: ["Allow", "Deny"] }),
    { method: "select", title: "Write files?", options: ["Allow", "Deny"] },
  );
});

test("free-text ask-user maps to an editor with the default as prefill", () => {
  assert.deepEqual(
    approvalToUiAsk({ ...base, kind: "ask-user", default: "draft" }),
    { method: "editor", title: "Write files?", prefill: "draft" },
  );
});

test("free-text ask-user without a default omits prefill", () => {
  assert.deepEqual(
    approvalToUiAsk({ ...base, kind: "ask-user" }),
    { method: "editor", title: "Write files?" },
  );
});

test("selected option resolves to allow with its value", () => {
  assert.deepEqual(mapUiReplyToApproval({ value: "Yes" }), { action: "allow", value: "Yes" });
});

test("editor text resolves to allow with the typed value", () => {
  assert.deepEqual(mapUiReplyToApproval({ value: "some answer" }), { action: "allow", value: "some answer" });
});

test("native cancel resolves to cancel, never allow", () => {
  assert.deepEqual(mapUiReplyToApproval({ cancelled: true }), { action: "cancel" });
});

test("confirm false resolves to deny", () => {
  assert.deepEqual(mapUiReplyToApproval({ confirmed: false }), { action: "deny" });
});

test("confirm true resolves to allow", () => {
  assert.deepEqual(mapUiReplyToApproval({ confirmed: true }), { action: "allow" });
});

test("empty/missing replies resolve to cancel, never allow", () => {
  assert.deepEqual(mapUiReplyToApproval({}), { action: "cancel" });
  assert.deepEqual(mapUiReplyToApproval({ value: undefined }), { action: "cancel" });
});
