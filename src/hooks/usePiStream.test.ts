import type { ToolCallInfo } from "@/types";
import { describe, expect, it } from "vitest";
import { INITIAL_STATE, type StreamAction, type StreamState, streamReducer } from "./usePiStream";

function run(actions: StreamAction[], start: StreamState = INITIAL_STATE): StreamState {
	return actions.reduce(streamReducer, start);
}

const tool = (id: string, name: string): ToolCallInfo => ({
	id,
	name,
	args: {},
	status: "running",
});

describe("streamReducer — single bubble per agent run", () => {
	it("clubs a multi-step run (think→tool→think→answer) into ONE assistant message", () => {
		const state = run([
			{ type: "START_STREAM", prompt: "What projects I have?" },
			// sub-turn 1: think + a tool
			{ type: "TURN_RESET" },
			{ type: "THINKING_DELTA", delta: "Let me check memex memory." },
			{ type: "TOOL_CALL_START", toolCall: tool("t1", "memex_recall") },
			{
				type: "TOOL_CALL_UPDATE",
				id: "t1",
				result: "ok",
				status: "completed",
			},
			{ type: "MESSAGE_END" },
			// sub-turn 2: think + more tools
			{ type: "TURN_RESET" },
			{ type: "THINKING_DELTA", delta: "Now look at the filesystem." },
			{ type: "TOOL_CALL_START", toolCall: tool("t2", "ls") },
			{ type: "TOOL_CALL_UPDATE", id: "t2", result: "ok", status: "completed" },
			{ type: "MESSAGE_END" },
			// sub-turn 3: final answer text
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Here are your projects." },
			{ type: "MESSAGE_END" },
			{ type: "STREAM_COMPLETE" },
		]);

		// 1 user + exactly 1 assistant bubble (not 3+)
		expect(state.messages).toHaveLength(2);
		const assistant = state.messages[1];
		expect(assistant.role).toBe("assistant");
		// all tool calls from every sub-turn accumulate in the single bubble
		expect(assistant.toolCalls?.map((t) => t.id)).toEqual(["t1", "t2"]);
		// final answer text preserved
		expect(assistant.content).toContain("Here are your projects.");
		// both reasoning snippets retained; latest is last
		expect(assistant.thinking).toContain("Let me check memex memory.");
		expect(assistant.thinking).toContain("Now look at the filesystem.");
		expect(state.streamingMessage).toBeNull();
		expect(state.isRunning).toBe(false);
	});

	it("MESSAGE_END does not split the bubble or drop tools", () => {
		const mid = run([
			{ type: "START_STREAM", prompt: "x" },
			{ type: "TOOL_CALL_START", toolCall: tool("t1", "read") },
			{ type: "MESSAGE_END" },
		]);
		// still streaming a single bubble, tool retained, nothing finalized yet
		expect(mid.messages).toHaveLength(1); // just the user message
		expect(mid.streamingMessage?.toolCalls).toHaveLength(1);
	});

	it("TURN_RESET keeps tools and separates successive thinking", () => {
		const s = run([
			{ type: "START_STREAM", prompt: "x" },
			{ type: "THINKING_DELTA", delta: "first" },
			{ type: "TOOL_CALL_START", toolCall: tool("t1", "read") },
			{ type: "TURN_RESET" },
			{ type: "THINKING_DELTA", delta: "second" },
		]);
		expect(s.streamingMessage?.toolCalls).toHaveLength(1);
		expect(s.streamingMessage?.thinking).toBe("first\nsecond");
	});
});

/**
 * Queue slice — issue #201 PR 3.
 *
 * StreamState gains a `queue: { steering: string[]; followUp: string[] }` slice
 * populated from two sources:
 *   1. `queue_update` events from the SDK (canonical, drives reconciliation),
 *   2. optimistic dispatches at the moment the user presses Enter / Alt+Enter
 *      while streaming, so the bubble appears instantly instead of waiting
 *      for the sidecar round-trip.
 *
 * The user-visible chat bubble for a queued message must also appear in
 * `state.messages` so the chat view scrolls naturally; we tag the message
 * with `kind: "steer" | "follow_up"` to render the badge.
 */
