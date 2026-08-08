import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	send: vi.fn(),
	runPromptTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../protocol.js", () => ({
	send: mocks.send,
	log: vi.fn(),
	logDebug: vi.fn(),
	logWarn: vi.fn(),
	logError: vi.fn(),
}));
vi.mock("../../prompt-runner.js", () => ({ runPromptTask: mocks.runPromptTask }));

import {
	handleAbort,
	handleClearQueue,
	handleFollowUp,
	handleGetActiveModel,
	handlePrompt,
	handleSetModel,
	handleSteer,
} from "./core.js";
import type { HandlerDependencies } from "../handler-registry.js";
import {
	SessionRuntimeManager,
	type SessionRuntime,
} from "../../session-runtime-manager.js";
import { createPromptScheduler } from "../../prompt-scheduler.js";
import { makeSessionDone } from "../../session-protocol.js";

function fakeRuntime(sessionFile: string, modelProvider = "test", modelId = "model"): SessionRuntime {
	const session = {
		messages: [],
		isStreaming: false,
		model: { provider: modelProvider, id: modelId, name: modelId },
		getSteeringMessages: () => [],
		getFollowUpMessages: () => [],
		abort: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
		reload: vi.fn().mockResolvedValue(undefined),
		steer: vi.fn().mockResolvedValue(undefined),
		followUp: vi.fn().mockResolvedValue(undefined),
		clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
		setModel: vi.fn().mockResolvedValue(undefined),
		prompt: vi.fn().mockResolvedValue(undefined),
	} as unknown as SessionRuntime["session"];
	return {
		sessionFile,
		cwd: "/work",
		session,
		sessionManager: {} as SessionRuntime["sessionManager"],
		resourceLoader: {} as SessionRuntime["resourceLoader"],
		promptScheduler: createPromptScheduler(),
		prompt: { activePromptId: null, startedAt: 0, hasEmitted: false },
		status: "idle",
		error: undefined,
		unsubscribe: vi.fn(),
		dispose: vi.fn().mockResolvedValue(undefined),
	};
}

function makeDeps(runtimeManager: SessionRuntimeManager): HandlerDependencies {
	return {
		initialized: true,
		modelRegistry: {
			find: vi.fn((provider: string, model: string) => ({ provider, id: model, name: model })),
		} as any,
		authStorage: {} as any,
		settingsManager: {} as any,
		zosmaDir: "/zosma",
		runtimeManager,
		initAgent: vi.fn(),
		resolveUiResponse: vi.fn(),
	} as unknown as HandlerDependencies;
}

describe("core command session isolation", () => {
	let runtimeManager: SessionRuntimeManager;
	let runtimeA: SessionRuntime;
	let runtimeB: SessionRuntime;
	let deps: HandlerDependencies;

	beforeEach(async () => {
		mocks.send.mockClear();
		mocks.runPromptTask.mockClear();

		runtimeA = fakeRuntime("/a.jsonl", "test-a", "model-a");
		runtimeB = fakeRuntime("/b.jsonl", "test-b", "model-b");

		const factory = {
			create: vi.fn(),
			load: vi.fn(),
		};
		runtimeManager = new SessionRuntimeManager(factory);
		// Manually insert runtimes into the manager's map
		(runtimeManager as any).runtimes.set(runtimeA.sessionFile, runtimeA);
		(runtimeManager as any).runtimes.set(runtimeB.sessionFile, runtimeB);

		deps = makeDeps(runtimeManager);
	});

	it("abort targets A without touching B", async () => {
		await handleAbort(deps, { type: "abort", id: "ab-a", sessionFile: "/a.jsonl" });
		expect(runtimeA.session.abort).toHaveBeenCalledOnce();
		expect(runtimeB.session.abort).not.toHaveBeenCalled();
	});

	it("steer and follow-up use only the addressed runtime queue", async () => {
		await handleSteer(deps, { type: "steer", id: "st-a", sessionFile: "/a.jsonl", text: "A" });
		await handleFollowUp(deps, { type: "follow_up", id: "fu-b", sessionFile: "/b.jsonl", text: "B" });
		expect(runtimeA.session.steer).toHaveBeenCalledWith("A", undefined);
		expect(runtimeB.session.followUp).toHaveBeenCalledWith("B", undefined);
	});

	it("unknown runtime returns structured session_not_loaded", async () => {
		await handleClearQueue(deps, { type: "clear_queue", id: "cq-x", sessionFile: "/missing.jsonl" });
		expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
			type: "error",
			id: "cq-x",
			sessionFile: expect.stringContaining("missing.jsonl"),
			code: "session_not_loaded",
			retryable: true,
		}));
	});

	it("terminates an unknown-session prompt after its structured error", async () => {
		await handlePrompt(deps, {
			type: "prompt",
			id: "p-x",
			sessionFile: "/missing.jsonl",
			text: "hello",
		});
		expect(mocks.send).toHaveBeenNthCalledWith(1, expect.objectContaining({
			type: "error",
			id: "p-x",
			code: "session_not_loaded",
		}));
		expect(mocks.send).toHaveBeenNthCalledWith(2, makeSessionDone("p-x", expect.stringContaining("missing.jsonl")));
	});

	it("prompt schedules on A's scheduler and passes runtime A", async () => {
		vi.spyOn(runtimeA.promptScheduler, "schedule");
		await handlePrompt(deps, {
			type: "prompt",
			id: "p-a",
			sessionFile: "/a.jsonl",
			text: "hello",
		});
		const scheduleCall = vi.mocked(runtimeA.promptScheduler.schedule).mock.calls[0];
		expect(scheduleCall).toBeDefined();
		const taskFn = scheduleCall[0];
		await taskFn();
		expect(mocks.runPromptTask).toHaveBeenCalledWith(
			expect.objectContaining({ id: "p-a", text: "hello" }),
			runtimeA,
		);
	});

	it("set_model changes only A's model", async () => {
		await handleSetModel(deps, { type: "set_model", id: "sm-a", sessionFile: "/a.jsonl", provider: "test-a", model: "model-a" });
		expect(runtimeA.session.setModel).toHaveBeenCalledOnce();
		expect(runtimeB.session.setModel).not.toHaveBeenCalled();
	});

	it("get_active_model returns A's model and session identity", async () => {
		await handleGetActiveModel(deps, { type: "get_active_model", id: "gam-a", sessionFile: "/a.jsonl" });
		expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
			type: "result",
			id: "gam-a",
			sessionFile: "/a.jsonl",
			data: expect.objectContaining({
				model: { provider: "test-a", id: "model-a", name: "model-a" },
			}),
		}));
	});
});
