/**
 * ZOS-94 — approval/question envelope validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalRequestSchema,
  approvalReplySchema,
  pendingApprovalSchema,
} from "./approval.ts";

test("permission request validates with correlation id and session binding", () => {
  const res = approvalRequestSchema({
    correlationId: "c-1",
    sessionId: "sess-9",
    kind: "permission",
    prompt: "run git commit?",
    options: ["yes", "no"],
    timeoutMs: 30_000,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.correlationId, "c-1");
    assert.equal(res.value.sessionId, "sess-9");
    assert.deepEqual(res.value.options, ["yes", "no"]);
    assert.equal(res.value.timeoutMs, 30_000);
  }
});

test("ask-user request validates without options (free-text)", () => {
  const res = approvalRequestSchema({
    correlationId: "c-2",
    sessionId: "sess-9",
    kind: "ask-user",
    prompt: "which model?",
    default: "claude",
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.default, "claude");
});

test("permission without options is rejected as ambiguous", () => {
  const res = approvalRequestSchema({
    correlationId: "c-3",
    sessionId: "sess-9",
    kind: "permission",
    prompt: "run git commit?",
  });
  assert.equal(res.ok, false);
});

test("permission with empty options array is rejected", () => {
  const res = approvalRequestSchema({
    correlationId: "c-4",
    sessionId: "sess-9",
    kind: "permission",
    prompt: "run git commit?",
    options: [],
  });
  assert.equal(res.ok, false);
});

test("unknown kind, empty prompt, and missing ids are rejected", () => {
  assert.equal(approvalRequestSchema({ correlationId: "c", sessionId: "s", kind: "sudo", prompt: "x", options: ["a"] }).ok, false);
  assert.equal(approvalRequestSchema({ correlationId: "c", sessionId: "s", kind: "permission", prompt: "", options: ["a"] }).ok, false);
  assert.equal(approvalRequestSchema({ correlationId: "", sessionId: "s", kind: "permission", prompt: "x", options: ["a"] }).ok, false);
  assert.equal(approvalRequestSchema({ correlationId: "c", sessionId: "", kind: "permission", prompt: "x", options: ["a"] }).ok, false);
});

test("reply envelope validates a result action with optional value", () => {
  const res = approvalReplySchema({
    correlationId: "c-1",
    result: { action: "allow", value: "yes", reason: "user said so" },
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.result.value, "yes");
});

test("reply with an unknown action or missing correlation id is rejected", () => {
  assert.equal(approvalReplySchema({ correlationId: "c", result: { action: "maybe" } }).ok, false);
  assert.equal(approvalReplySchema({ result: { action: "allow" } }).ok, false);
});

test("pending approval view validates pending and resolved states", () => {
  const pending = pendingApprovalSchema({
    correlationId: "c-1",
    sessionId: "sess-9",
    kind: "ask-user",
    prompt: "which model?",
    status: "pending",
  });
  assert.equal(pending.ok, true);
  const resolved = pendingApprovalSchema({
    correlationId: "c-1",
    sessionId: "sess-9",
    kind: "permission",
    prompt: "run git commit?",
    options: ["yes", "no"],
    status: "resolved",
    result: { action: "deny" },
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.value.result?.action, "deny");
  assert.equal(pendingApprovalSchema({ correlationId: "c", sessionId: "s", kind: "permission", prompt: "x", options: ["a"], status: "bogus" }).ok, false);
});
