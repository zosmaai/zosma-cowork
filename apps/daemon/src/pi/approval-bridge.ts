/**
 * ZOS-94 — broker ↔ Pi extension-UI ask bridge.
 *
 * Pure mapping between the normalized approval envelope and Pi's native
 * extension UI surface (select / editor). `approvalToUiAsk` picks the native
 * ask method (choice list vs free-text); `mapUiReplyToApproval` turns the
 * native reply into an explicit ApprovalResult — a cancelled, timed-out, or
 * missing reply never becomes an allow.
 */
import type { ApprovalRequest, ApprovalResult } from "@zosma-cowork/protocol";

export type ApprovalUiAsk =
  | { method: "select"; title: string; options: string[] }
  | { method: "editor"; title: string; prefill?: string };

/** Map a normalized request to the native ask method (choice list vs text). */
export function approvalToUiAsk(request: ApprovalRequest): ApprovalUiAsk {
  if (request.kind === "permission" || (request.options?.length ?? 0) > 0) {
    return { method: "select", title: request.prompt, options: request.options ?? [] };
  }
  return { method: "editor", title: request.prompt, ...(request.default !== undefined ? { prefill: request.default } : {}) };
}

export type NativeUiReply = { value?: unknown } | { confirmed?: boolean } | { cancelled?: boolean };

/**
 * Map the native extension-UI reply to a normalized result. Anything other
 * than an explicit value/confirmation resolves to cancel — never allow.
 */
export function mapUiReplyToApproval(reply: NativeUiReply): ApprovalResult {
  const anyReply = reply as Record<string, unknown>;
  if ("cancelled" in anyReply) return { action: "cancel" };
  if ("value" in anyReply && typeof anyReply.value === "string") {
    return { action: "allow", value: anyReply.value };
  }
  if ("confirmed" in anyReply) {
    return anyReply.confirmed ? { action: "allow" } : { action: "deny" };
  }
  return { action: "cancel" };
}
