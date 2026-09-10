import type {
  ExtensionStatusItem,
  ExtensionWidgetItem,
  SessionContext,
  SessionInfo,
  SessionTreeNode,
} from "../../lib/types";
import type {
  PluginScope,
  PluginResourceInfo,
  PluginResourceKind,
  SkillInstallScope,
  SkillSearchResult,
  SkillUpdateResult,
} from "../../lib/api-types";
import type {
  PluginDiagnostic,
  PluginPackageInfo,
  PluginResourceCounts,
  PluginResourceKind as PluginResourceKindApi,
  PluginsResponse,
} from "../../lib/api-types";
import type { SkillInfo, SkillsResponse } from "../../lib/api-types";

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

// Wire contract for the skills management surface (ZOS-82). SkillInfo /
// SkillsResponse are defined by the loader-backed skills service; re-exporting
// them here keeps the /api/v1 boundary transport-neutral (browser code reads
// the same shape without importing server runtime).
export type {
  SkillInfo,
  SkillsResponse,
} from "../../lib/api-types";

// Wire contract for the plugin management surface (extensions/skills/prompts/
// themes, ZOS-82). These shapes are defined by the loader/SDK-backed plugin
// service; re-exporting them keeps the /api/v1 boundary transport-neutral
// (browser code reads the same shape without importing server runtime).
export type {
  PluginDiagnostic,
  PluginPackageInfo,
  PluginResourceCounts,
  PluginResourceInfo,
  PluginResourceKind,
  PluginResourceKind as PluginResourceKindApi,
  PluginScope,
  PluginsResponse,
} from "../../lib/api-types";

export interface PluginsRequestInput {
  cwd?: string;
  action: PluginAction;
  source?: string;
  scope?: PluginScope;
}

export interface PluginsListInput {
  cwd?: string;
}

export type PluginAction =
  | "install"
  | "remove"
  | "update"
  | "disable"
  | "enable";

export type PluginsResponseAction = "list" | PluginAction;

export interface SkillsListInput {
  cwd?: string;
}

export interface SkillInstallInput {
  package: string;
  scope?: SkillInstallScope;
  cwd?: string;
}

export interface SkillUpdateInput {
  package: string;
  scope: SkillInstallScope;
  cwd: string;
}

export interface SkillCheckInput {
  package?: string;
  scope?: SkillInstallScope;
  cwd: string;
}

export interface SkillSearchInput {
  query: string;
  limit?: number;
}

export interface SkillInstallResponse {
  success: true;
  output: string;
}

export interface SkillUpdateResponse {
  success: true;
  skill?: SkillInfo;
  output: string;
}

export interface SkillCheckResponse {
  updates: SkillUpdateResult[];
}

export interface SkillSearchResponse {
  results: SkillSearchResult[];
}

export interface ApiSuccess<T> {
  data: T;
}

export type BackendErrorCode =
  | "invalid_request"
  | "cwd_required"
  | "access_denied"
  | "session_not_found"
  | "session_not_running"
  | "session_busy"
  | "prompt_rejected"
  | "model_not_found"
  | "entry_not_found"
  | "thinking_block_not_found"
  | "startup_failed"
  | "skill_not_found"
  | "skill_install_failed"
  | "skill_update_failed"
  | "skill_check_failed"
  | "skill_search_failed"
  | "plugin_action_failed"
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

/** Active model + thinking level for a live session. */
export interface ModelState {
  model: { id: string; provider: string } | null;
  thinkingLevel: string;
}

/** Model + thinking-level changes applied to a single session. */
export interface UpdateModelRequest {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

/** New model + thinking level after a PATCH, read back via get_state. */
export interface UpdateModelResponse {
  model: { id: string; provider: string } | null;
  thinkingLevel: string;
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

/**
 * Wire contract for the streaming transport
 * (`POST /api/v1/sessions/{id}/stream`).
 *
 * Transport: Server-Sent Events. Each frame is a single JSON payload sent on
 * its own `data:` line, terminated by a blank line, byte-for-byte identical to
 * the UI's `/agent/[id]/events` route so headless clients match UI parity.
 *
 * Ordering: tokens, thinking, and tool-call events arrive in the exact order
 * the Pi runtime emits them. `connected` arrives first; `agent_end` marks run
 * completion. `message_start` carries the in-flight snapshot; subsequent
 * `message_update`/`tool_execution_update` frames deliver deltas.
 */
export type StreamingWireEvent =
  | { type: "connected"; sessionId: string; isStreaming: boolean }
  | { type: "startup_error"; errorMessage: string }
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; assistantMessageEvent: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "agent_end" };
