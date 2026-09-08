import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "fs";
import { resolve } from "path";
import { invalidateModelsCache } from "./models";
import { resolveVisibleModels, selectInitialModelScope } from "./models";
import { createProjectCommandBashExtension, preferUserBashExtension } from "../../lib/project-command-env";
import { cacheSessionPath } from "./sessions";
import { projectTrustReloadOptions } from "../../lib/project-trust";
import { persistExplicitStartupPreferences } from "./models";
import type { AgentSessionLike } from "../../lib/pi-types";
import type { SessionInfo, SessionMessageEntry } from "../../lib/types";
import { AgentSessionWrapper } from "./runtime";

// ============================================================================
// Types
// ============================================================================

export interface RpcSessionStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: import("@earendil-works/pi-agent-core").ThinkingLevel;
}

export type RuntimeSessionResult = { session: AgentSessionWrapper; realSessionId: string };
export type ColdStartPromise = Promise<RuntimeSessionResult>;

export interface RuntimeState {
  registry: Map<string, AgentSessionWrapper>;
  startLocks: Map<string, ColdStartPromise>;
  startingSessionCwds: Map<string, number>;
  runningListeners: Set<(ids: string[]) => void>;
}

/**
 * Builds the inner Pi session only. Registry wiring, locks, cwd tracking, and
 * wrapper construction happen in RuntimeManager.startSession, so tests can
 * substitute a fake factory and never touch the Pi SDK.
 */
export type SessionFactory = (
  sessionId: string,
  sessionManager: SessionManager,
  options: RpcSessionStartOptions,
) => Promise<{ inner: AgentSessionLike; realSessionId: string }>;

// ============================================================================
// RuntimeManager
// Coordinates the live-session registry: cold-start locking, per-cwd busy
// tracking, running-session subscriptions, and session construction.
// ============================================================================

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

export class RuntimeManager {
  private lastRunningSnapshot = "";

  constructor(
    private state: RuntimeState,
    private readonly createSession: SessionFactory = startAgentSession,
    private readonly getState: () => RuntimeState = () => this.state,
  ) {}

  /** Re-point the maps at the current globalThis state (tests/hot-reload reassign them). */
  refreshState(): RuntimeState {
    this.state = this.getState();
    return this.state;
  }

  getSession(sessionId: string): AgentSessionWrapper | undefined {
    return this.state.registry.get(sessionId);
  }

  getSessionInfos(): SessionInfo[] {
    const sessions: SessionInfo[] = [];
    for (const session of this.state.registry.values()) {
      if (!session.isAlive()) continue;

      const manager = session.inner.sessionManager;
      const header = manager.getHeader();
      const entries = manager.getEntries() as unknown as Array<
        { type: string; timestamp: string } | SessionMessageEntry
      >;
      const messages = entries.filter((entry): entry is SessionMessageEntry => entry.type === "message");
      const firstUserMessage = messages.find((entry) => entry.message.role === "user");
      const sessionFile = manager.getSessionFile() ?? session.sessionFile;
      const persisted = Boolean(sessionFile && existsSync(sessionFile));

      // An ensure_session call creates an idle, empty runtime while the composer
      // loads commands. Do not leak it into history before a prompt is accepted.
      if (!persisted && (!session.isRunning() || !firstUserMessage)) continue;

      const created = header?.timestamp
        ?? entries[0]?.timestamp
        ?? new Date().toISOString();
      const headerTimestamp = new Date(created).getTime();
      let lastActivityMs = Number.isNaN(headerTimestamp) ? Date.now() : headerTimestamp;
      for (const message of messages) {
        const activityMs = runtimeMessageActivityMs(message);
        if (activityMs !== undefined) lastActivityMs = Math.max(lastActivityMs, activityMs);
      }

      sessions.push({
        path: sessionFile ?? "",
        id: header?.id ?? session.sessionId,
        cwd: header?.cwd ?? session.cwd,
        name: manager.getSessionName(),
        created,
        modified: new Date(lastActivityMs).toISOString(),
        messageCount: messages.length,
        firstMessage: firstUserMessage ? runtimeMessageText(firstUserMessage) || "(no messages)" : "(no messages)",
        transient: !persisted,
      });
    }
    return sessions;
  }

