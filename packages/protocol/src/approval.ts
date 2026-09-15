/**
 * ZOS-94 — normalized approval / Ask-User envelopes.
 *
 * The protocol-neutral request/reply boundary for permissions and questions.
 * A request asks for a user decision bound to exactly one session; a reply
 * resolves it. Nothing here assumes a harness UI or permission model, so Pi
 * and any future harness speak the same shape.
 *
 * The shapes deliberately have no implicit default: a request with no reply,
 * an unsupported kind, or a timed-out ask never becomes an approval — it
 * stays pending or resolves explicitly to `timeout` / `deny` / `cancel`.
 */
import type { Schema } from "./schema.ts";
import type { Result } from "./result.ts";
import {
  object,
  enum_ as enumSchema,
  nonEmptyString as nonEmptyStringSchema,
  string as stringSchema,
  number as numberSchema,
  optional,
  array,
} from "./schema.ts";
import { invalidField } from "./errors.ts";

/** What is being asked: permission to act, or an open question. */
export type ApprovalKind = "permission" | "ask-user";

export const APPROVAL_KINDS: readonly ApprovalKind[] = [
  "permission",
  "ask-user",
] as const satisfies readonly ApprovalKind[];

/** The explicit ways a request can resolve. `allow` is never a default. */
export type ApprovalAction = "allow" | "deny" | "cancel" | "timeout";

export const APPROVAL_ACTIONS: readonly ApprovalAction[] = [
  "allow",
  "deny",
  "cancel",
  "timeout",
] as const satisfies readonly ApprovalAction[];

/** A normalized approval/question request (the ticket's request envelope). */
export interface ApprovalRequest {
  /** Correlation id — the single handle replies route on. */
  correlationId: string;
  /** Owning session. Replies from any other session are rejected. */
  sessionId: string;
  kind: ApprovalKind;
  /** The message shown to the user. */
  prompt: string;
  /** Multiple-choice labels. Absent => free-text answer. */
  options?: string[];
  /** Suggested default for free-text input. */
  default?: string;
  /** Auto-resolve to `timeout` after this many ms (absent = never). */
  timeoutMs?: number;
}

/** The explicit decision on a request. */
export interface ApprovalResult {
  action: ApprovalAction;
  /** Chosen option label or free-text answer (required to act on allow). */
  value?: string;
  reason?: string;
}

/** The ticket's reply envelope: correlation id + decision. */
export interface ApprovalReply {
  correlationId: string;
  result: ApprovalResult;
}

/** Registry view of a request (what reconnect/list consumers see). */
export type ApprovalStatus = "pending" | "resolved" | "rejected";

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  "pending",
  "resolved",
  "rejected",
] as const satisfies readonly ApprovalStatus[];

export interface PendingApproval {
  correlationId: string;
  sessionId: string;
  kind: ApprovalKind;
  prompt: string;
  options?: string[];
  default?: string;
  status: ApprovalStatus;
  result?: ApprovalResult;
}

export const approvalKindSchema: Schema<ApprovalKind> = enumSchema(APPROVAL_KINDS);

export const approvalActionSchema: Schema<ApprovalAction> = enumSchema(APPROVAL_ACTIONS);

export const approvalResultSchema: Schema<ApprovalResult> = object({
  action: approvalActionSchema,
  value: optional(stringSchema()),
  reason: optional(stringSchema()),
});

/**
 * Request validation. Cross-field guard: a `permission` with no choices is
 * ambiguous (there is nothing concrete to allow/deny) and is rejected —
 * unsupported shapes are never silently approved.
 */
export const approvalRequestSchema: Schema<ApprovalRequest> = (input): Result<ApprovalRequest> => {
  const base = object({
    correlationId: nonEmptyStringSchema("correlationId"),
    sessionId: nonEmptyStringSchema("sessionId"),
    kind: approvalKindSchema,
    prompt: nonEmptyStringSchema("prompt"),
    options: optional(array(nonEmptyStringSchema("options"))),
    default: optional(stringSchema("default")),
    timeoutMs: optional(numberSchema("timeoutMs")),
  });
  const res = base(input);
  if (!res.ok) return res;
  if (res.value.kind === "permission" && !res.value.options?.length) {
    return { ok: false, error: invalidField("options", "non-empty array (permission requires choices)") };
  }
  return res;
};

export const approvalReplySchema: Schema<ApprovalReply> = object({
  correlationId: nonEmptyStringSchema("correlationId"),
  result: approvalResultSchema,
});

export const pendingApprovalSchema: Schema<PendingApproval> = object({
  correlationId: nonEmptyStringSchema("correlationId"),
  sessionId: nonEmptyStringSchema("sessionId"),
  kind: approvalKindSchema,
  prompt: nonEmptyStringSchema("prompt"),
  options: optional(array(nonEmptyStringSchema("options"))),
  default: optional(stringSchema("default")),
  status: enumSchema(APPROVAL_STATUSES),
  result: optional(approvalResultSchema),
});
