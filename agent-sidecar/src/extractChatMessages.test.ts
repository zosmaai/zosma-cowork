import { describe, it, expect } from "vitest";
import { extractChatMessages } from "./extract-chat-messages.js";

// ── Sample pi-agent AgentMessage formats ──────────────────────────────

const userMessage = {
	role: "user",
	content: [{ type: "text", text: "Hello, what can you do?" }],
	timestamp: 1712345678000,
};

const assistantTextOnly = {
	role: "assistant",
	content: [{ type: "text", text: "I can help you with various tasks!" }],
	timestamp: 1712345679000,
	model: "sonnet",
	provider: "anthropic",
};

const assistantWithThinking = {
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "Let me analyze this step by step..." },
		{ type: "text", text: "Here's my analysis." },
	],
	timestamp: 1712345680000,
};

const assistantWithToolCall = {
	role: "assistant",
	content: [
		{
			type: "toolCall",
			id: "tc-1",
			name: "read",
			arguments: { path: "/tmp/test.txt" },
		},
		{ type: "text", text: "Let me read that file for you." },
	],
	timestamp: 1712345681000,
};

const toolResultOk = {
	role: "toolResult",
	toolCallId: "tc-1",
	toolName: "read",
	content: [{ type: "text", text: "File contents: hello world" }],
	isError: false,
	timestamp: 1712345682000,
};

const toolResultError = {
	role: "toolResult",
	toolCallId: "tc-1",
	toolName: "read",
	content: [{ type: "text", text: "File not found" }],
	isError: true,
	timestamp: 1712345682000,
};

const systemMessage = {
	role: "system",
	content: [{ type: "text", text: "Processing..." }],
	timestamp: 1712345683000,
};

const emptyContentMessage = {
	role: "assistant",
	content: [],
	timestamp: 1712345684000,
};

const toolUseAlternate = {
	role: "assistant",
	content: [
		{
			type: "tool_use",
			id: "tc-2",
			name: "edit",
			input: { path: "/tmp/test.txt", content: "updated" },
		},
	],
	timestamp: 1712345685000,
};

const toolResultAlternate = {
	role: "tool_result",
	tool_use_id: "tc-2",
	content: [{ type: "text", text: "File updated" }],
	isError: false,
	timestamp: 1712345686000,
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("extractChatMessages", () => {
	it("returns empty array for empty input", () => {
		const result = extractChatMessages([]);
		expect(result).toEqual([]);
	});

	it("converts a user message correctly", () => {
		const result = extractChatMessages([userMessage]);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			role: "user",
			content: "Hello, what can you do?",
			timestamp: 1712345678000,
		});
	});

	it("converts an assistant text-only message", () => {
		const result = extractChatMessages([assistantTextOnly]);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			role: "assistant",
			content: "I can help you with various tasks!",
			timestamp: 1712345679000,
			model: "sonnet",
			provider: "anthropic",
		});
	});

	it("extracts thinking content from assistant messages", () => {
		const result = extractChatMessages([assistantWithThinking]);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			role: "assistant",
			content: "Here's my analysis.",
			timestamp: 1712345680000,
			thinking: "Let me analyze this step by step...",
		});
	});

	it("extracts tool calls from assistant messages", () => {
		const result = extractChatMessages([assistantWithToolCall]);
		expect(result).toHaveLength(1);
		const msg = result[0] as Record<string, unknown>;
		expect(msg.role).toBe("assistant");
		expect(msg.content).toBe("Let me read that file for you.");
		const tcs = msg.toolCalls as Array<Record<string, unknown>>;
		expect(tcs).toHaveLength(1);
		expect(tcs[0]).toMatchObject({
			id: "tc-1",
			name: "read",
			args: { path: "/tmp/test.txt" },
		});
	});

	it("pairs tool results with their tool calls and marks as completed", () => {
		const input = [assistantWithToolCall, toolResultOk];
		const result = extractChatMessages(input);

		// Should produce 1 assistant message with toolCalls updated
		expect(result).toHaveLength(1);
		const msg = result[0] as Record<string, unknown>;
		const tcs = msg.toolCalls as Array<Record<string, unknown>>;
		expect(tcs).toHaveLength(1);
		expect(tcs[0]).toMatchObject({
			id: "tc-1",
			name: "read",
			status: "completed",
			result: "File contents: hello world",
		});
	});

	it("pairs error tool results with error status", () => {
		const input = [assistantWithToolCall, toolResultError];
		const result = extractChatMessages(input);

		expect(result).toHaveLength(1);
		const msg = result[0] as Record<string, unknown>;
		const tcs = msg.toolCalls as Array<Record<string, unknown>>;
		expect(tcs[0].status).toBe("error");
		expect(tcs[0].result).toBe("File not found");
	});

	it("handles multi-message conversation", () => {
		const input = [
			userMessage,
			assistantTextOnly,
			userMessage,
			assistantWithToolCall,
			toolResultOk,
		];
		const result = extractChatMessages(input);

		// user, assistant, user, assistant (with toolCalls resolved)
		expect(result).toHaveLength(4);
		expect((result[0] as Record<string, unknown>).role).toBe("user");
		expect((result[1] as Record<string, unknown>).role).toBe("assistant");
		expect((result[2] as Record<string, unknown>).role).toBe("user");
		expect((result[3] as Record<string, unknown>).role).toBe("assistant");
		const lastMsg = result[3] as Record<string, unknown>;
		const lastTcs = lastMsg.toolCalls as Array<Record<string, unknown>>;
		expect(lastTcs[0].status).toBe("completed");
	});

	it("skips system messages", () => {
		const result = extractChatMessages([userMessage, systemMessage]);
		expect(result).toHaveLength(1);
		expect((result[0] as Record<string, unknown>).role).toBe("user");
	});

	it("handles messages with empty content array", () => {
		const result = extractChatMessages([emptyContentMessage]);
		expect(result).toHaveLength(1);
		const msg = result[0] as Record<string, unknown>;
		expect(msg.role).toBe("assistant");
		expect(msg.content).toBe("");
	});

	it("handles alternate tool_use/tool_result naming convention", () => {
		const input = [toolUseAlternate, toolResultAlternate];
		const result = extractChatMessages(input);

		expect(result).toHaveLength(1);
		const msg = result[0] as Record<string, unknown>;
		const tcs = msg.toolCalls as Array<Record<string, unknown>>;
		expect(tcs).toHaveLength(1);
		expect(tcs[0]).toMatchObject({
			id: "tc-2",
			name: "edit",
			status: "completed",
			result: "File updated",
		});
	});

	it("preserves canonical output path and result details on reload", () => {
		const result = extractChatMessages(
			[
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "out/report.md" } }],
					timestamp: 1,
				},
				{
					role: "toolResult",
					toolCallId: "w1",
					content: [{ type: "text", text: "Written to out/report.md" }],
					details: { tool: "write", bytes: 12 },
					isError: false,
				},
			],
			"/work/acme",
		);
		const call = (result[0].toolCalls as Array<Record<string, unknown>>)[0];
		expect(call.outputPath).toEqual({
			path: "/work/acme/out/report.md",
			displayPath: "out/report.md",
		});
		expect(call.details).toEqual({ tool: "write", bytes: 12 });
	});

	it("handles input with null/undefined values gracefully", () => {
		const result = extractChatMessages([
			null,
			undefined,
			{ role: "user", content: [{ type: "text", text: "hi" }] },
		]);
		expect(result).toHaveLength(1);
		expect(result[0].content).toBe("hi");
	});
});
