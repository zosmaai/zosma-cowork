/**
 * ACP v2 fixture — a deterministic fake adapter/agent for the conformance kit.
 *
 * It implements {@link HarnessAdapter} for the (in-development) official ACP v2
 * protocol so the conformance suite in `conformance.ts` can prove the adapter
 * boundary speaks something beyond Pi — without launching a real Claude, Codex,
 * or ACP binary. It is fully in-memory and self-contained: no Vicoa code, no
 * AGPL-licensed implementation, no child process. CI runs it as-is.
 *
 * The fixture deliberately advertises a *subset* of capabilities (no
 * `subagents`, `extensions`, `attachments`, or `commands`) and does not support
 * `resume` — so unsupported-feature, capability-gating, and operation
 * rejections are all exercised deterministically.
 */
import { negotiateHandshake } from "./negotiation.ts";
import { MINIMUM_VERSION, CURRENT_VERSION } from "./version.ts";
import type { Capability, Identity } from "./identity.ts";
import type { CapabilityName, CapabilityDescriptor } from "./capability.ts";
import type { AdapterManifest } from "./adapter.ts";
import {
  normalizeAdapterError,
  operationNotSupportedError,
  unsupportedCapabilityError,
  adapterError,
} from "./adapter-errors.ts";
import type { AdapterError } from "./adapter-errors.ts";
import { invalidField } from "./errors.ts";
import { mapNativeEvent } from "./events-mapping.ts";
import type { AdapterEventMapping, NormalizedEvent } from "./events-mapping.ts";
import { canTransition } from "./session-state.ts";
import type { SessionHandle, SessionState } from "./session-state.ts";

import type {
  HarnessAdapter,
  InitializeRequest,
  InitializeResponse,
  Turn,
  TurnResult,
  UpdatePatch,
  AcpSessionConfig,
  PermissionRequest,
  PermissionResponse,
  HealthStatus,
} from "./conformance.ts";

/** Handshake-level capabilities this fixture negotiates (identity namespace). */
const HANDSHAKE_CAPABILITIES: Capability[] = [
  { name: "streaming", version: 1 },
  { name: "stop", version: 1 },
];

/** ACP v2 native event tags this fixture emits, mapped to normalized kinds. */
export const ACP_V2_NATIVE_TAGS: AdapterEventMapping[] = [
  { kind: "thinking", nativeTypes: ["thinking"] },
  { kind: "message", nativeTypes: ["text"] },
  { kind: "tool", nativeTypes: ["tool_call", "tool_result"] },
  { kind: "end", nativeTypes: ["end"] },
  { kind: "error", nativeTypes: ["error"] },
];

/** ACP v2 agent modes the fixture accepts in session config. */
const ACP_V2_MODES = new Set(["default", "planner", "guided"]);
const ACP_V2_THINKING = new Set(["off", "low", "high"]);

interface AcpV2Session {
  sessionId: string;
  state: SessionState;
  nativeSessionId: string;
  nextSeq: number;
  cid: string;
  config?: AcpSessionConfig;
}

/**
 * The ACP v2 fixture. Construct it directly in tests; it needs no external
 * harness binary and behaves identically on every run.
 */
export class AcpV2Adapter implements HarnessAdapter {
  readonly manifest: AdapterManifest = {
    id: "acp-v2",
    name: "ACP v2 agent",
    kind: "acp" as const,
    protocolVersion: CURRENT_VERSION,
    capabilities: [
      { name: "streaming", version: 1, required: true },
      { name: "steering", version: 1 },
      { name: "follow-ups", version: 1 },
      { name: "models", version: 1 },
      { name: "thinking", version: 2 },
      { name: "tools", version: 1 },
      { name: "permissions", version: 1 },
    ],
    config: {
      vendor: "zosma",
      version: "0.3.0",
      launchArgs: [],
      envPolicy: {},
      timeouts: { startup: 5000, prompt: 30000, shutdown: 3000 },
    },
  };

  private readonly sessions = new Map<string, AcpV2Session>();
  private counter = 0;
  private closed = false;

  // --- introspection -------------------------------------------------------

  isCapabilitySupported(name: string): boolean {
    return (this.manifest.capabilities as CapabilityDescriptor[]).some((c) => c.name === name);
  }

  // ACP v2-native event mapping is exposed for the conformance test to assert.
  readonly eventMappings = ACP_V2_NATIVE_TAGS;

  /**
   * Enforce a capability gate before an op runs. The official ACP adapter does
   * this; the conformance suite asserts it happens deterministically.
   */
  private guard(op: string, required: CapabilityName): void {
    if (!this.isCapabilitySupported(required)) {
      throw normalizeAdapterError(
        unsupportedCapabilityError(this.manifest.id, required, op),
      );
    }
  }

  // --- lifecycle -----------------------------------------------------------

