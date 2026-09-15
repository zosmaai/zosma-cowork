/**
 * ZOS-94 — approval/Ask-User broker.
 *
 * The durable request/reply boundary for permissions and questions. Every
 * request is queued by correlation id and bound to exactly one session;
 * replies are routed back through an ownership check, so a reply from the
 * wrong session is rejected and leaves the pending request untouched.
 *
 * Decision policy (acceptance "no request is auto-approved by fallback"):
 *   - `allow` only ever comes from an explicit client reply or an explicit
 *     adapter decision — never from a default, a missing reply, or a timeout.
 *   - Unanswered/timed-out/unsupported requests stay pending or resolve
 *     explicitly to `timeout` / `deny` / `cancel`.
 *
 * The optional {@link ApprovalAdapterSurface} is the adapter-native ask
 * channel (Pi's `requestPermission` and future harness asks). It is gated on
 * the adapter's advertised capabilities (`canAsk(kind)`): a harness that
 * cannot surface a request is never asked, and no decision is invented for it.
 *
 * Pending entries live in-process and survive client disconnects by
 * construction; `reconnect(sessionId)` re-serves a session's pending asks and
 * `list(sessionId)` lets a reconnected client re-resolve stale ones.
 */
import type {
  ApprovalAction,
  ApprovalRequest,
  ApprovalResult,
  PendingApproval,
} from "@zosma-cowork/protocol";
import { approvalRequestSchema } from "@zosma-cowork/protocol";

/** Adapter-native ask surface (optional; capability-gated by the broker). */
export interface ApprovalAdapterSurface {
  /** Capability gate: can this harness surface a request of `kind` to its user? */
  canAsk(kind: ApprovalRequest["kind"]): boolean;
  /**
   * Ask the harness to surface the request. Return a decision to resolve
   * immediately; return `null`/`undefined` to keep the request pending for a
   * client `resolve()`.
   */
  ask(request: ApprovalRequest): ApprovalResult | null | Promise<ApprovalResult | null>;
  /** Deliver the final resolution to the harness (dismiss its ask UI). */
  complete(request: ApprovalRequest, result: ApprovalResult): void | Promise<void>;
}

export type ApprovalOutcome =
  | { ok: true; pending: PendingApproval }
  | { ok: false; code: "invalid_request" | "duplicate_request" | "unknown_request" | "cross_session_reply"; message: string };

interface PendingEntry {
  request: ApprovalRequest;
  status: "pending";
}

const RESOLVED: Record<ApprovalAction, boolean> = { allow: true, deny: true, cancel: true, timeout: true };

export class ApprovalBroker {
  private readonly entries = new Map<string, PendingEntry>();
  /** Resolved history per session (reconnect "stale" surfacing). */
  private readonly resolvedHistory: PendingApproval[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly adapter?: ApprovalAdapterSurface;

  constructor(adapter?: ApprovalAdapterSurface) {
    this.adapter = adapter;
  }

  private fail(code: "invalid_request" | "duplicate_request" | "unknown_request" | "cross_session_reply", message: string): ApprovalOutcome {
    return { ok: false, code, message };
  }

  private view(entry: PendingEntry, status: PendingApproval["status"], result?: ApprovalResult): PendingApproval {
    return { ...entry.request, status, result };
  }

  private drop(entry: PendingEntry, result: ApprovalResult): PendingApproval {
    const resolved = this.view(entry, "resolved", result);
    this.entries.delete(entry.request.correlationId);
    this.clearTimer(entry.request.correlationId);
    this.resolvedHistory.push(resolved);
    void this.adapter?.complete(entry.request, result);
    return resolved;
  }

  private clearTimer(correlationId: string): void {
    const timer = this.timers.get(correlationId);
    if (timer) clearTimeout(timer);
    this.timers.delete(correlationId);
  }

  /**
   * Queue a validated request and, when the adapter can surface this kind,
   * ask it for a native decision. An explicit adapter answer resolves right
   * away; otherwise the request stays pending for the client's `resolve()`.
   */
  async request(input: unknown): Promise<ApprovalOutcome> {
    const parsed = approvalRequestSchema(input);
    if (!parsed.ok) return this.fail("invalid_request", "malformed approval request");
    const req = parsed.value;
    if (this.entries.has(req.correlationId)) {
      return this.fail("duplicate_request", `correlationId already pending: ${req.correlationId}`);
    }
    const entry: PendingEntry = { request: req, status: "pending" };
    this.entries.set(req.correlationId, entry);
    if (req.timeoutMs && req.timeoutMs > 0) {
      this.timers.set(req.correlationId, setTimeout(() => void this.timeout(req.correlationId), req.timeoutMs));
    }
    // Adapter ask channel — capability-gated. No decision from the adapter
    // (or a failing one) never auto-resolves; the request stays pending.
    if (this.adapter?.canAsk(req.kind)) {
      try {
        const decision = await this.adapter.ask(req);
        if (decision && RESOLVED[decision.action] && this.entries.get(req.correlationId) === entry) {
          return { ok: true, pending: this.drop(entry, decision) };
        }
      } catch {
        // adapter offline/unavailable: keep pending for the client reply.
      }
    }
    return { ok: true, pending: this.resolvedHistory.find((item) => item.correlationId === req.correlationId) ?? this.view(entry, "pending") };
  }

  /**
   * Route a client reply to its owner. Cross-session replies are rejected and
   * the pending request survives (acceptance: cross-session replies rejected).
   */
  resolve(sessionId: string, correlationId: string, result: ApprovalResult): ApprovalOutcome {
    const entry = this.entries.get(correlationId);
    if (!entry) return this.fail("unknown_request", `no pending request: ${correlationId}`);
    if (entry.request.sessionId !== sessionId) {
      return this.fail("cross_session_reply", `request ${correlationId} belongs to session ${entry.request.sessionId}`);
    }
    return { ok: true, pending: this.drop(entry, result) };
  }

  /** User-initiated cancellation with the same ownership check as `resolve`. */
  cancel(sessionId: string, correlationId: string, reason?: string): ApprovalOutcome {
    return this.resolve(sessionId, correlationId, { action: "cancel", reason });
  }

  /** Internal timeout resolution — always `timeout`, never `allow`. */
  private timeout(correlationId: string): void {
    const entry = this.entries.get(correlationId);
    if (entry) this.drop(entry, { action: "timeout" });
  }

  /** Re-serve a session's pending asks to the adapter (reconnect recovery). */
  async reconnect(sessionId: string): Promise<number> {
    if (!this.adapter) return 0;
    let served = 0;
    for (const entry of this.entries.values()) {
      if (entry.request.sessionId !== sessionId) continue;
      if (!this.adapter.canAsk(entry.request.kind)) continue;
      served += 1;
      try {
        const decision = await this.adapter.ask(entry.request);
        if (decision && RESOLVED[decision.action]) this.drop(entry, decision);
      } catch {
        // keep pending; the client can still re-resolve via list().
      }
    }
    return served;
  }

  /** Pending requests, optionally for one session (reconnect re-resolution). */
  list(sessionId?: string): PendingApproval[] {
    return [...this.entries.values()]
      .filter((e) => !sessionId || e.request.sessionId === sessionId)
      .map((e) => this.view(e, "pending"));
  }

  /** Resolved history for a session (stale request surfacing). */
  history(sessionId?: string): PendingApproval[] {
    return this.resolvedHistory.filter((h) => !sessionId || h.sessionId === sessionId);
  }

  get size(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.entries.clear();
  }
}
