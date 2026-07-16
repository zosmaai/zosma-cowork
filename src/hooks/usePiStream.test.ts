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
		const s = run([{ type: "QUEUE_UPDATE", steering: ["x"], followUp: ["y"] }, { type: "RESET" }]);
		expect(s.queue).toEqual({ steering: [], followUp: [] });
	});
});

/**
 * Text-end correction — issue #307.
 *
 * pi's streaming can replay text_delta events (e.g. after noheadroom
 * compaction), causing every word to appear doubled in the live bubble:
 *   "The" → "TheThe", "wiki" → "wikiwiki"
 *
 * The `text_end` event carries the authoritative final text for that
 * content block. The reducer uses it to snap the accumulated content
 * to the correct value, discarding any accumulated duplicates.
 */
describe("streamReducer — text_end correction (#307)", () => {
	it("TEXT_END replaces accumulated delta content with authoritative text", () => {
		// Simulate: deltas accumulate normally, then text_end gives the
		// authoritative final text (e.g. if deltas were replayed).
		const s = run([
			{ type: "START_STREAM", prompt: "check wiki" },
			{ type: "TEXT_DELTA", delta: "The" },
			{ type: "TEXT_DELTA", delta: " wiki" },
			{ type: "TEXT_DELTA", delta: " has" },
			// text_end fires with the correct final text
			{ type: "TEXT_END", content: "The wiki has 196 pages" },
		]);
		expect(s.streamingMessage?.content).toBe("The wiki has 196 pages");
	});

	it("TEXT_END corrects word duplication from replayed deltas", () => {
		// The exact bug from session-1782255056145.jsonl:
		// text_deltas replay the same content, doubling every word.
		const s = run([
			{ type: "START_STREAM", prompt: "check wiki" },
			// First pass — normal deltas
			{ type: "TEXT_DELTA", delta: "Interesting" },
			{ type: "TEXT_DELTA", delta: "!! " },
			{ type: "TEXT_DELTA", delta: "The" },
			{ type: "TEXT_DELTA", delta: " wiki" },
			{ type: "TEXT_DELTA", delta: " has" },
			// Second pass — same deltas replayed (causing doubling)
			{ type: "TEXT_DELTA", delta: "Interesting" },
			{ type: "TEXT_DELTA", delta: "!! " },
			{ type: "TEXT_DELTA", delta: "The" },
			{ type: "TEXT_DELTA", delta: " wiki" },
			{ type: "TEXT_DELTA", delta: " has" },
			// text_end corrects to authoritative text
			{ type: "TEXT_END", content: "Interesting!! The wiki has" },
		]);
		expect(s.streamingMessage?.content).toBe("Interesting!! The wiki has");
	});

	it("TEXT_END only replaces the current sub-turn's text, preserving previous turns", () => {
		// Multi-turn scenario: first sub-turn finalizes, then second
		// sub-turn's text_end must not overwrite the first turn's content.
		const s = run([
			{ type: "START_STREAM", prompt: "analyze" },
			// Sub-turn 1: thinking + tools
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Checking" },
			{ type: "TEXT_DELTA", delta: " data..." },
			{ type: "TEXT_END", content: "Checking data..." },
			{ type: "MESSAGE_END" },
			// Sub-turn 2: final answer
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Found" },
			{ type: "TEXT_DELTA", delta: " 3 issues" },
			{ type: "TEXT_END", content: "Found 3 issues" },
		]);
		// Both sub-turns' content preserved with separator
		expect(s.streamingMessage?.content).toContain("Checking data...");
		expect(s.streamingMessage?.content).toContain("Found 3 issues");
		// The accumulated content should be correct, not doubled
		expect(s.streamingMessage?.content).not.toContain("Checking data...Checking");
	});

	it("TEXT_END after replayed deltas with multiple sub-turns preserves all content", () => {
		// Regression: the first sub-turn's text_end corrects correctly,
		// then second sub-turn's deltas replay, text_end must correct
		// only the second sub-turn's text, keeping the first intact.
		const s = run([
			{ type: "START_STREAM", prompt: "analyze wiki" },
			// Sub-turn 1: initial analysis
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Let me" },
			{ type: "TEXT_DELTA", delta: " check the" },
			{ type: "TEXT_DELTA", delta: " wiki" },
			// Replay (duplication)
			{ type: "TEXT_DELTA", delta: "Let me" },
			{ type: "TEXT_DELTA", delta: " check the" },
			{ type: "TEXT_DELTA", delta: " wiki" },
			{ type: "TEXT_END", content: "Let me check the wiki" },
			{ type: "MESSAGE_END" },
			// Sub-turn 2: final answer
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "It has" },
			{ type: "TEXT_DELTA", delta: " 196 pages" },
			// Replay
			{ type: "TEXT_DELTA", delta: "It has" },
			{ type: "TEXT_DELTA", delta: " 196 pages" },
			{ type: "TEXT_END", content: "It has 196 pages" },
		]);
		expect(s.streamingMessage?.content).toBe("Let me check the wiki\n\nIt has 196 pages");
	});
});