  initialize(request: InitializeRequest): InitializeResponse {
    const negotiated = negotiateHandshake(
      request.protocolVersion,
      MINIMUM_VERSION,
      CURRENT_VERSION,
      HANDSHAKE_CAPABILITIES,
      request.capabilities ?? [],
    );
    const identity: Identity = { id: "acp-v2", name: "ACP v2 agent" };
    if (!negotiated.ok) {
      return { negotiatedVersion: 0, capabilities: [], identity, error: negotiated.error };
    }
    return {
      negotiatedVersion: negotiated.value.version,
      capabilities: negotiated.value.capabilities,
      identity,
    };
  }

  probe(): void {
    if (this.closed) throw normalizeAdapterError(adapterError("acp-v2", "probe", "adapter is closed"));
  }

  start(): SessionHandle {
    this.counter += 1;
    const sessionId = `acp-sess-${this.counter}`;
    const session: AcpV2Session = {
      sessionId,
      state: "running",
      nativeSessionId: `native-${sessionId}`,
      nextSeq: 1,
      cid: `corr-${sessionId}`,
    };
    this.sessions.set(sessionId, session);
    return { sessionId, state: "running", nativeSessionId: session.nativeSessionId };
  }

  resume(sessionId: string): SessionHandle {
    this.guard("resume", "streaming");
    // ACP v2 is session-config based and does not attach to a pre-existing session.
    throw normalizeAdapterError(operationNotSupportedError("acp-v2", "resume"));
  }

  prompt(sessionId: string, turn: Turn): TurnResult {
    this.guard("prompt", "streaming");
    const session = this.sessions.get(sessionId);
    if (!session) throw normalizeAdapterError(adapterError("acp-v2", "prompt", "unknown session"));
    if (!turn.text) throw normalizeAdapterError(adapterError("acp-v2", "prompt", "empty turn"));
    if (turn.timedOut) throw normalizeAdapterError(adapterError("acp-v2", "prompt", "prompt timed out"));

    session.cid = turn.cid ?? session.cid;
    const cid = session.cid;
    const seq = session.nextSeq;
    const nextSeq = seq + 3;
    session.nextSeq = nextSeq;

    const events: NormalizedEvent[] = [
      { cid, seq, kind: "thinking", payload: { text: "considering…" } },
      { cid, seq: seq + 1, kind: "message", payload: { role: "assistant", text: `echo: ${turn.text}` } },
      { cid, seq: seq + 2, kind: "tool", payload: { name: "noop", result: "ok" } },
      { cid, seq: seq + 3, kind: "end", payload: { stopReason: "end_turn" } },
    ];
    return { events };
  }

  update(sessionId: string, patch: UpdatePatch): SessionHandle {
    const session = this.sessions.get(sessionId);
    if (!session) throw normalizeAdapterError(adapterError("acp-v2", "update", "unknown session"));

    if (patch.config) this.applyConfig(session, patch.config);

    if (patch.status) {
      if (!canTransition(session.state, patch.status)) {
        throw normalizeAdapterError(adapterError("acp-v2", "update", `cannot move to ${patch.status}`));
      }
      session.state = patch.status;
    }

    return { sessionId, state: session.state, nativeSessionId: session.nativeSessionId };
  }

  requestPermission(sessionId: string, request: PermissionRequest): PermissionResponse {
    if (!request.prompt) throw normalizeAdapterError(adapterError("acp-v2", "permission", "empty permission request"));
    if (request.options.length === 0) throw normalizeAdapterError(adapterError("acp-v2", "permission", "no options"));
    return { granted: true, choice: request.options[0] };
  }

  cancel(sessionId: string): SessionHandle {
    const session = this.sessions.get(sessionId);
    if (!session) throw normalizeAdapterError(adapterError("acp-v2", "cancel", "unknown session"));
    session.state = "idle";
    return { sessionId, state: "idle", nativeSessionId: session.nativeSessionId };
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw normalizeAdapterError(adapterError("acp-v2", "close", "unknown session"));
    session.state = "closed";
  }

  health(): HealthStatus {
    return { ready: !this.closed };
  }

  simulateError(): void {
    throw normalizeAdapterError(adapterError("acp-v2", "simulate", "deliberate fixture failure"));
  }

  // --- internals -----------------------------------------------------------

  private applyConfig(session: AcpV2Session, config: AcpSessionConfig): void {
    if (config.thinking !== undefined && !ACP_V2_THINKING.has(config.thinking)) {
      throw invalidField("thinking", "one of off,low,high");
    }
    if (config.mode !== undefined && !ACP_V2_MODES.has(config.mode)) {
      throw normalizeAdapterError(adapterError("acp-v2", "update", `unsupported mode "${config.mode}"`));
    }
    session.config = { ...session.config, ...config };
  }
}
