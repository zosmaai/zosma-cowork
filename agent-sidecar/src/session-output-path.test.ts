import { describe, expect, it } from "vitest";
import { normalizeSessionToolEvent, outputPathForToolCall } from "./session-output-path.js";

describe("outputPathForToolCall", () => {
	it("resolves a relative completed write against its session cwd", () => {
		expect(
			outputPathForToolCall("write", { path: "reports/final.md" }, "/work/acme"),
		).toEqual({ path: "/work/acme/reports/final.md", displayPath: "reports/final.md" });
	});

	it("preserves an absolute path and original display spelling", () => {
		expect(
			outputPathForToolCall("edit", { file_path: "/work/acme/Final.md" }, "/work/acme"),
		).toEqual({ path: "/work/acme/Final.md", displayPath: "/work/acme/Final.md" });
	});

	it("ignores non-output tools and blank paths", () => {
		expect(outputPathForToolCall("read", { path: "a.md" }, "/work")).toBeUndefined();
		expect(outputPathForToolCall("write", { path: "  " }, "/work")).toBeUndefined();
	});
});

describe("normalizeSessionToolEvent", () => {
	it("adds a derived path without mutating raw tool arguments", () => {
		const event = {
			type: "message_update",
			assistantMessageEvent: {
				type: "toolcall_end",
				toolCall: { id: "w1", name: "write", arguments: { path: "out.md", content: "x" } },
			},
		};
		const normalized = normalizeSessionToolEvent(event, "/work/a") as typeof event & {
			assistantMessageEvent: { toolCall: { outputPath: { path: string; displayPath: string } } };
		};
		expect(normalized.assistantMessageEvent.toolCall.outputPath).toEqual({
			path: "/work/a/out.md",
			displayPath: "out.md",
		});
		expect(event.assistantMessageEvent.toolCall.arguments.path).toBe("out.md");
	});

	it("returns unrelated events by identity", () => {
		const event = { type: "agent_start" };
		expect(normalizeSessionToolEvent(event, "/work/a")).toBe(event);
	});
});