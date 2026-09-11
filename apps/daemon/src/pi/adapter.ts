/**
 * Pi native daemon adapter (ZOS-93).
 *
 * The `native` harness adapter: handshake negotiation, async session
 * lifecycle, correlated streaming, session config, and durable session
 * mappings. Native Pi sessions are built by an injected
 * {@link PiSessionFactory} (default: the real SDK path in `factory.ts`), so
 * the adapter logic is testable without a live model.
 *
 * Async by nature (real LLM turns stream over time), so it deliberately does
 * NOT implement the sync fixture surface `HarnessAdapter` — that contract is
 * for deterministic conformance drives (see `acp-v2.ts`). Ops here are the
 * async counterparts, consumed by the daemon server dispatch.
 */
import {
  CURRENT_VERSION,
  MINIMUM_VERSION,
  negotiateHandshake,
  normalizeAdapterError,
  adapterError,
  SessionStore,
} from "../../../../packages/protocol/src/index.ts";
import type {
  AdapterManifest,
  SessionHandle,
  SessionState,
  SessionRecord,
  InitializeRequest,
  InitializeResponse,
  Turn,
  TurnResult,
  UpdatePatch,
  AcpSessionConfig,
  PermissionRequest,
  PermissionResponse,
  HealthStatus,
  Identity,
  Capability,
  NormalizedEvent,
} from "../../../../packages/protocol/src/index.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PiSession } from "./session.ts";
import { startPiSession } from "./factory.ts";
import type { PiFactoryOptions, PiSessionFactory } from "./factory.ts";
import { PI_EVENT_MAPPINGS } from "./mapping.ts";

/** Handshake capabilities this adapter can negotiate. */
const HANDSHAKE_CAPABILITIES: Capability[] = [
  { name: "streaming", version: 1 },
  { name: "stop", version: 1 },
];

const VALID_THINKING = new Set(["off", "low", "medium", "high", "xhigh"]);

export interface PiAdapterOptions {
  /** Injected for tests; defaults to the real Pi factory. */
  sessionFactory?: PiSessionFactory;
  /** Session store dir for durable mappings (default: tmpdir/zosma-cowork/daemon). */
  storeDir?: string;
  /** Cwd for sessions started without an explicit workspace. */
  cwd?: string;
}

interface AdapterEntry {
  sessionId: string;
  nativeSessionId: string;
  state: SessionState;
  session: PiSession;
}

/** The `pi` harness adapter. */
export class PiAdapter {
  readonly manifest: AdapterManifest = {
    id: "pi",
    name: "Pi coding agent",
    kind: "native" as const,
    protocolVersion: CURRENT_VERSION,
    capabilities: [
      { name: "streaming", version: 1, required: true },
      { name: "steering", version: 1 },
      { name: "follow-ups", version: 1 },
      { name: "thinking", version: 2 },
      { name: "tools", version: 1 },
      { name: "bash", version: 1 },
      { name: "compaction", version: 1 },
      { name: "extensions", version: 1 },
    ],
    config: {
      vendor: "zosma",
      version: "0.3.0",
      timeouts: { startup: 30_000, prompt: 120_000, shutdown: 5_000 },
    },
  };

  /** Pi native event tags → normalized kinds (the single mapping point). */
  readonly eventMappings = PI_EVENT_MAPPINGS;

  private readonly sessions = new Map<string, AdapterEntry>();
  private readonly factory: PiSessionFactory | null;
  private readonly store: SessionStore;
  private readonly cwd?: string;
  private closed = false;

  constructor(options: PiAdapterOptions = {}) {
    this.factory = options.sessionFactory ?? startPiSession;
    this.store = new SessionStore(options.storeDir ?? join(tmpdir(), "zosma-cowork", "daemon"));
    this.cwd = options.cwd;
  }

  // --- introspection --------------------------------------------------------

  isCapabilitySupported(name: string): boolean {
    return this.manifest.capabilities.some((c) => c.name === name);
  }