describe("streamReducer — queue slice (#201 PR 3)", () => {
	it("INITIAL_STATE has empty queue arrays", () => {
		expect(INITIAL_STATE.queue).toEqual({ steering: [], followUp: [] });
	});

	it("QUEUE_UPDATE replaces the queue snapshot from SDK truth", () => {
		const s = run([
			{
				type: "QUEUE_UPDATE",
				steering: ["stop, do A", "actually B"],
				followUp: ["then C"],
			},
		]);
		expect(s.queue).toEqual({
			steering: ["stop, do A", "actually B"],
			followUp: ["then C"],
		});
	});

	it("QUEUE_UPDATE with empty arrays clears the queue (no stale items)", () => {
		const s = run([
			{
				type: "QUEUE_UPDATE",
				steering: ["x"],
				followUp: ["y"],
			},
			{ type: "QUEUE_UPDATE", steering: [], followUp: [] },
		]);
		expect(s.queue).toEqual({ steering: [], followUp: [] });
	});

	// Issue #201 PR3 follow-up: optimistic queue bubbles must NOT be pushed
	// into state.messages (the canonical chat log). Reasons:
	//   1. Position — messages renders BEFORE streamingMessage in ChatView,
	//      so optimistic bubbles in messages appear above the streaming AI
	//      message instead of below where they belong chronologically.
	//   2. Edit — when the user presses Ctrl+↑ to pull the queue back into
	//      the composer, we call clearQueue() which triggers a QUEUE_UPDATE
	//      that empties state.queue. If the bubbles also live in messages,
	//      they survive that clear and become orphaned duplicates.
	// Source of truth for queued bubble rendering is state.queue.
	it("QUEUE_OPTIMISTIC(steer) adds to queue.steering and does NOT touch state.messages", () => {
		const before = run([{ type: "START_STREAM", prompt: "long task" }]);
		const after = streamReducer(before, {
			type: "QUEUE_OPTIMISTIC",
			kind: "steer",
			text: "stop, do A",
		});
		expect(after.queue.steering).toEqual(["stop, do A"]);
		expect(after.queue.followUp).toEqual([]);
		// messages array is unchanged — queue is the only source for queued bubbles.
		expect(after.messages).toBe(before.messages);
	});

	it("QUEUE_OPTIMISTIC(follow_up) adds to queue.followUp and does NOT touch state.messages", () => {
		const before = run([{ type: "START_STREAM", prompt: "long task" }]);
		const after = streamReducer(before, {
			type: "QUEUE_OPTIMISTIC",
			kind: "follow_up",
			text: "after, do B",
		});
		expect(after.queue.followUp).toEqual(["after, do B"]);
		expect(after.queue.steering).toEqual([]);
		expect(after.messages).toBe(before.messages);
	});

	it("QUEUE_UPDATE with empty arrays after a pull clears all queued bubbles atomically", () => {
		// Models the Ctrl+↑ pull flow: user has 2 queued items, presses Ctrl+↑,
		// App calls clearQueue() → SDK emits QUEUE_UPDATE with empty arrays.
		const s = run([
			{ type: "START_STREAM", prompt: "task" },
			{ type: "QUEUE_OPTIMISTIC", kind: "steer", text: "x" },
			{ type: "QUEUE_OPTIMISTIC", kind: "follow_up", text: "y" },
			{ type: "QUEUE_UPDATE", steering: [], followUp: [] },
		]);
		expect(s.queue).toEqual({ steering: [], followUp: [] });
	});

	it("queued bubbles do NOT pollute state.messages even after many dispatches", () => {
		// Defense-in-depth: chat log stays clean even with rapid queueing.
		const s = run([
			{ type: "START_STREAM", prompt: "task" },
			{ type: "QUEUE_OPTIMISTIC", kind: "steer", text: "a" },
			{ type: "QUEUE_OPTIMISTIC", kind: "steer", text: "b" },
			{ type: "QUEUE_OPTIMISTIC", kind: "follow_up", text: "c" },
		]);
		// None of the optimistic items landed in messages.
		for (const m of s.messages) {
			expect(m.kind).not.toBe("queued-steer");
			expect(m.kind).not.toBe("queued-follow-up");
		}
	});

	it("multiple QUEUE_OPTIMISTIC dispatches append in order (FIFO, no de-dup)", () => {
		const s = run([
			{ type: "START_STREAM", prompt: "x" },
			{ type: "QUEUE_OPTIMISTIC", kind: "steer", text: "a" },
			{ type: "QUEUE_OPTIMISTIC", kind: "steer", text: "a" },
			{ type: "QUEUE_OPTIMISTIC", kind: "follow_up", text: "b" },
		]);
		expect(s.queue.steering).toEqual(["a", "a"]);
		expect(s.queue.followUp).toEqual(["b"]);
	});

	it("STREAM_COMPLETE preserves the queue (a follow-up survives the originating turn)", () => {
		// The whole point of follow_up is that the agent processes it AFTER
		// the current turn ends. If we cleared the queue on STREAM_COMPLETE
		// the UI would forget the pending message a moment before the next
		// queue_update event arrives — visible flicker.
		const s = run([
			{ type: "START_STREAM", prompt: "x" },
			{ type: "QUEUE_OPTIMISTIC", kind: "follow_up", text: "b" },
			{ type: "STREAM_COMPLETE" },
		]);
		expect(s.queue.followUp).toEqual(["b"]);
	});

	it("RESET clears the queue back to empty arrays", () => {
		const s = run([
			{ type: "QUEUE_UPDATE", steering: ["x"], followUp: ["y"] },
			{ type: "RESET" },
		]);
		expect(s.queue).toEqual({ steering: [], followUp: [] });
	});
});
