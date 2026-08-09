import { describe, expect, it } from "vitest";
import {
	makeSessionDone,
	makeSessionError,
	makeSessionEvent,
	makeSessionResult,
} from "./session-protocol.js";

describe("session protocol envelopes", () => {
	const sessionFile = "/tmp/pi/session-a.jsonl";

	it("tags agent events with canonical session identity", () => {
		expect(makeSessionEvent(sessionFile, { type: "agent_start" })).toEqual({
			type: "event",
			sessionFile,
			event: { type: "agent_start" },
		});
	});

	it("tags results and terminal done with command and session identity", () => {
		expect(makeSessionResult("p-1", sessionFile, { queued: true })).toEqual({
			type: "result",
			id: "p-1",
			sessionFile,
			data: { queued: true },
		});
		expect(makeSessionDone("p-1", sessionFile)).toEqual({
			type: "done",
			id: "p-1",
			sessionFile,
		});
	});

	it("keeps structured error fields on the wire", () => {
		expect(
			makeSessionError("p-1", sessionFile, {
				code: "session_not_loaded",
				message: "Session is not loaded",
				retryable: true,
				details: "runtime missing",
			}),
		).toEqual({
			type: "error",
			id: "p-1",
			sessionFile,
			code: "session_not_loaded",
			message: "Session is not loaded",
			retryable: true,
			details: "runtime missing",
		});
	});

	it("accepts both durable session modes", () => {
		const modes: import("./session-protocol.js").SessionMode[] = ["chat", "work"];
		expect(modes).toEqual(["chat", "work"]);
	});

	it.each([
		["invalid_session_mode", false],
		["session_mode_locked", false],
		["session_metadata_failed", true],
	] as const)("serializes %s", (code, retryable) => {
		expect(makeSessionError("sm-1", "/a.jsonl", {
			code,
			message: code,
			retryable,
		})).toMatchObject({ code, retryable });
	});

	it("serializes an interrupted-session error without losing retryability", () => {
		expect(makeSessionError("p-1", "/a.jsonl", {
			code: "session_interrupted",
			message: "Session stopped because the sidecar restarted",
			retryable: true,
		})).toMatchObject({
			type: "error",
			sessionFile: "/a.jsonl",
			code: "session_interrupted",
			retryable: true,
		});
	});
});
