/**
 * Adapter conformance kit.
 *
 * A single harness is one implementation of the {@link HarnessAdapter} runtime
 * contract. This kit drives *any* such adapter through the same deterministic
 * flows — manifest, capability gating, session lifecycle, correlated/streamed
 * events, session-config controls, permissions, unsupported features, error
 * flows, timeouts — and reports which contract rules it honoured.
 *
 * The runner is agnostic to the concrete adapter, so a new harness proves it
 * speaks the contract by running `runConformanceSuite` and passing, exactly as
 * the ACP v2 fixture in `acp-v2.ts` does. Nothing here depends on Pi, Vicoa, or
 * any external agent binary, so it runs in CI as-is.
 */
import {
  ADAPTER_OPS,
  adapterManifestSchema,
  advertisedNames,
  capabilityMet,
  canTransition,
  ADAPTER_OPS_SPEC,
} from "./index.ts";
import type { AdapterError, AdapterManifest, SessionHandle } from "./index.ts";
import type { Identity, Capability } from "./identity.ts";
import type { NormalizedEvent } from "./events-mapping.ts";
import type { ProtocolError } from "./errors.ts";
import { isProtocolError } from "./errors.ts";

/**
 * The runtime surface a harness exposes. Orchestration (the daemon) depends
 * only on this — never on a concrete adapter — which is what makes the
 * conformance kit reusable across every protocol.
 */
export interface HarnessAdapter {
  readonly manifest: AdapterManifest;
  /** Whether `name` is one of this adapter's advertised capabilities. */
  isCapabilitySupported(name: string): boolean;
  /** ACP v2-style handshake: negotiate version + shared capabilities. */
  initialize(request: InitializeRequest): InitializeResponse;
  /** Confirm the adapter is present and launchable. */
  probe(): void;
  /** Spawn a fresh harness session. */
  start(): SessionHandle;
  /** Attach to an existing session (may be unsupported by some adapters). */
  resume(sessionId: string): SessionHandle;
  /** Send a user turn and stream back the normalized events. */
  prompt(sessionId: string, turn: Turn): TurnResult;
  /** Apply a session patch (status change + ACP session config). */
  update(sessionId: string, patch: UpdatePatch): SessionHandle;
  /** Ask for a permission and report the grant decision. */
  requestPermission(sessionId: string, request: PermissionRequest): PermissionResponse;
  /** Cancel the in-flight turn. */
  cancel(sessionId: string): SessionHandle;
  /** Terminate the harness session. */
  close(sessionId: string): void;
  /** Report liveness without side effects. */
  health(): HealthStatus;
  /** Emit a deliberate failure used by the error-flow conformance check. */
  simulateError(): void;
}

export interface InitializeRequest {
  protocolVersion: number;
  capabilities?: Capability[];
}

export interface InitializeResponse {
  negotiatedVersion: number;
  capabilities: Capability[];
  identity: Identity;
  /** Present when negotiation failed (out-of-band version, no shared cap). */
  error?: ProtocolError;
}

export interface Turn {
  text: string;
  /** Correlation id tying the streamed events back to this turn. */
  cid?: string;
  /** When true the turn exceeded its prompt deadline (deterministic CI signal). */
  timedOut?: boolean;
  /** Dispatch mode: steer (interrupt live turn) or follow-up (queue behind).
   *  Plain turns (no mode) are normal prompts. */
  mode?: "steer" | "follow_up";
  /** Base64 image attachments (adapter-validated at the boundary). */
  images?: TurnImage[];
}

/** One base64-encoded image attachment (Pi-native shape). */
export interface TurnImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface TurnResult {
  events: NormalizedEvent[];
  /** Present when the turn could not run; carries the normalized adapter error. */
  error?: AdapterError;
}

export interface UpdatePatch {
  status?: SessionStateLike;
  /** ACP v2 session config for model / thinking / mode controls. */
  config?: AcpSessionConfig;
}

/** A session status a patch may set. Kept open so the union is easy to extend. */
export type SessionStateLike = "running" | "paused" | "idle" | "resumed";

/** ACP v2-style per-session configuration. */
export interface AcpSessionConfig {
  model?: string;
  /** ACP v2 thinking budget level. */
  thinking?: "off" | "low" | "high";
  /** ACP v2 agent mode. */
  mode?: "default" | "planner" | "guided";
}

export interface PermissionRequest {
  prompt: string;
  options: string[];
}

export interface PermissionResponse {
  granted: boolean;
  choice?: string;
}

export interface HealthStatus {
  ready: boolean;
}

// --- report shape shared by every adapter ---------------------------------

