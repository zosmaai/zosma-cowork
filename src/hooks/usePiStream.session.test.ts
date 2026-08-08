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

	it("ignores late A events after hydrating B", async () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/sessions/a.jsonl", "A history")));
		await act(async () => result.current.startStream("/sessions/a.jsonl", "A prompt"));
		const aChannel = mocks.channels[0];
		act(() => result.current.hydrateSession(snapshot("/sessions/b.jsonl", "B history")));
		act(() => {
			aChannel.onmessage?.({
				type: "event",
				sessionFile: "/sessions/a.jsonl",
				event: { type: "done" },
			});
		});
		expect(result.current.state.messages.map((message) => message.content)).toEqual(["B history"]);
		expect(result.current.state.error).toBe("failed");
	});
});