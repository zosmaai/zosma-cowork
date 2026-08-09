import { outputPathForToolCall } from "./session-output-path.js";

/**
 * Extract chat messages from the pi-agent AgentMessage format into the
 * ChatMessage format used for persistence (JSONL session files).
 * Handles user, assistant, and toolCall/toolResult pairs.
 * When `cwd` is non-empty, completed write/edit tool calls also derive an
 * immutable canonical `outputPath` so live and reloaded records match.
 */
export function extractChatMessages(
	agentMessages: unknown[],
	cwd = "",
): Array<Record<string, unknown>> {
	const chatMessages: Array<Record<string, unknown>> = [];
	const pendingToolCalls: Map<string, Array<Record<string, unknown>>> =
		new Map();

	for (const raw of agentMessages) {
		if (!raw) continue;
		const msg = raw as Record<string, unknown>;
		const role = msg.role as string;
		const content = msg.content as
			| Array<Record<string, unknown>>
			| undefined;
		const timestamp = msg.timestamp as number | undefined;

		if (role === "user") {
			const text = content?.find((c) => c.type === "text")?.text as
				| string
				| undefined;
			chatMessages.push({
				role: "user",
				content: text || "",
				timestamp,
			});
		} else if (role === "assistant") {
			const text = content?.find((c) => c.type === "text")?.text as
				| string
				| undefined;
			const thinking = content?.find(
				(c) => c.type === "thinking",
			)?.thinking as string | undefined;
			const toolCalls = content
				?.filter(
					(c) =>
						c.type === "toolCall" || c.type === "tool_use",
				)
				.map((tc) => {
					const name = String(tc.name || tc.toolName || "");
					const args = tc.arguments || tc.input || {};
					const record: Record<string, unknown> = {
						id: tc.id || tc.toolCallId,
						name,
						args,
						status: "pending" as const,
						result: "",
					};
					if (cwd) {
						const outputPath = outputPathForToolCall(
							name,
							args as Record<string, unknown>,
							cwd,
						);
						if (outputPath) record.outputPath = outputPath;
					}
					return record;
				});
			if (toolCalls && toolCalls.length > 0) {
				pendingToolCalls.set(
					String(timestamp ?? Math.random()),
					toolCalls as Array<Record<string, unknown>>,
				);
			}
			const entry: Record<string, unknown> = {
				role: "assistant",
				content: text || "",
				timestamp,
			};
			if (thinking) entry.thinking = thinking;
			if (toolCalls && toolCalls.length > 0) {
				entry.toolCalls =
					toolCalls as Array<Record<string, unknown>>;
			}
			if (msg.model) entry.model = msg.model;
			if (msg.provider) entry.provider = msg.provider;
			chatMessages.push(entry);
		} else if (role === "toolResult" || role === "tool_result") {
			// Match this result to its pending tool call
			const callId = (msg.toolCallId || msg.tool_use_id) as
				| string
				| undefined;
			const resultText = content
				?.map((c) => (c.type === "text" ? c.text : ""))
				.filter(Boolean)
				.join("\n");
			const isError = msg.isError === true;

			if (callId) {
				for (const [, calls] of pendingToolCalls) {
					for (const tc of calls) {
						if (tc.id === callId) {
							tc.status = isError
								? ("error" as const)
								: ("completed" as const);
							tc.result = resultText || "";
							if (
								msg.details &&
								typeof msg.details === "object"
							) {
								tc.details = msg.details;
							}
							break;
						}
					}
				}
			}
		}
		// system messages: skip — they're display-only
	}

	return chatMessages;
}
