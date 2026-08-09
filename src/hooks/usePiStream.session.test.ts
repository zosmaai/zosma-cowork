import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	listenGate: null as Promise<void> | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
		if (mocks.listenGate) await mocks.listenGate;
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

function snapshot(
	sessionFile: string,
	content: string,
	mode: "chat" | "work" = "chat",
) {
	return {
		sessionFile,
		mode,
		cwd: `/work/${sessionFile.at(-6)}`,
		messages: [{ id: content, role: "assistant" as const, content, timestamp: 1 }],
		isRunning: false,
		status: "error" as const,
		queue: { steering: ["steer"], followUp: ["later"] },
		model: { provider: "test", id: "model", name: "Model" },
		error: { code: "provider_error", message: "failed", retryable: true },
	};
}

describe("usePiStream keyed session controller", () => {
	beforeEach(() => {
		mocks.invoke.mockReset().mockImplementation((command: string, args?: { sessionFile?: string }) => {
			if (command === "load_session") {
				return Promise.resolve(snapshot(args?.sessionFile ?? "/a.jsonl", "loaded history"));
			}
			return Promise.resolve(null);
		});
		mocks.listeners.clear();
		mocks.listenGate = null;
	});

	it("routes simultaneous tagged events to independent cached states", async () => {
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		act(() => {
			result.current.hydrateSession(snapshot("/a.jsonl", "A history"));
			result.current.hydrateSession(snapshot("/b.jsonl", "B history"));
		});
		await act(async () => {
			await Promise.all([
				result.current.startStream("/a.jsonl", "A prompt"),
				result.current.startStream("/b.jsonl", "B prompt"),
			]);
		});
		act(() => {
			mocks.listeners.get("session_event")?.({
				payload: {
					type: "event",
					sessionFile: "/a.jsonl",
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "A live" },
					},
				},
			});
			mocks.listeners.get("session_event")?.({
				payload: {
					type: "event",
					sessionFile: "/b.jsonl",
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "B live" },
					},
				},
			});
		});
		expect(result.current.states.get("/a.jsonl")?.streamingMessage?.content).toBe("A live");
		expect(result.current.states.get("/b.jsonl")?.streamingMessage?.content).toBe("B live");
	});

	it("does not reload an already cached and runtime-loaded session", async () => {
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/a.jsonl", "A")));
		await act(async () => result.current.ensureSession("/a.jsonl"));
		expect(mocks.invoke).not.toHaveBeenCalledWith("load_session", expect.anything());
	});

	it("hydrates session metadata into the keyed state", async () => {
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/a.jsonl", "A history")));
		expect(result.current.states.get("/a.jsonl")).toMatchObject({
			sessionFile: "/a.jsonl",
			cwd: `/work/${'/a.jsonl'.at(-6)}`,
			model: { provider: "test", id: "model", name: "Model" },
			runtimeLoaded: true,
			loadStatus: "loaded",
			awaitingDone: false,
			settledVersion: 0,
			sessionError: { code: "provider_error", message: "failed", retryable: true },
		});
	});

	it("aborting and removing A leaves B running and unchanged", async () => {
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		act(() => {
			result.current.hydrateSession(snapshot("/a.jsonl", "A history"));
			result.current.hydrateSession(snapshot("/b.jsonl", "B history"));
		});
		await act(async () =>
			Promise.all([
				result.current.startStream("/a.jsonl", "A prompt"),
				result.current.startStream("/b.jsonl", "B prompt"),
			]),
		);
		const bBefore = result.current.states.get("/b.jsonl");
		await act(async () => result.current.abortStream("/a.jsonl"));
		act(() => result.current.removeSession("/a.jsonl"));
		expect(result.current.states.has("/a.jsonl")).toBe(false);
		expect(result.current.states.get("/b.jsonl")).toEqual(bBefore);
		expect(result.current.states.get("/b.jsonl")?.isRunning).toBe(true);
	});

	it("deduplicates rapid cold loads", async () => {
		let release!: (value: ReturnType<typeof snapshot>) => void;
		const pending = new Promise<ReturnType<typeof snapshot>>((resolve) => {
			release = resolve;
		});
		mocks.invoke.mockImplementation((command: string) =>
			command === "load_session" ? pending : Promise.resolve(null),
		);
		const { result } = renderHook(() => usePiStream("/cold.jsonl"));
		let first!: Promise<unknown>;
		let second!: Promise<unknown>;
		act(() => {
			first = result.current.ensureSession("/cold.jsonl");
			second = result.current.ensureSession("/cold.jsonl");
		});
		await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
		release(snapshot("/cold.jsonl", "cold"));
		await act(async () => Promise.all([first, second]));
		expect(result.current.states.get("/cold.jsonl")?.messages.at(0)?.content).toBe("cold");
	});

	it("waits for the event listener before sending a prompt", async () => {
		let release!: () => void;
		mocks.listenGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/a.jsonl", "A")));
		let sending!: Promise<void>;
		act(() => {
			sending = result.current.startStream("/a.jsonl", "run");
		});
		await Promise.resolve();
		expect(mocks.invoke).not.toHaveBeenCalledWith("send_prompt", expect.anything());
		release();
		await act(async () => sending);
		expect(mocks.invoke).toHaveBeenCalledWith("send_prompt", {
			sessionFile: "/a.jsonl",
			text: "run",
		});
	});

	it("marks running sessions interrupted on sidecar loss", async () => {
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		await waitFor(() => expect(mocks.listeners.has("sidecar_lost")).toBe(true));
		act(() => result.current.hydrateSession(snapshot("/a.jsonl", "A")));
		await act(async () => result.current.startStream("/a.jsonl", "run"));
		act(() => mocks.listeners.get("sidecar_lost")?.({ payload: null }));
		expect(result.current.states.get("/a.jsonl")).toMatchObject({
			isRunning: false,
			status: "error",
			runtimeLoaded: false,
			sessionError: { code: "session_interrupted" },
		});
	});

	it("ignores an old load that resolves after sidecar loss", async () => {
		let release!: (value: ReturnType<typeof snapshot>) => void;
		mocks.invoke.mockImplementation((command: string) =>
			command === "load_session"
				? new Promise((resolve) => {
						release = resolve;
					})
				: Promise.resolve(null),
		);
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		await waitFor(() => expect(mocks.listeners.has("sidecar_lost")).toBe(true));
		let loading!: Promise<unknown>;
		act(() => {
			loading = result.current.ensureSession("/a.jsonl");
		});
		await waitFor(() =>
			expect(mocks.invoke).toHaveBeenCalledWith("load_session", {
				sessionFile: "/a.jsonl",
			}),
		);
		act(() => mocks.listeners.get("sidecar_lost")?.({ payload: null }));
		release(snapshot("/a.jsonl", "stale"));
		await act(async () => expect(loading).rejects.toThrow("invalidated"));
		expect(result.current.states.get("/a.jsonl")).toMatchObject({
			runtimeLoaded: false,
			loadStatus: "error",
			sessionError: { code: "session_interrupted" },
		});
	});

	it("ignores an old load that resolves after deletion", async () => {
		let release!: (value: ReturnType<typeof snapshot>) => void;
		mocks.invoke.mockImplementation((command: string) =>
			command === "load_session"
				? new Promise((resolve) => {
						release = resolve;
					})
				: Promise.resolve(null),
		);
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		let loading!: Promise<unknown>;
		act(() => {
			loading = result.current.ensureSession("/a.jsonl");
		});
		await waitFor(() =>
			expect(mocks.invoke).toHaveBeenCalledWith("load_session", {
				sessionFile: "/a.jsonl",
			}),
		);
		act(() => result.current.removeSession("/a.jsonl"));
		release(snapshot("/a.jsonl", "stale"));
		await act(async () => expect(loading).rejects.toThrow("invalidated"));
		expect(result.current.states.has("/a.jsonl")).toBe(false);
	});

	it("an old load cleanup cannot remove its replacement promise", async () => {
		let releaseOld!: (value: ReturnType<typeof snapshot>) => void;
		let releaseNew!: (value: ReturnType<typeof snapshot>) => void;
		mocks.invoke
			.mockImplementationOnce(() => new Promise((resolve) => {
				releaseOld = resolve;
			}))
			.mockImplementationOnce(() => new Promise((resolve) => {
				releaseNew = resolve;
			}));
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		await waitFor(() => expect(mocks.listeners.has("sidecar_lost")).toBe(true));
		let oldLoad!: Promise<unknown>;
		let newLoad!: Promise<unknown>;
		act(() => {
			oldLoad = result.current.ensureSession("/a.jsonl");
		});
		await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
		act(() => mocks.listeners.get("sidecar_lost")?.({ payload: null }));
		act(() => {
			newLoad = result.current.ensureSession("/a.jsonl");
		});
		await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
		releaseOld(snapshot("/a.jsonl", "old"));
		await act(async () => expect(oldLoad).rejects.toThrow("invalidated"));
		releaseNew(snapshot("/a.jsonl", "new"));
		await act(async () => newLoad);
		expect(result.current.states.get("/a.jsonl")?.messages.at(0)?.content).toBe("new");
	});

	it("serializes rapid mode writes and keeps the latest selected mode", async () => {
		let releaseWork!: () => void;
		const workGate = new Promise<void>((resolve) => { releaseWork = resolve; });
		mocks.invoke.mockImplementation((command: string, args?: { mode?: string }) => {
			if (command === "set_session_mode" && args?.mode === "work") return workGate;
			return Promise.resolve(null);
		});
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/a.jsonl", "", "chat")));

		let work!: Promise<void>;
		let chat!: Promise<void>;
		act(() => {
			work = result.current.setSessionMode("/a.jsonl", "work");
			chat = result.current.setSessionMode("/a.jsonl", "chat");
		});
		await waitFor(() => expect(result.current.states.get("/a.jsonl")?.mode).toBe("chat"));
		expect(mocks.invoke.mock.calls.filter(([name]) => name === "set_session_mode")).toHaveLength(1);
		releaseWork();
		await act(async () => Promise.all([work, chat]));
		const writes = mocks.invoke.mock.calls.filter(([name]) => name === "set_session_mode");
		expect(writes.map(([, args]) => args.mode)).toEqual(["work", "chat"]);
		expect(result.current.states.get("/a.jsonl")?.mode).toBe("chat");
	});

	it("rolls back the latest failed mode mutation", async () => {
		mocks.invoke.mockImplementation((command: string) =>
			command === "set_session_mode"
				? Promise.reject(new Error("metadata unavailable"))
				: Promise.resolve(null),
		);
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/a.jsonl", "", "chat")));
		await act(async () => {
			await expect(result.current.setSessionMode("/a.jsonl", "work"))
				.rejects.toThrow("metadata unavailable");
		});
		expect(result.current.states.get("/a.jsonl")?.mode).toBe("chat");
	});

	it("reloads an interrupted empty runtime before persisting its mode", async () => {
		mocks.invoke.mockImplementation((command: string, args?: { sessionFile?: string }) =>
			command === "load_session"
				? Promise.resolve(snapshot(args?.sessionFile ?? "/a.jsonl", "", "chat"))
				: Promise.resolve(null),
		);
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		await waitFor(() => expect(mocks.listeners.has("sidecar_lost")).toBe(true));
		act(() => result.current.hydrateSession(snapshot("/a.jsonl", "", "chat")));
		act(() => mocks.listeners.get("sidecar_lost")?.({ payload: null }));
		await act(async () => result.current.setSessionMode("/a.jsonl", "work"));
		const loadOrder = mocks.invoke.mock.invocationCallOrder[
			mocks.invoke.mock.calls.findIndex(([name]) => name === "load_session")
		];
		const modeOrder = mocks.invoke.mock.invocationCallOrder[
			mocks.invoke.mock.calls.findIndex(([name]) => name === "set_session_mode")
		];
		expect(loadOrder).toBeLessThan(modeOrder);
	});

	it("a failed mode save cannot resurrect a deleted session", async () => {
		let rejectSave!: (error: Error) => void;
		mocks.invoke.mockImplementation((command: string) =>
			command === "set_session_mode"
				? new Promise<void>((_, reject) => { rejectSave = reject; })
				: Promise.resolve(null),
		);
		const { result } = renderHook(() => usePiStream("/a.jsonl"));
		act(() => result.current.hydrateSession(snapshot("/a.jsonl", "", "chat")));
		let saving!: Promise<void>;
		act(() => { saving = result.current.setSessionMode("/a.jsonl", "work"); });
		await waitFor(() => expect(result.current.states.get("/a.jsonl")?.mode).toBe("work"));
		act(() => result.current.removeSession("/a.jsonl"));
		rejectSave(new Error("late failure"));
		await act(async () => saving);
		expect(result.current.states.has("/a.jsonl")).toBe(false);
	});

	describe("keyed stream reducer", () => {
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

		it("hydrates mode independently for each cached session", () => {
			const states = [
				{ type: "APPLY", sessionFile: "/a.jsonl", action: {
					type: "HYDRATE_SESSION",
					snapshot: snapshot("/a.jsonl", "A", "work"),
				} },
				{ type: "APPLY", sessionFile: "/b.jsonl", action: {
					type: "HYDRATE_SESSION",
					snapshot: snapshot("/b.jsonl", "B", "chat"),
				} },
			] satisfies SessionStreamsAction[];
			const result = states.reduce(sessionStreamsReducer, INITIAL_SESSION_STREAMS);
			expect(result.get("/a.jsonl")?.mode).toBe("work");
			expect(result.get("/b.jsonl")?.mode).toBe("chat");
		});

		it("changes mode only for the addressed cache entry", () => {
			const result = [
				{ type: "APPLY", sessionFile: "/a.jsonl", action: {
					type: "HYDRATE_SESSION",
					snapshot: snapshot("/a.jsonl", "", "chat"),
				} },
				{ type: "APPLY", sessionFile: "/b.jsonl", action: {
					type: "HYDRATE_SESSION",
					snapshot: snapshot("/b.jsonl", "", "chat"),
				} },
				{ type: "APPLY", sessionFile: "/a.jsonl", action: {
					type: "SET_SESSION_MODE",
					mode: "work",
				} },
			] satisfies SessionStreamsAction[];
			const states = result.reduce(sessionStreamsReducer, INITIAL_SESSION_STREAMS);
			expect(states.get("/a.jsonl")?.mode).toBe("work");
			expect(states.get("/b.jsonl")?.mode).toBe("chat");
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