  hasBusySessionForCwd(cwd: string): boolean {
    const targetCwd = normalizeRpcCwd(cwd);
    if (this.state.startingSessionCwds.has(targetCwd)) return true;
    return Array.from(this.state.registry.values()).some(
      (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
    );
  }

  async destroySessionsForCwd(cwd: string): Promise<number> {
    const targetCwd = normalizeRpcCwd(cwd);
    const sessions = Array.from(this.state.registry.values()).filter(
      (session) => normalizeRpcCwd(session.cwd) === targetCwd,
    );
    await Promise.all(sessions.map((session) => session.shutdown()));
    return sessions.length;
  }

  getRunningSessionIds(): string[] {
    const ids = new Set<string>();
    for (const [sessionId, session] of this.state.registry) {
      if (session.isRunning()) ids.add(session.sessionId || sessionId);
    }
    return [...ids];
  }

  subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
    const listeners = this.state.runningListeners;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  notifyRunningChange(): void {
    const listeners = this.state.runningListeners;
    if (listeners.size === 0) {
      // A future subscriber receives its own initial snapshot. Clear this one so
      // its first state transition cannot match stale state from an old listener.
      this.lastRunningSnapshot = "";
      return;
    }
    const ids = this.getRunningSessionIds();
    const snapshot = JSON.stringify([...ids].sort());
    if (snapshot === this.lastRunningSnapshot) return;
    this.lastRunningSnapshot = snapshot;
    for (const listener of listeners) {
      try { listener(ids); } catch { /* ignore listener errors */ }
    }
  }

  async startSession(
    sessionId: string,
    sessionFile: string,
    cwd: string | undefined,
    options: RpcSessionStartOptions = {},
  ): Promise<RuntimeSessionResult> {
    const { toolNames, initialModel, thinkingLevel } = options;
    const registry = this.state.registry;
    const locks = this.state.startLocks;

    const existing = registry.get(sessionId);
    if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };
    const inflight = locks.get(sessionId);
    if (inflight) return inflight;

    let sessionManager: SessionManager;
    if (sessionFile) {
      sessionManager = SessionManager.open(sessionFile, undefined);
    } else {
      if (!cwd) throw new Error("cwd is required for a new session");
      sessionManager = SessionManager.create(cwd, undefined);
    }
    const sessionCwd = sessionManager.getCwd();
    const finishStartingSession = this.trackStartingSession(sessionCwd);

    const starting = (async () => {
      const { inner, realSessionId } = await this.createSession(
        sessionId, sessionManager, { toolNames, initialModel, thinkingLevel },
      );

      const wrapper = new AgentSessionWrapper(inner, {
        notifyRunningChange: () => this.notifyRunningChange(),
      });
      // Preserve the original ordering exactly:
      // wrapper.start() publishes session_start, then path cache, then registry.
      if (toolNames?.length === 0) wrapper.setForceEmptySystemPrompt(true);
      wrapper.start();

      const realSessionFile = inner.sessionFile as string | undefined;
      if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

      wrapper.onDestroy(() => registry.delete(realSessionId));
      registry.set(realSessionId, wrapper);
      wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

      return { session: wrapper, realSessionId };
    })().finally(() => {
      locks.delete(sessionId);
      finishStartingSession();
    });

    locks.set(sessionId, starting);
    return starting;
  }

  private trackStartingSession(cwd: string): () => void {
    const startingCwds = this.state.startingSessionCwds;
    const key = normalizeRpcCwd(cwd);
    startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
    return () => {
      const remaining = (startingCwds.get(key) ?? 1) - 1;
      if (remaining > 0) startingCwds.set(key, remaining);
      else startingCwds.delete(key);
    };
  }
}

function runtimeMessageText(entry: SessionMessageEntry): string {
  if (entry.message.role === "bashExecution") return "";
  const content = entry.message.content;
  if (typeof content === "string") return content;
  return content
    .map((block) => block.type === "text" ? block.text : "")
    .filter(Boolean)
    .join(" ");
}