  initialize(request: InitializeRequest): InitializeResponse {
    const negotiated = negotiateHandshake(
      request.protocolVersion,
      MINIMUM_VERSION,
      CURRENT_VERSION,
      HANDSHAKE_CAPABILITIES,
      request.capabilities ?? [],
    );
    const identity: Identity = { id: "pi", name: "Pi coding agent" };
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
    if (this.closed) throw normalizeAdapterError(adapterError("pi", "probe", "adapter is closed"));
  }

  // --- lifecycle -------------------------------------------------------------

  async start(sessionId?: string, cwd?: string, options?: PiFactoryOptions): Promise<SessionHandle> {
    return this.spawn(sessionId ?? randomUUID(), undefined, cwd, options);
  }

  /**
   * Attach to an existing session. Resume correctness comes from
   * SessionManager.open on the persisted file: the native Pi session id and
   * history are preserved, not reconstructed. When `sessionFile` is supplied
   * (client cutover: the web tier resolved the file from its session index),
   * open that file directly; otherwise fall back to the durable store
   * mapping for sessions this adapter started.
   */
  async resume(sessionId: string, sessionFile?: string): Promise<SessionHandle> {
    if (!sessionFile) {
      const record = await this.store.get(sessionId);
      if (!record) throw normalizeAdapterError(adapterError("pi", "resume", "unknown session"));
      // Resume correctness comes from SessionManager.open on the persisted
      // native session FILE (history + id preserved), not the workspace cwd.
      if (!record.sessionFile) {
        throw normalizeAdapterError(adapterError("pi", "resume", "no session file recorded for this session"));
      }
      sessionFile = record.sessionFile;
    }
    return this.spawn(sessionId, sessionFile);
  }

