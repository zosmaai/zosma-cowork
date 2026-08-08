import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	send: vi.fn(),
}));

vi.mock("./protocol.js", () => ({ send: mocks.send }));

import {
	bindExtensionUi,
	cancelSessionUiRequests,
} from "./extension-ui-bridge.js";

describe("extension UI session routing", () => {
	beforeEach(() => mocks.send.mockClear());

	it("tags a UI request with the bound session file", async () => {
		let uiContext: { confirm: (title: string, message: string) => Promise<boolean> } | undefined;
		await bindExtensionUi("/tmp/a.jsonl", {
			bindExtensions: async (bindings) => {
				uiContext = bindings.uiContext as typeof uiContext;
			},
		});
		void uiContext?.confirm("Continue?", "Run tool?");
		expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
			type: "event",
			sessionFile: "/tmp/a.jsonl",
			event: expect.objectContaining({ kind: "ui_request", method: "confirm" }),
		}));
		cancelSessionUiRequests("/tmp/a.jsonl");
	});
});