/**
 * Sub-turn duplication (#307) — the opencode-go / deepseek bridge re-emits
 * some completed text blocks as a SECOND `message_start → text → text_end`
 * sub-turn. The single-bubble model used to keep both copies (separated by
 * the TURN_RESET `\n\n`), producing the doubled paragraphs seen in
 * session-1782420114625.jsonl. Adjacent byte-identical sub-turns must
 * collapse to one.
 */
describe("streamReducer — duplicate sub-turn collapse (#307)", () => {
	it("reproduces the welcome-message trace: doubled blocks collapse, single blocks survive", () => {
		const s = run([
			{ type: "START_STREAM", prompt: "Hey" },
			// Sub-turn 1: greeting
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Hey! Welcome back. 👋" },
			{ type: "TEXT_END", content: "Hey! Welcome back. 👋" },
			{ type: "MESSAGE_END" },
			// Sub-turn 2: SAME greeting re-emitted (the bug) — must collapse
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Hey! Welcome back. 👋" },
			{ type: "TEXT_END", content: "Hey! Welcome back. 👋" },
			{ type: "MESSAGE_END" },
			// Sub-turn 3: emitted ONCE — must survive
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Let me load context on what we've been up to." },
			{ type: "TEXT_END", content: "Let me load context on what we've been up to." },
			{ type: "MESSAGE_END" },
			// Sub-turn 4 + 5: same closing paragraph twice — must collapse
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Good to see you. We're in the middle of pi-llm-wiki." },
			{ type: "TEXT_END", content: "Good to see you. We're in the middle of pi-llm-wiki." },
			{ type: "MESSAGE_END" },
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Good to see you. We're in the middle of pi-llm-wiki." },
			{ type: "TEXT_END", content: "Good to see you. We're in the middle of pi-llm-wiki." },
		]);
		expect(s.streamingMessage?.content).toBe(
			"Hey! Welcome back. 👋\n\nLet me load context on what we've been up to.\n\nGood to see you. We're in the middle of pi-llm-wiki.",
		);
	});

	it("collapses a duplicate sub-turn even when the provider sends no text_end", () => {
		// Delta-only replay finalized by the next TURN_RESET.
		const s = run([
			{ type: "START_STREAM", prompt: "hi" },
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Done." },
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Done." },
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Bye." },
		]);
		expect(s.streamingMessage?.content).toBe("Done.\n\nBye.");
	});

	it("does NOT collapse two different sub-turns that happen to share a prefix", () => {
		const s = run([
			{ type: "START_STREAM", prompt: "x" },
			{ type: "TURN_RESET" },
			{ type: "TEXT_END", content: "Checking the repo." },
			{ type: "TURN_RESET" },
			{ type: "TEXT_END", content: "Checking the repo now." },
		]);
		expect(s.streamingMessage?.content).toBe("Checking the repo.\n\nChecking the repo now.");
	});

	it("preserves a sub-turn whose own text contains a blank line", () => {
		// The flat-string model would have mis-split this on \n\n; the segment
		// model keeps it intact.
		const s = run([
			{ type: "START_STREAM", prompt: "x" },
			{ type: "TURN_RESET" },
			{ type: "TEXT_END", content: "Para one.\n\nPara two." },
		]);
		expect(s.streamingMessage?.content).toBe("Para one.\n\nPara two.");
	});
});

