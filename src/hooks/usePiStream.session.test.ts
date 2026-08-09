import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	channels: [] as Array<{ onmessage?: (value: unknown) => void }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: mocks.invoke,
	Channel: class {
		onmessage?: (value: unknown) => void;
		constructor() {
			mocks.channels.push(this);
		}
	},
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
		mocks.listeners.set(name, callback);
		return () => mocks.listeners.delete(name);
	}),
}));

import { usePiStream } from "./usePiStream";
import {
	INITIAL_SESSION_STREAMS,
	sessionStreamsReducer,
	type SessionStreamsAction,
} from "./usePiStream";

describe("usePiStream session identity", () => {
	beforeEach(() => {
		mocks.invoke.mockReset().mockResolvedValue({ steering: [], followUp: [] });
		mocks.channels.length = 0;
		mocks.listeners.clear();
	});

	it("includes sessionFile in every prompt operation", async () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		await act(async () => result.current.startStream("/sessions/a.jsonl", "hello"));
		expect(mocks.invoke).toHaveBeenCalledWith("send_prompt", expect.objectContaining({
			sessionFile: "/sessions/a.jsonl",
			text: "hello",
		}));
		await act(async () => result.current.abortStream("/sessions/a.jsonl"));
		expect(mocks.invoke).toHaveBeenCalledWith("abort_prompt", {
			sessionFile: "/sessions/a.jsonl",
		});
	});

	it("passes sessionFile to steer, follow-up, and clear-queue", async () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		await act(async () => result.current.steerStream("/sessions/a.jsonl", "change"));
		expect(mocks.invoke).toHaveBeenCalledWith("steer_prompt", {
			sessionFile: "/sessions/a.jsonl",
			text: "change",
		});
		await act(async () => result.current.followUpStream("/sessions/a.jsonl", "later"));
		expect(mocks.invoke).toHaveBeenCalledWith("follow_up_prompt", {
			sessionFile: "/sessions/a.jsonl",
			text: "later",
		});
		await act(async () => result.current.clearQueue("/sessions/a.jsonl"));
		expect(mocks.invoke).toHaveBeenCalledWith("clear_queue", {
			sessionFile: "/sessions/a.jsonl",
		});
	});

	it("ignores a channel event tagged for another session", async () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		await act(async () => result.current.startStream("/sessions/a.jsonl", "hello"));
		act(() => {
			mocks.channels[0].onmessage?.({
				type: "event",
				sessionFile: "/sessions/b.jsonl",
				event: { type: "done" },
			});
		});
		expect(result.current.state.isRunning).toBe(true);
	});

	const snapshot = (sessionFile: string, content: string) => ({
		sessionFile,
		mode: "chat" as const,
		cwd: `/work/${sessionFile.at(-6)}`,
		messages: [{ id: content, role: "assistant" as const, content, timestamp: 1 }],
		isRunning: false,
		status: "error" as const,
		queue: { steering: ["steer"], followUp: ["later"] },
		model: { provider: "test", id: "model", name: "Model" },
		error: { code: "provider_error", message: "failed", retryable: true },
	});

	it("hydrates every snapshot field into the single active reducer", () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/sessions/a.jsonl", "A history")));
		expect(result.current.state).toMatchObject({
			messages: [expect.objectContaining({ content: "A history" })],
			isRunning: false,
			status: "error",
			error: "failed",
			sessionError: { code: "provider_error", message: "failed", retryable: true },
			queue: { steering: ["steer"], followUp: ["later"] },
		});
	});

	it("hydration carries session/cwd/model and runtime-loaded metadata", () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/sessions/a.jsonl", "A history")));
		expect(result.current.state).toMatchObject({
			sessionFile: "/sessions/a.jsonl",
			cwd: `/work/${'/sessions/a.jsonl'.at(-6)}`,
			model: { provider: "test", id: "model", name: "Model" },
			runtimeLoaded: true,
			loadStatus: "loaded",
			awaitingDone: false,
			settledVersion: 0,
		});
	});

	it("session_event listener only mutates the active session reducer", async () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/sessions/a.jsonl", "A history")));
		// B's queue update must not touch the single A reducer.
		act(() => {
			mocks.listeners.get("session_event")?.({
				payload: {
					type: "event",
					sessionFile: "/sessions/b.jsonl",
					event: { type: "queue_update", steering: ["B"], followUp: [] },
				},
			});
		});
		expect(result.current.state.queue.steering).toEqual(["steer"]);
		// A's own queue update reaches the reducer.
		act(() => {
			mocks.listeners.get("session_event")?.({
				payload: {
					type: "event",
					sessionFile: "/sessions/a.jsonl",
					event: { type: "queue_update", steering: ["A"], followUp: [] },
				},
			});
		});
		expect(result.current.state.queue.steering).toEqual(["A"]);
	});

	describe("keyed session stream cache", () => {
		function reduceSessions(actions: SessionStreamsAction[]) {
			return actions.reduce(sessionStreamsReducer, INITIAL_SESSION_STREAMS);
		}

		it("updates only the addressed stream entry", () => {
			const states = reduceSessions([
				{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "START_STREAM", prompt: "A" } },
				{ type: "APPLY", sessionFile: "/b.jsonl", action: { type: "START_STREAM", prompt: "B" } },
				{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "TEXT_DELTA", delta: "alpha" } },
			]);
			expect(states.get("/a.jsonl")?.streamingMessage?.content).toBe("alpha");
			expect(states.get("/b.jsonl")?.streamingMessage?.content).toBe("");
			expect(states.get("/a.jsonl")?.isRunning).toBe(true);
			expect(states.get("/b.jsonl")?.isRunning).toBe(true);
		});

		it("retains hidden completion after another key becomes active", () => {
			const states = reduceSessions([
				{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "START_STREAM", prompt: "A" } },
				{ type: "APPLY", sessionFile: "/b.jsonl", action: { type: "START_STREAM", prompt: "B" } },
				{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "TEXT_DELTA", delta: "done A" } },
				{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "STREAM_COMPLETE" } },
			]);
			expect(states.get("/a.jsonl")?.messages.at(-1)?.content).toBe("done A");
			expect(states.get("/a.jsonl")?.isRunning).toBe(false);
			expect(states.get("/a.jsonl")?.settledVersion).toBe(1);
			expect(states.get("/b.jsonl")?.isRunning).toBe(true);
			expect(states.get("/b.jsonl")?.settledVersion).toBe(0);
		});

		it("marks only running streams interrupted when the runtime process is lost", () => {
			const states = reduceSessions([
				{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "START_STREAM", prompt: "A" } },
				{ type: "APPLY", sessionFile: "/b.jsonl", action: { type: "HYDRATE_SESSION", snapshot: snapshot("/b.jsonl", "B") } },
				{ type: "SIDECAR_LOST" },
			]);
			expect(states.get("/a.jsonl")).toMatchObject({
				isRunning: false,
				status: "error",
				runtimeLoaded: false,
				sessionError: { code: "session_interrupted", retryable: true },
			});
			expect(states.get("/b.jsonl")).toMatchObject({
				status: "error",
				runtimeLoaded: false,
			});
			expect(states.get("/b.jsonl")?.sessionError?.code).toBe("provider_error");
		});

		it("removes only the deleted session cache entry", () => {
			const states = reduceSessions([
				{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "START_STREAM", prompt: "A" } },
				{ type: "APPLY", sessionFile: "/b.jsonl", action: { type: "START_STREAM", prompt: "B" } },
				{ type: "REMOVE_SESSION", sessionFile: "/a.jsonl" },
			]);
			expect(states.has("/a.jsonl")).toBe(false);
			expect(states.has("/b.jsonl")).toBe(true);
		});
	});
});