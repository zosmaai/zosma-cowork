import { describe, expect, it } from "vitest";
import {
	CONTINUATION_MSG,
	MAX_CONTINUATIONS,
	isTextOnlyStop,
	lastAssistantMessage,
	sessionHasToolCalls,
} from "./continuation.js";

// ─── helpers to build fake session state ────────────────────────────────────

function makeSession(messages: unknown[]) {
	return { agent: { state: { messages } } };
}

function assistantText(text = "Let me write that for you..."): unknown {
	return {
		role: "assistant",
		stopReason: "stop",
		content: [{ type: "text", text }],
	};
}

function assistantThinkingAndText(): unknown {
	return {
		role: "assistant",
		stopReason: "stop",
		content: [
			{ type: "thinking", thinking: "<think>ok</think>" },
			{ type: "text", text: "Let me proceed." },
		],
	};
}

function assistantWithToolCall(): unknown {
	return {
		role: "assistant",
		stopReason: "toolUse",
		content: [{ type: "toolCall", name: "bash", input: { command: "ls" } }],
	};
}

function assistantTextAndTool(): unknown {
	return {
		role: "assistant",
		stopReason: "stop",
		content: [
			{ type: "text", text: "I will now run ls." },
			{ type: "toolCall", name: "bash", input: { command: "ls" } },
		],
	};
}

function assistantAborted(): unknown {
	return { role: "assistant", stopReason: "aborted", content: [] };
}

function assistantError(): unknown {
	return { role: "assistant", stopReason: "error", content: [{ type: "text", text: "oops" }] };
}

function userMsg(text = "do the thing"): unknown {
	return { role: "user", content: [{ type: "text", text }] };
}

// ─── lastAssistantMessage ────────────────────────────────────────────────────

describe("lastAssistantMessage", () => {
	it("returns null for empty messages", () => {
		expect(lastAssistantMessage(makeSession([]))).toBeNull();
	});

	it("returns null when session shape is wrong", () => {
		expect(lastAssistantMessage({})).toBeNull();
		expect(lastAssistantMessage(null)).toBeNull();
	});

	it("returns the last assistant message", () => {
		const last = assistantText("second");
		const session = makeSession([userMsg(), assistantText("first"), userMsg(), last]);
		expect(lastAssistantMessage(session)).toBe(last);
	});

	it("skips user messages at the tail", () => {
		const assistant = assistantText();
		const session = makeSession([assistant, userMsg()]);
		expect(lastAssistantMessage(session)).toBe(assistant);
	});
});

// ─── isTextOnlyStop ──────────────────────────────────────────────────────────

describe("isTextOnlyStop", () => {
	it("returns true for a text-only stop message", () => {
		expect(isTextOnlyStop(assistantText())).toBe(true);
	});

	it("returns true when content is thinking + text", () => {
		expect(isTextOnlyStop(assistantThinkingAndText())).toBe(true);
	});

	it("returns false when stopReason is toolUse", () => {
		expect(isTextOnlyStop(assistantWithToolCall())).toBe(false);
	});

	it("returns false when stopReason is aborted", () => {
		expect(isTextOnlyStop(assistantAborted())).toBe(false);
	});

	it("returns false when stopReason is error", () => {
		expect(isTextOnlyStop(assistantError())).toBe(false);
	});

	it("returns false when content includes a toolCall block", () => {
		expect(isTextOnlyStop(assistantTextAndTool())).toBe(false);
	});

	it("returns false for empty content (nothing to continue)", () => {
		expect(isTextOnlyStop({ role: "assistant", stopReason: "stop", content: [] })).toBe(false);
	});

	it("returns false for null / non-object", () => {
		expect(isTextOnlyStop(null)).toBe(false);
		expect(isTextOnlyStop(undefined)).toBe(false);
	});
});

// ─── sessionHasToolCalls ─────────────────────────────────────────────────────

describe("sessionHasToolCalls", () => {
	it("returns false for empty session", () => {
		expect(sessionHasToolCalls(makeSession([]))).toBe(false);
	});

	it("returns false for pure chat session (text only)", () => {
		const session = makeSession([userMsg(), assistantText()]);
		expect(sessionHasToolCalls(session)).toBe(false);
	});

	it("returns true when a prior assistant message has a toolCall", () => {
		const session = makeSession([userMsg(), assistantWithToolCall(), userMsg(), assistantText()]);
		expect(sessionHasToolCalls(session)).toBe(true);
	});

	it("returns true when the current message has a tool call mixed in", () => {
		const session = makeSession([userMsg(), assistantTextAndTool()]);
		expect(sessionHasToolCalls(session)).toBe(true);
	});

	it("returns false when session shape is wrong", () => {
		expect(sessionHasToolCalls({})).toBe(false);
		expect(sessionHasToolCalls(null)).toBe(false);
	});
});

// ─── constants ───────────────────────────────────────────────────────────────

describe("constants", () => {
	it("MAX_CONTINUATIONS is a positive integer", () => {
		expect(Number.isInteger(MAX_CONTINUATIONS)).toBe(true);
		expect(MAX_CONTINUATIONS).toBeGreaterThan(0);
	});

	it("CONTINUATION_MSG is a non-empty string", () => {
		expect(typeof CONTINUATION_MSG).toBe("string");
		expect(CONTINUATION_MSG.trim().length).toBeGreaterThan(0);
	});
});
