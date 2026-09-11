/**
 * Native Pi session factory for the daemon.
 *
 * Port of `web/packages/pi-backend`'s `startAgentSession`: creates cwd-bound
 * SDK services and builds an {@link AgentSession} around a SessionManager.
 * Deliberately omits the web-only glue (project-trust reload options, project
 * command bash extensions, model-scope resolution) — the daemon runs headless
 * with the default trust/managed-model behavior the SDK provides.
 */
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Thinking intensity the SDK understands (from pi-agent-core). */
export type ThinkingLevel = "off" | "low" | "medium" | "high" | "xhigh";

export interface PiFactoryOptions {
  cwd?: string;
  toolNames?: string[];
  thinkingLevel?: ThinkingLevel;
  /** Model scope applied at construction. Resolved via the runtime when set. */
  model?: { provider?: string; modelId?: string };
}

export type PiSessionFactory = (
  sessionId: string,
  sessionManager: SessionManager,
  options: PiFactoryOptions,
) => Promise<{ inner: AgentSession; realSessionId: string }>;

/**
 * Create a native Pi session under `sessionManager`. `sessionManager` decides
 * fresh-vs-resume: `SessionManager.create(cwd)` starts new, `SessionManager.open`
 * attaches to the persisted native session — resume preservation falls out of
 * the SDK's own open path.
 */
export const startPiSession: PiSessionFactory = async (sessionId, sessionManager, options) => {
  const cwd = sessionManager.getCwd();
  initTheme();
  const agentDir = getAgentDir();

  // Empty toolNames = "all off"; undefined = SDK default (all tools active).
  const tools = options.toolNames !== undefined ? (options.toolNames.length === 0 ? [] : undefined) : undefined;

  const settingsManager = SettingsManager.create(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
  });
  let model;
  if (options.model?.provider && options.model.modelId) {
    model = services.modelRuntime.getModel(options.model.provider, options.model.modelId);
    if (!model) throw new Error(`Model not found: ${options.model.provider}/${options.model.modelId}`);
  }
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    tools,
    model,
    thinkingLevel: options.thinkingLevel,
  });
  return { inner: session, realSessionId: session.sessionId };
}