import type {
  ExtensionStatusItem,
  ExtensionWidgetItem,
  SessionContext,
  SessionInfo,
  SessionTreeNode,
} from "../../lib/types";

export type {
  AgentMessage,
  BlockingExtensionUiRequest,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionUiResponse,
  ExtensionWidgetItem,
  SessionContext,
  SessionInfo,
  SessionTreeNode,
} from "../../lib/types";

export interface ApiSuccess<T> {
  data: T;
}

export type BackendErrorCode =
  | "invalid_request"
  | "access_denied"
  | "session_not_found"
  | "session_not_running"
  | "session_busy"
  | "prompt_rejected"
  | "model_not_found"
  | "entry_not_found"
  | "thinking_block_not_found"
  | "startup_failed"
  | "internal_error";

export interface ApiErrorResponse {
  error: {
    code: BackendErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type StreamingBehavior = "steer" | "followUp";

export interface SessionIdInput {
  sessionId: string;
}

export interface ListModelsInput {
  cwd: string;
}

export interface ListSessionsInput {
  force?: boolean;
}

export interface UpdateSessionInput extends SessionIdInput {
  name: string;
}

export interface AgentImageInput {
  type: "image";
  data: string;
  mimeType: string;
}

export interface CreateSessionInput {
  cwd: string;
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  toolNames?: string[];
}

export interface PromptInput {
  message: string;
  images?: AgentImageInput[];
  streamingBehavior?: StreamingBehavior;
}

export interface MessageCommandInput {
  message: string;
  images?: AgentImageInput[];
}

export interface HealthResponse {
  status: "ok";
  apiVersion: "v1";
  piVersion: string;
}

export interface CapabilitiesResponse {
  apiVersion: "v1";
  commandTransports: ["http"];
  eventTransports: ["sse"];
  features: {
    concurrentSessions: true;
    prompt: true;
    abort: true;
    steering: true;
    followUp: true;
    sessionBranches: true;
    bash: true;
    extensions: true;
  };
}

export interface ModelSummary {
  id: string;
  name: string;
  provider: string;
}

export interface ModelsResponse {
  models: Record<string, string>;
  modelList: ModelSummary[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  thinkingLevelPins: Record<string, string>;
  modelScopeWarnings?: string[];
  modelError?: string;
}

export interface SessionsResponse {
  sessions: SessionInfo[];
  runningSessionIds: string[];
}

export interface SessionCreatedResponse {
  sessionId: string;
  model: { provider: string; modelId: string } | null;
  thinkingLevel: string;
}

export interface SessionDetailsResponse {
  sessionId: string;
  filePath: string;
  info: SessionInfo | null;
  leafId: string | null;
  tree: SessionTreeNode[];
  context: SessionContext;
  totalActiveMs: number;
}

export interface AgentStateResponse {
  running: boolean;
  sessionId?: string;
  sessionFile?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;
  model?: { id: string; provider: string };
  messageCount?: number;
  pendingMessageCount?: number;
  queuedMessages?: { steering: string[]; followUp: string[] };
  contextUsage?: {
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
}

export interface CommandAcceptedResponse {
  accepted: true;
}

export interface SessionMutationResponse {
  success: true;
  sessionId: string;
}

export interface AutoNameResponse {
  title: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  } | null;
}

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface SessionEvent {
  sessionId: string;
  event: AgentEvent;
}

export interface SessionSubscription {
  unsubscribe(): void;
}
