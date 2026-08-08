import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createAgentSession: vi.fn(),
	createManager: vi.fn(),
	buildResourceLoader: vi.fn(),
	bindExtensionUi: vi.fn(),
	subscribeSession: vi.fn(() => vi.fn()),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	SessionManager: { create: mocks.createManager },
	createAgentSession: mocks.createAgentSession,
}));
vi.mock("./agent-init.js", () => ({
	buildResourceLoader: mocks.buildResourceLoader,
	resolveWorkspace: (cwd: string) => cwd,
}));
vi.mock("./extension-ui-bridge.js", () => ({
	bindExtensionUi: mocks.bindExtensionUi,
	cancelSessionUiRequests: vi.fn(),
}));
vi.mock("./prompt-runner.js", () => ({ subscribeSession: mocks.subscribeSession }));
vi.mock("./pi-session-store.js", () => ({ loadPiSession: vi.fn() }));

import { createPiRuntimeFactory } from "./session-runtime-factory.js";

function fakeSession(file: string) {
	return {
		messages: [],
		isStreaming: false,
		model: { provider: "test", id: file, name: file },
		getSteeringMessages: () => [],
		getFollowUpMessages: () => [],
		abort: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
		bindExtensions: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn(() => vi.fn()),
	};
}

describe("createPiRuntimeFactory", () => {
	beforeEach(() => {
		mocks.createManager.mockReset().mockImplementation((cwd: string) => ({
			getSessionFile: () => `${cwd}/session.jsonl`,
		}));
		mocks.buildResourceLoader.mockReset().mockImplementation(async (cwd: string) => ({ cwd }));
		mocks.createAgentSession.mockReset().mockImplementation(async ({ sessionManager }) => ({
			session: fakeSession(sessionManager.getSessionFile()),
		}));
	});

	it("creates distinct cwd-bound resources and schedulers", async () => {
		const factory = createPiRuntimeFactory({
			zosmaDir: "/zosma",
			authStorage: {} as never,
			modelRegistry: {} as never,
			settingsManager: {} as never,
		});
		const a = await factory.create("/work/a");
		const b = await factory.create("/work/b");
		expect(a.cwd).toBe("/work/a");
		expect(b.cwd).toBe("/work/b");
		expect(a.resourceLoader).not.toBe(b.resourceLoader);
		expect(a.promptScheduler).not.toBe(b.promptScheduler);
		expect(mocks.bindExtensionUi).toHaveBeenCalledWith(a.sessionFile, a.session);
		expect(mocks.bindExtensionUi).toHaveBeenCalledWith(b.sessionFile, b.session);
	});
});