/** One conformance assertion. */
export interface ConformanceCheck {
  name: string;
  pass: boolean;
  message?: string;
}

/** The outcome of running the suite against one adapter. */
export interface ConformanceReport {
  checks: ConformanceCheck[];
  pass: boolean;
  failed: ConformanceCheck[];
}

// --- helpers: drive a side effect without throwing -------------------------

/** Run `fn`, returning its value, or `null` if it throws. */
function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Run `fn`, returning whatever it throws (or `undefined` if it returned). */
function thrown<T>(fn: () => T): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

/** Whether every advertised capability name is a known, canonical name. */
function allKnownCapabilities(capabilities: AdapterManifest["capabilities"]): boolean {
  const names = new Set(capabilities.map((c) => c.name));
  const known = /^(streaming|steering|follow-ups|models|thinking|tools|permissions|attachments|commands|extensions|subagents)$/;
  for (const name of names) if (!known.test(name)) return false;
  return true;
}

/** Whether `events` are strictly ordered by an increasing `seq`. */
function monotonicallySeq(events: NormalizedEvent[]): boolean {
  let last = -1;
  for (const e of events) {
    if (e.seq <= last) return false;
    last = e.seq;
  }
  return true;
}

/** Whether every event conforms to the normalized-event shape. */
function allEventsNormalized(events: NormalizedEvent[]): boolean {
  for (const e of events) {
    if (
      typeof e.cid !== "string" ||
      typeof e.seq !== "number" ||
      typeof e.kind !== "string" ||
      typeof e.payload !== "object" ||
      e.payload === null
    ) return false;
  }
  return true;
}