  private async spawn(
    sessionId: string,
    sessionFile?: string,
    cwd?: string,
    options?: PiFactoryOptions,
  ): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing && existing.state !== "closed") {
      return { sessionId, state: existing.state, nativeSessionId: existing.nativeSessionId };
    }
    const manager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd ?? this.cwd ?? resolve("."), undefined);
    const { inner, realSessionId } = await this.factory!(sessionId, manager, options ?? {});
    const session = new PiSession(inner, realSessionId, () => this.sessions.delete(realSessionId));
    this.sessions.set(realSessionId, { sessionId: realSessionId, nativeSessionId: realSessionId, state: "running", session });
    const handle: SessionHandle = { sessionId: realSessionId, state: "running", nativeSessionId: realSessionId };
    await this.store.add({
      handle,
      adapterId: "pi",
      workspace: cwd ?? this.cwd,
      sessionFile: session.sessionFile,
      pid: process.pid,
      createdAt: Date.now(),
    });
    return handle;
  }

  // --- turns ----------------------------------------------------------------

  async prompt(sessionId: string, turn: Turn): Promise<TurnResult> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return { events: [], error: adapterError("pi", "prompt", "unknown session") };
    }
    if (!turn.text || turn.timedOut) {
      return { events: [], error: adapterError("pi", "prompt", turn.timedOut ? "prompt timed out" : "empty turn") };
    }
    try {
      const events = await entry.session.run({ text: turn.text, cid: turn.cid, mode: turn.mode, images: turn.images });
      return { events };
    } catch (err) {
      entry.state = "errored";
      return {
        events: [{ cid: turn.cid ?? sessionId, seq: 1, kind: "error", payload: { message: err instanceof Error ? err.message : String(err) } }],
        error: adapterError("pi", "prompt", err instanceof Error ? err.message : String(err)),
      };
    }
  }

  async update(sessionId: string, patch: UpdatePatch): Promise<SessionHandle> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw normalizeAdapterError(adapterError("pi", "update", "unknown session"));
    if (patch.config) {
      try {
        applyConfig(entry.session, patch.config);
      } catch (err) {
        throw normalizeAdapterError(adapterError("pi", "update", err instanceof Error ? err.message : String(err)));
      }
    }
    if (patch.status) {
      entry.state = patch.status;
    }
    return { sessionId, state: entry.state, nativeSessionId: entry.nativeSessionId };
  }

  requestPermission(_sessionId: string, request: PermissionRequest): PermissionResponse {
    if (!request.prompt || request.options.length === 0) {
      throw normalizeAdapterError(adapterError("pi", "permission", "malformed permission request"));
    }
    // Headless first: pi gates risky actions inside its own tool loop.
    return { granted: true, choice: request.options[0] };
  }

  async cancel(sessionId: string): Promise<SessionHandle> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw normalizeAdapterError(adapterError("pi", "cancel", "unknown session"));
    await entry.session.abort();
    entry.state = "idle";
    return { sessionId, state: "idle", nativeSessionId: entry.nativeSessionId };
  }

  /** Dispatch an advanced-control command (ZOS-95) to the Pi session. */
  async command(sessionId: string, command: Record<string, unknown>): Promise<unknown> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw normalizeAdapterError(adapterError("pi", "command", "unknown session"));
    return entry.session.command(command as Parameters<PiSession["command"]>[0]);
  }

  /**
   * Live-event streaming transport (roadmap item 4). Pushes normalized events
   * to `sink` as they occur, mirroring the web tier's passive SSE tap
   * (`getSessionStream`). With a turn: prompts and resolves once the turn's
   * terminal event has been sunk. Without one (watch mode): holds until the
   * current/next turn ends; the SSE route closes the connection to stop.
   * ponytail: watch mode holds one listener per open stream; that is bounded
   * by the client's own connections on a loopback daemon, acceptable.
   */
  async streamTurn(
    sessionId: string | undefined,
    turn: Turn | undefined,
    sink: (event: NormalizedEvent) => void,
  ): Promise<TurnResult> {
    if (!sessionId) return { events: [], error: adapterError("pi", "stream", "unknown session") };
    const entry = this.sessions.get(sessionId);
    if (!entry) return { events: [], error: adapterError("pi", "stream", "unknown session") };
    if (turn && (!turn.text || turn.timedOut)) {
      return { events: [], error: adapterError("pi", "stream", turn.timedOut ? "prompt timed out" : "empty turn") };
    }
    const unsubscribe = entry.session.onEvent(sink);
    try {
      if (turn) return await this.prompt(sessionId, turn);
      await new Promise<void>((resolve) => {
        const stop = entry.session.onEvent((event) => {
          if (event.kind === "end") {
            stop();
            resolve();
          }
        });
      });
      return { events: [] };
    } finally {
      unsubscribe();
    }
  }

  async close(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw normalizeAdapterError(adapterError("pi", "close", "unknown session"));
    entry.state = "closed";
    await entry.session.close();
    await this.store.remove(sessionId);
    this.sessions.delete(sessionId);
  }

  listSessions(): Array<{ sessionId: string; state: string; nativeSessionId: string }> {
    return [...this.sessions.values()].map((e) => ({ sessionId: e.sessionId, state: e.state, nativeSessionId: e.nativeSessionId }));
  }

  health(): HealthStatus {
    return { ready: !this.closed && this.factory !== null };
  }

  /** Deliberate failure for error-flow tests. */
  simulateError(): void {
    throw normalizeAdapterError(adapterError("pi", "simulate", "deliberate adapter failure"));
  }

  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.sessions.values()].map((e) => this.close(e.sessionId)));
  }
}

function applyConfig(session: PiSession, config: AcpSessionConfig): void {
  if (config.thinking !== undefined) {
    if (!VALID_THINKING.has(String(config.thinking))) {
      throw new Error(`invalid thinking level: ${config.thinking}`);
    }
    // Thinking-level changes ride setThinkingLevel on the live session.
    session.inner.setThinkingLevel(config.thinking);
  }
  if (config.model) {
    // Model selection lives on the per-session config in pi-backend via
    // setModel; surfaced as unsupported here so callers see it explicitly.
    throw new Error(`model selection not supported on live session: ${config.model}`);
  }
}