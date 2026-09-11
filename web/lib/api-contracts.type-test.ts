import type {
  AgentStateResponse,
  ApiErrorResponse,
  ApiSuccess,
  CapabilitiesResponse,
  CommandAcceptedResponse,
  HealthResponse,
  ModelsResponse,
  PromptInput,
  SessionDetailsResponse,
  SessionEvent,
  SessionIdInput,
} from "./api-contracts.ts";

const health = {
  status: "ok",
  apiVersion: "v1",
  piVersion: "0.84.2",
} satisfies HealthResponse;

const capabilities = {
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
} satisfies CapabilitiesResponse;

const accepted = {
  data: { accepted: true },
} satisfies ApiSuccess<CommandAcceptedResponse>;

const failure = {
  error: {
    code: "session_not_found",
    message: "Session not found",
  },
} satisfies ApiErrorResponse;

const modelResponse = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
  modelError: "Model list is temporarily unavailable.",
} satisfies ModelsResponse;

const state = {
  running: true,
  sessionId: "session-uuid",
  messageCount: 0,
  queuedMessages: { steering: [], followUp: [] },
} satisfies AgentStateResponse;

const sessionId = {
  sessionId: "session-uuid",
} satisfies SessionIdInput;

const prompt = {
  message: "hello",
  streamingBehavior: "followUp",
} satisfies PromptInput;

const event = {
  sessionId: "session-uuid",
  event: { type: "agent_start" },
} satisfies SessionEvent;

declare const details: SessionDetailsResponse;
const opaqueId: string = details.sessionId;

void [health, capabilities, accepted, failure, modelResponse, state, sessionId, prompt, event, opaqueId];