/** Build the conformance suite result for a given adapter. */
export function runConformanceSuite(adapter: HarnessAdapter): ConformanceReport {
  const checks: ConformanceCheck[] = [];
  const ok = (name: string, pass: boolean, message?: string): void => {
    checks.push({ name, pass, message });
  };

  // 1. The manifest must be a valid adapter manifest.
  ok(
    "manifest is valid",
    adapterManifestSchema(adapter.manifest).ok,
    "manifest must validate against the contract",
  );

  const advertised = advertisedNames(adapter.manifest.capabilities);
  ok(
    "advertised capabilities are all known",
    allKnownCapabilities(adapter.manifest.capabilities),
    "every advertised capability must be in the canonical set",
  );
  ok(
    "advertises the streaming capability",
    advertised.includes("streaming"),
    "streaming is required for a conversational adapter",
  );

  // 2. Capability gating: an op that requires a capability the adapter does not
  // advertise cannot be driven through it. This inventory is deterministic and
  // never touches a session, so any adapter can be checked in isolation.
  for (const op of ADAPTER_OPS) {
    const required = ADAPTER_OPS_SPEC[op].requires;
    const met = capabilityMet(required, advertised);
    ok(
      `op '${op}' advertises its required capability${required.length === 1 ? "" : "s"}`,
      met,
      met ? "" : `op '${op}' requires [${required.join(", ")}], which this adapter does not advertise`,
    );
  }

  // 2b. Runtime confirmation: an op that advertises its requirement must not be
  // refused on capability grounds when actually invoked. `prompt` is the
  // canonical streaming op — running it must yield events, not a capability error.
  const startProbe = (() => {
    try {
      const handle = adapter.start();
      adapter.prompt(handle.sessionId, { text: "gating" });
      return { ok: true };
    } catch (err) {
      return { ok: isProtocolError(err) && (err.details as Record<string, unknown>)?.adapterCode !== "capability_unsupported" };
    }
  })();
  ok(
    "an advertised streaming op runs without a capability gate",
    startProbe.ok,
    "prompt with streaming advertised must not return capability_unsupported",
  );

  // 3. Initialize / handshake negotiation (returns an error envelope, does not throw).
  const goodInit = (() => {
    const r = adapter.initialize({ protocolVersion: 1, capabilities: [{ name: "streaming", version: 1 }] });
    return r.error ? null : r;
  })();
  ok(
    "initialize negotiates an in-band version",
    goodInit !== null && goodInit.negotiatedVersion === 1,
    "initialize should agree on the negotiated version",
  );
  const badInit = (() => {
    const r = adapter.initialize({ protocolVersion: 1, capabilities: [] });
    return r.error ?? null;
  })();
  ok(
    "initialize rejects when there is no shared capability",
    isProtocolError(badInit) && badInit.code === "unsupported_version",
    "initialize must reject a peer with no shared capability",
  );

  // 4. Session lifecycle and state transitions.
  const probed = (() => {
    try {
      adapter.probe();
      return true;
    } catch {
      return false;
    }
  })();
  ok("probe succeeds", probed, "probe must not throw");

  const started = safely(() => adapter.start());
  ok(
    "start creates a running session",
    started !== null && started.state === "running",
    "start must yield a running session",
  );
  ok("transition created -> running is allowed", started !== null && canTransition("created", "running"));
  ok("transition closed -> running is disallowed", !canTransition("closed", "running"), "a closed session cannot resume");

  // 5. Correlation + event ordering on a prompt turn.
  const cid = "corr-abc";
  const prompted = safely(() => adapter.prompt(started!.sessionId, { text: "hello", cid }));
  ok("prompt returns events", prompted !== null, "prompt must return events");
  ok(
    "events share the turn's correlation id",
    prompted !== null && prompted.events.every((e) => e.cid === cid),
    "every event must carry the turn's correlation id",
  );
  ok(
    "events are strictly ordered by seq",
    prompted !== null && monotonicallySeq(prompted.events),
    "seq must be strictly increasing",
  );
  ok(
    "every streamed event is normalized",
    prompted !== null && allEventsNormalized(prompted.events),
    "events must conform to the normalized schema",
  );
  ok(
    "the terminal event is an 'end'",
    prompted !== null && prompted.events.at(-1)!.kind === "end",
    "the stream must close with an 'end' event",
  );

  // 6. Session-config controls (ACP v2 model / thinking / mode).
  const configured = () =>
    adapter.update(started!.sessionId, {
      config: { model: "claude-opus", thinking: "high", mode: "planner" },
    });
  ok(
    "session config (model/thinking/mode) is accepted",
    configured().state === "running",
    "a valid session config must be applied without error",
  );
  const badCfg = thrown(() =>
    adapter.update(started!.sessionId, { config: { thinking: "cosmic" } as unknown as AcpSessionConfig }),
  );
  ok(
    "session config rejects an unsupported thinking level",
    isProtocolError(badCfg) && badCfg.code === "invalid_field",
    "an unsupported config value must normalize to invalid_field",
  );

  // 7. Permission flow.
  const perm = (() => {
    try {
      const p = adapter.requestPermission(started!.sessionId, { prompt: "run tool?", options: ["yes", "no"] });
      return { granted: p.granted };
    } catch {
      return null;
    }
  })();
  ok("permission flow resolves to a decision", perm !== null && typeof perm.granted === "boolean", "a permission request must resolve to a grant decision");
  const permEmpty = thrown(() => adapter.requestPermission(started!.sessionId, { prompt: "", options: [] }));
  ok("permission flow rejects a malformed request", isProtocolError(permEmpty), "a malformed permission request must be a normalized error");

  // 8. Unsupported features surface explicit normalized errors.
  ok("an advertised-but-unsupported capability is queryable", adapter.isCapabilitySupported("subagents") === false, "subagents is not advertised");
  const resumed = thrown(() => adapter.resume(started!.sessionId));
  ok(
    "resume surfaces operation_not_supported",
    isProtocolError(resumed) && (resumed.details as Record<string, unknown> | undefined)?.adapterCode === "operation_not_supported",
    "resume is not supported by this adapter",
  );

  // 9. Error flows are normalized, never thrown as raw errors.
  const errFlow = thrown(() => adapter.simulateError());
  ok("a simulated adapter error is a normalized ProtocolError", isProtocolError(errFlow), "adapter errors must be normalized to ProtocolError");

  // 10. Malformed turn + timeout produce normalized errors, no crash.
  const malformed = thrown(() => adapter.prompt(started!.sessionId, { text: "" }));
  ok("a malformed turn is a normalized error", isProtocolError(malformed), "an empty turn must normalize to an error");
  const timedOut = thrown(() => adapter.prompt(started!.sessionId, { text: "slow", timedOut: true }));
  ok("a timed-out turn is a normalized error", isProtocolError(timedOut), "a timed-out turn must normalize to an error");

  // 11. Cancel + close end the lifecycle cleanly.
  const canceled = (() => {
    try {
      return adapter.cancel(started!.sessionId);
    } catch {
      return null;
    }
  })();
  ok("cancel returns a handle", canceled !== null, "cancel must return a session handle");
  const closed = (() => {
    try {
      adapter.close(started!.sessionId);
      return true;
    } catch {
      return false;
    }
  })();
  ok("close terminates the session", closed, "close must not throw");
  const ready = (() => {
    try {
      const h = adapter.health();
      return typeof h.ready === "boolean";
    } catch {
      return false;
    }
  })();
  ok("health after close reports readiness honestly", ready, "health must not crash once closed");

  const failed = checks.filter((c) => !c.pass);
  return { checks, pass: failed.length === 0, failed };
}