function runtimeMessageActivityMs(entry: SessionMessageEntry): number | undefined {
  if (entry.message.role !== "user" && entry.message.role !== "assistant") return undefined;
  if (typeof entry.message.timestamp === "number") return entry.message.timestamp;
  const timestamp = new Date(entry.timestamp).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

// ============================================================================
// Default SDK factory
// ============================================================================

export async function startAgentSession(
  sessionId: string,
  sessionManager: SessionManager,
  options: RpcSessionStartOptions,
): Promise<{ inner: AgentSessionLike; realSessionId: string }> {
  const { toolNames, initialModel, thinkingLevel } = options;
  const sessionCwd = sessionManager.getCwd();

  // Some extensions access the SDK's global theme even outside the terminal UI.
  initTheme();
  const agentDir = getAgentDir();

  // Determine which tools to pass based on requested toolNames.
  // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
  let toolsOption: string[] | undefined;
  if (toolNames !== undefined) {
    // toolNames === [] -> "all off" (an empty allow-list disables every tool).
    // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
    // set allowedToolNames to coding builtins only, which filtered every
    // extension/package-provided tool (e.g. subagents, web access) out of the
    // tool registry — so they were unavailable in Pi Web sessions even though the
    // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
    // tools (and activate extension tools); we narrow the ACTIVE set below.
    toolsOption = toolNames.length === 0 ? [] : undefined;
  }

  // Build services first so extension-registered providers are available
  // before the SDK restores the saved model from the session file.
  // Gate untrusted project extensions so opening a repository does not run
  // its .pi/extensions code automatically (see lib/project-trust.ts, #236).
  const trustReloadOptions = projectTrustReloadOptions(sessionCwd, agentDir);
  const settingsManager = SettingsManager.create(sessionCwd, agentDir);
  const services = await createAgentSessionServices({
    cwd: sessionCwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: {
      extensionFactories: [
        createProjectCommandBashExtension({
          cwd: sessionCwd,
          settings: settingsManager,
        }),
      ],
      extensionsOverride: preferUserBashExtension,
    },
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });
  const scope = await resolveVisibleModels(
    services.modelRuntime,
    services.settingsManager.getEnabledModels(),
  );
  const defaultProvider = services.settingsManager.getDefaultProvider();
  const defaultModelId = services.settingsManager.getDefaultModel();
  const hasExistingMessages = sessionManager.getBranch().some((entry) => entry.type === "message");
  const initial = hasExistingMessages
    ? { scopedModels: [...scope.scopedModels] }
    : selectInitialModelScope(scope, {
      ...(initialModel ? { requestedModel: initialModel } : {}),
      ...(defaultProvider && defaultModelId
        ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
        : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
  const { session: inner } = await createAgentSessionFromServices({
    services,
    sessionManager,
    ...(initial.model ? { model: initial.model } : {}),
    ...(initial.thinkingLevel ? { thinkingLevel: initial.thinkingLevel } : {}),
    ...(initial.scopedModels.length > 0 ? { scopedModels: initial.scopedModels } : {}),
    ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
  });

  const persistedPreferences = await persistExplicitStartupPreferences(
    services.settingsManager,
    {
      ...(initialModel ? { model: initialModel } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    },
    {
      ...(inner.model
        ? { model: { provider: inner.model.provider, modelId: inner.model.id } }
        : {}),
      thinkingLevel: inner.thinkingLevel,
      supportsThinking: inner.supportsThinking(),
    },
  );
  if (persistedPreferences.modelDefaultChanged) invalidateModelsCache();

  // If specific tool names were requested (non-empty), set the active tools to the
  // requested builtin coding tools PLUS all extension/package tools, so installed
  // extensions stay usable in Pi Web just like in the `pi` CLI.
  if (toolNames && toolNames.length > 0) {
    inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
  }
  return { inner, realSessionId: inner.sessionId as string };
}

export function createRuntimeManager(
  state: RuntimeState,
  factory: SessionFactory = startAgentSession,
  getState: () => RuntimeState = () => state,
): RuntimeManager {
  return new RuntimeManager(state, factory, getState);
}
