import type {
  AgentStateResponse,
  AutoNameResponse,
  CapabilitiesResponse,
  HealthResponse,
  ListModelsInput,
  ListSessionsInput,
  SkillsListInput,
  SkillInstallInput,
  SkillInstallResponse,
  SkillCheckInput,
  SkillCheckResponse,
  SkillUpdateInput,
  SkillUpdateResponse,
  SkillSearchInput,
  SkillSearchResponse,
  SessionContext,
  SessionDetailsResponse,
  SessionIdInput,
  SessionMutationResponse,
  ModelState,
  UpdateModelRequest,
  SessionsResponse,
  UpdateSessionInput,
  ModelsResponse,
  SkillsResponse,
  PluginsRequestInput,
  PluginsResponse,
  PluginsListInput,
} from "./contracts";
import {
  autoNameSession as autoNameSessionFromServices,
  deleteSession as deleteSessionFromServices,
  getSessionContext as getSessionContextFromServices,
  getSessionDetails as getSessionDetailsFromServices,
  getSessionThinking as getSessionThinkingFromServices,
  listSessions as listSessionsFromServices,
  renameSession as renameSessionFromServices,
  resolveSessionPath,
} from "./sessions";
import { getModels as getModelsFromServices } from "./models";
import { BackendError } from "./errors";
import { getSessionStream as getSessionStreamFromServices } from "./stream";
import {
  getSessionModel as getSessionModelFromServices,
  configureModel as configureModelFromServices,
} from "./session-model";
import {
  listSkillsFromServices,
  installSkillFromServices,
  checkSkillUpdatesFromServices,
  updateSkillFromServices,
  searchSkillsFromServices,
} from "./skills";
import {
  readPluginsFromServices as listPluginsFromServices,
  managePluginsFromServices as managePluginsFromServices,
} from "./plugins";
import { getRuntimeManager } from "../../lib/runtime-state";
import type { RuntimeManager } from "./runtime-manager";
import type { StreamingSessionHandle } from "./stream";

export type * from "./contracts";
export { BACKEND_ERROR_CODES, BackendError, isBackendError } from "./errors";

export interface PiBackend {
  getHealth(): Promise<HealthResponse>;
  getCapabilities(): Promise<CapabilitiesResponse>;
  listSessions(input?: ListSessionsInput): Promise<SessionsResponse>;
  getSessionDetails(
    input: SessionIdInput & { deferThinking?: boolean; deferMedia?: boolean },
  ): Promise<SessionDetailsResponse>;
  getSessionContext(
    input: SessionIdInput & { leafId?: string; deferThinking?: boolean; deferMedia?: boolean },
  ): Promise<SessionContext>;
  renameSession(input: UpdateSessionInput): Promise<SessionMutationResponse>;
  deleteSession(input: SessionIdInput): Promise<SessionMutationResponse>;
  autoNameSession(input: SessionIdInput): Promise<AutoNameResponse>;
  getModels(input: ListModelsInput): Promise<ModelsResponse>;
  listSkills(input?: SkillsListInput): Promise<SkillsResponse>;
  getSessionThinking(
    input: SessionIdInput & { entryId: string; blockIndex: number },
  ): Promise<{ thinking: string }>;
  getRunningSessionIds(): Promise<string[]>;
  getAgentState(
    input: SessionIdInput,
  ): Promise<{ running: boolean; state?: AgentStateResponse }>;
  /**
   * Live event source for a running session, ready to feed the transport-neutral
   * streaming primitive (web/lib/agent-event-stream.ts). Rejected with
   * session_not_found when the session is not live.
   */
  getSessionStream(sessionId: string): Promise<StreamingSessionHandle>;
  /**
   * Read a live session's model + thinking level. Rejected with
   * session_not_found when the session is not live.
   */
  getSessionModel(sessionId: string): Promise<ModelState>;
  /**
   * Select a model and/or change the thinking-level budget on a live session,
   * then read back the applied values. Rejected with session_not_found (or
   * model_not_found on an unknown model).
   */
  configureModel(sessionId: string, patch: UpdateModelRequest): Promise<ModelState>;
  installSkill(input: SkillInstallInput): Promise<SkillInstallResponse>;
  checkSkillUpdates(input: SkillCheckInput): Promise<SkillCheckResponse>;
  updateSkill(input: SkillUpdateInput): Promise<SkillUpdateResponse>;
  searchSkills(input: SkillSearchInput): Promise<SkillSearchResponse>;
  listPlugins(input?: PluginsListInput): Promise<PluginsResponse>;
  managePlugin(input: PluginsRequestInput): Promise<PluginsResponse>;
}

export interface CreatePiBackendOptions {
  piVersion: string;
  /** Injectable for tests; defaults to the process-wide runtime manager. */
  runtime?: RuntimeManager;
}

export function createPiBackend(options: CreatePiBackendOptions): PiBackend {
  const runtime = () => options.runtime ?? getRuntimeManager();
  return {
    async getHealth() {
      return {
        status: "ok",
        apiVersion: "v1",
        piVersion: options.piVersion,
      };
    },

    async getCapabilities() {
      return {
        apiVersion: "v1",
        commandTransports: ["http"],
        eventTransports: ["sse"],
        features: {
          concurrentSessions: true,
          prompt: true,
          abort: true,
          steering: true,
          followUp: true,
          sessionBranches: true,
          bash: true,
          extensions: true,
        },
      };
    },

    async listSessions(input = {}) {
      return listSessionsFromServices(input, runtime());
    },
    async getSessionDetails(input) {
      return getSessionDetailsFromServices(input, runtime());
    },
    async getSessionContext(input) {
      return getSessionContextFromServices(input, runtime());
    },
    async renameSession(input) {
      return renameSessionFromServices(input);
    },
    async deleteSession(input) {
      return deleteSessionFromServices(input, runtime());
    },
    async autoNameSession(input) {
      return autoNameSessionFromServices(input, runtime());
    },
    getSessionThinking(input) {
      return getSessionThinkingFromServices(input);
    },
    async getRunningSessionIds() {
      return runtime().getRunningSessionIds();
    },
    async getAgentState(input) {
      const manager = runtime();
      const session = manager.getSession(input.sessionId);
      if (session?.isAlive()) {
        return {
          running: true,
          state: (await session.send({ type: "get_state" })) as AgentStateResponse,
        };
      }
      if (!(await resolveSessionPath(input.sessionId))) {
        throw new BackendError("session_not_found", "Session not found");
      }
      return { running: false };
    },
    getModels(input) {
      return getModelsFromServices(input.cwd);
    },
    listSkills(input) {
      return listSkillsFromServices(input?.cwd);
    },
    async installSkill(input) {
      return installSkillFromServices(input);
    },
    async checkSkillUpdates(input) {
      return checkSkillUpdatesFromServices(input);
    },
    async updateSkill(input) {
      return updateSkillFromServices(input);
    },
    async searchSkills(input) {
      return searchSkillsFromServices(input);
    },
    listPlugins(input) {
      return listPluginsFromServices(input?.cwd);
    },
    async managePlugin(input) {
      return managePluginsFromServices(input);
    },
    async getSessionStream(sessionId) {
      return getSessionStreamFromServices(sessionId, runtime());
    },
    async getSessionModel(sessionId) {
      return getSessionModelFromServices(sessionId, runtime());
    },
    async configureModel(sessionId, patch) {
      return configureModelFromServices(sessionId, patch, runtime());
    },
  };
}