/**
 * Error handling — a mid-stream failure must not leave a frozen, half-streamed
 * bubble stuck in the streaming state (the "stops mid" symptom). The partial
 * output is preserved into the transcript, the streaming bubble is cleared,
 * and the status flips to "error" so the ErrorBanner + retry surface.
 */
describe("streamReducer — mid-stream error finalization", () => {
	it("preserves partial output, clears the bubble, and sets error status", () => {
		const s = run([
			{ type: "START_STREAM", prompt: "do a thing" },
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Working on it" },
			{ type: "STREAM_ERROR", error: "The provided client secret is invalid (google)" },
		]);
		expect(s.status).toBe("error");
		expect(s.isRunning).toBe(false);
		expect(s.error).toContain("client secret is invalid");
		// no orphaned streaming bubble
		expect(s.streamingMessage).toBeNull();
		// partial text kept in the transcript (user + finalized assistant)
		const assistant = s.messages[s.messages.length - 1];
		expect(assistant.role).toBe("assistant");
		expect(assistant.content).toBe("Working on it");
		expect(assistant.isStreaming).toBe(false);
	});

	it("does not add a ghost assistant bubble when nothing was streamed yet", () => {
		const s = run([
			{ type: "START_STREAM", prompt: "hi" },
			{ type: "STREAM_ERROR", error: "Model failed to load" },
		]);
		expect(s.status).toBe("error");
		expect(s.streamingMessage).toBeNull();
		// only the user message remains; no empty assistant bubble
		expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
	});
});

describe("streamReducer — delivered steer/follow-up become bubbles", () => {
	it("skips the prompt echo, then renders delivered messages with kind between assistant bubbles", () => {
		const state = run([
			{ type: "START_STREAM", prompt: "do a thing" },
			// prompt echo from the SDK — must be skipped (no dup user bubble)
			{ type: "USER_MESSAGE_STARTED", content: "do a thing" },
			// assistant part 1
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "working on it" },
			// user queued a steer, SDK delivers it
			{ type: "QUEUE_OPTIMISTIC", kind: "steer", text: "use TS instead" },
			{ type: "QUEUE_UPDATE", steering: [], followUp: [] },
			{ type: "USER_MESSAGE_STARTED", content: "use TS instead" },
			// assistant part 2
			{ type: "TEXT_DELTA", delta: "switched to TS" },
			{ type: "STREAM_COMPLETE" },
		]);
		// prompt(user) + assistant-part-1 + steer(user) + assistant-part-2 = 4
		expect(state.messages.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);
		expect(state.messages[0].content).toBe("do a thing");
		expect(state.messages[1].content).toBe("working on it");
		expect(state.messages[2].content).toBe("use TS instead");
		expect(state.messages[2].kind).toBe("queued-steer");
		expect(state.messages[3].content).toBe("switched to TS");
	});

	it("labels a delivered follow-up as queued-follow-up", () => {
		const state = run([
			{ type: "START_STREAM", prompt: "start" },
			{ type: "USER_MESSAGE_STARTED", content: "start" },
			{ type: "TEXT_DELTA", delta: "done part 1" },
			{ type: "QUEUE_OPTIMISTIC", kind: "follow_up", text: "also do B" },
			{ type: "QUEUE_UPDATE", steering: [], followUp: [] },
			{ type: "USER_MESSAGE_STARTED", content: "also do B" },
		]);
		const delivered = state.messages.find((m) => m.content === "also do B");
		expect(delivered?.kind).toBe("queued-follow-up");
	});
});
