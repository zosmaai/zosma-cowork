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
});
