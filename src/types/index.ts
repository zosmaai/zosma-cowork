export interface PiStatus {
	installed: boolean;
	version: string | null;
	path: string | null;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	thinking?: string;
	toolCalls?: ToolCallInfo[];
	isStreaming?: boolean;
	model?: string;
	provider?: string;
	/**
	 * Subclass tag for issue #201 PR 3 queued bubbles. Plain user prompts
	 * carry no `kind`. Steer/follow-up messages queued mid-turn are
	 * tagged so ChatView can render a small "queued·steer" /
	 * "queued·follow-up" badge, and so the composer's Ctrl+↑ edit-mode
	 * can preserve original kind on re-queue.
	 */
	kind?: "queued-steer" | "queued-follow-up";
}

export interface ToolCallInfo {
	id: string;
	name: string;
	args: Record<string, unknown>;
	status: "running" | "completed" | "error";
	result?: string;
	isError?: boolean;
	/** Structured details from pi tool execution (diff, truncation, etc.) */
	details?: Record<string, unknown>;
	/** Partial/streaming output while tool is running */
	partialOutput?: string;
}

// Extension info from the metaagents engine
export interface ExtensionInfo {
	id: string;
	name: string;
	version: string;
	description?: string;
	enabled?: boolean;
	source?: "local" | "npm" | "localPath" | "git";
	path?: string;
}

// Provider info from pi's models.json
export interface ProviderInfo {
	id: string;
	name: string;
	api: string;
	modelCount: number;
}

// Model info from pi's models.json
export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
}

// Config snapshot from the engine
export interface ConfigPayload {
	defaultProvider: string | null;
	defaultModel: string | null;
	providers: ProviderInfo[];
	models: ModelInfo[];
}

// ─── ZEM (Zosma Extension Model) types ────────────────────────────

export interface ZemExtension {
	id: string;
	name: string;
	version: string;
	description: string;
	author?: string;
	icon?: string;
	category?: string;
	source: {
		type: "npm" | "git" | "local" | "url";
		value: string;
		ref?: string;
	};
	capabilities: {
		tools?: { name: string; description: string }[];
		skills?: string[];
		commands?: { name: string; description: string }[];
	};
	runtime: "pi" | "dhara" | "native";
	installed: boolean;
	enabled: boolean;
	installPath?: string;
	config?: Record<string, unknown>;
	configSchema?: Record<string, unknown>;
}

export * from "./pi-events";
