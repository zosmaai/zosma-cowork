import type {
  AgentStateResponse,
  AutoNameResponse,
  CapabilitiesResponse,
  HealthResponse,
  ListModelsInput,
  ListSessionsInput,
  SessionContext,
  SessionDetailsResponse,
  SessionIdInput,
  SessionMutationResponse,
  SessionsResponse,
  UpdateSessionInput,
  ModelsResponse,
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
import { getRuntimeManager } from "../../lib/runtime-state";
import type { RuntimeManager } from "./runtime-manager";

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
  getSessionThinking(
    input: SessionIdInput & { entryId: string; blockIndex: number },
  ): Promise<{ thinking: string }>;
  getRunningSessionIds(): Promise<string[]>;
  getAgentState(
    input: SessionIdInput,
  ): Promise<{ running: boolean; state?: AgentStateResponse }>;
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
  };
}
