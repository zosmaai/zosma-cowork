// UI-visible session types (roadmap item 6 end-to-end: the SDK type surface
// was deleted from web; these are the two shapes the UI still consumes).
export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface SessionStatsInfo {
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: ContextUsage;
  /** Estimated active time across all entries in the session file. */
  totalActiveMs?: number;
}