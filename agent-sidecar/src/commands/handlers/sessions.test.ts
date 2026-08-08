import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	send: vi.fn(),
	deletePiSession: vi.fn(() => true),
	listPiSessions: vi.fn(async () => []),
	renamePiSession: vi.fn(() => true),
	searchPiSessions: vi.fn(async () => []),
	setPiSessionPinned: vi.fn(() => true),
	loadPiSession: vi.fn(() => ({
		messages: [],
		title: "",
		cwd: "/work/a",
		manager: { getSessionFile: () => "/work/a/new.jsonl" },
	})),
}));

vi.mock("../../protocol.js", () => ({
	send: mocks.send,
	log: vi.fn(),
	logDebug: vi.fn(),
	logWarn: vi.fn(),
	logError: vi.fn(),
}));
vi.mock("../../pi-session-store.js", () => ({
	deletePiSession: mocks.deletePiSession,
	listPiSessions: mocks.listPiSessions,
	renamePiSession: mocks.renamePiSession,
	searchPiSessions: mocks.searchPiSessions,
	setPiSessionPinned: mocks.setPiSessionPinned,
	loadPiSession: mocks.loadPiSession,
	convertAgentMessagesToChat: (messages: unknown[]) => messages as Array<Record<string, unknown>>,
}));
vi.mock("../../agent-init.js", () => ({
	resolveWorkspace: (cwd: string | undefined) => cwd ?? "/work",
	defaultWorkspaceDir: () => "/work",
	piAgentDir: () => "/pi-agent",
	zosmaAgentDir: (d: string) => d,
}));

import {
	handleDeleteSession,
	handleListSessions,
	handleLoadSession,
	handleNewSession,
	handleReload,
	handleRenameSession,
	handleSearchSessions,
	handleSetSessionPinned,
} from "./sessions.js";
import type { HandlerDependencies } from "../handler-registry.js";
import {
	SessionRuntimeManager,
	type SessionRuntime,
} from "../../session-runtime-manager.js";
import { createPromptScheduler } from "../../prompt-scheduler.js";

function fakeRuntime(sessionFile: string, cwd = "/work"): SessionRuntime {
	const session = {
		messages: [],
		isStreaming: false,
		model: { provider: "test", id: "model", name: "Model" },
		thinkingLevel: null,
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
		subscribe: vi.fn(() => vi.fn()),
	} as unknown as SessionRuntime["session"];
	return {
		sessionFile,
		cwd,
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
		modelRegistry: {} as any,
		authStorage: {} as any,
		settingsManager: {} as any,
		zosmaDir: "/zosma",
		runtimeManager,
		initAgent: vi.fn(),
		resolveUiResponse: vi.fn(),
	} as unknown as HandlerDependencies;
}

describe("session lifecycle handlers", () => {
	let runtimeManager: SessionRuntimeManager;
	let runtimeA: SessionRuntime;
	let runtimeB: SessionRuntime;
	let deps: HandlerDependencies;

	beforeEach(async () => {
		mocks.send.mockClear();
		mocks.deletePiSession.mockClear();
		mocks.listPiSessions.mockClear();
		mocks.searchPiSessions.mockClear();
		mocks.renamePiSession.mockClear();
		mocks.setPiSessionPinned.mockClear();

		runtimeA = fakeRuntime("/a.jsonl", "/work/a");
		runtimeB = fakeRuntime("/b.jsonl", "/work/b");

		const factory = {
			create: vi.fn(async (cwd: string) => fakeRuntime(`${cwd}/new.jsonl`, cwd)),
			load: vi.fn(async (file: string) => fakeRuntime(file)),
		};
		runtimeManager = new SessionRuntimeManager(factory);
		vi.spyOn(runtimeManager, "create");
		vi.spyOn(runtimeManager, "load");
		vi.spyOn(runtimeManager, "dispose");

		deps = makeDeps(runtimeManager);
	});

	it("new_session returns a complete runtime snapshot", async () => {
		await handleNewSession(deps, { type: "new_session", id: "n-1", cwd: "/work" });
		expect(runtimeManager.create).toHaveBeenCalledWith("/work");
		expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
			type: "result",
			id: "n-1",
			sessionFile: expect.stringContaining("new.jsonl"),
			data: expect.objectContaining({
				cwd: "/work",
				messages: [],
				isRunning: false,
				status: "idle",
			}),
		}));
	});

	it("load_session is idempotent through the manager and does not abort another runtime", async () => {
		(runtimeManager as any).runtimes.set(runtimeB.sessionFile, runtimeB);
		mocks.loadPiSession.mockReturnValue({
			messages: [],
			title: "",
			cwd: "/work/a",
			manager: { getSessionFile: (): string => "/a.jsonl" },
		} as ReturnType<typeof mocks.loadPiSession>);
		await handleLoadSession(deps, { type: "load_session", id: "l-1", sessionFile: "/a.jsonl" });
		expect(runtimeManager.load).toHaveBeenCalledWith(expect.stringContaining("a.jsonl"));
		expect(runtimeB.session.abort).not.toHaveBeenCalled();
	});

	it("delete disposes the loaded runtime before deleting persistence", async () => {
		(runtimeManager as any).runtimes.set(runtimeA.sessionFile, runtimeA);
		await handleDeleteSession(deps, { type: "delete_session", id: "d-1", sessionFile: "/a.jsonl" });
		expect(runtimeManager.dispose).toHaveBeenCalledWith(expect.stringContaining("a.jsonl"));
		// dispose happens before deletePiSession
		const disposeOrder = vi.mocked(runtimeManager.dispose).mock.invocationCallOrder[0];
		const deleteOrder = mocks.deletePiSession.mock.invocationCallOrder[0];
		expect(disposeOrder).toBeLessThan(deleteOrder);
		expect(mocks.deletePiSession).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("a.jsonl"));
	});

	it("list_sessions passes cwd when allFolders is false and undefined when true", async () => {
		await handleListSessions(deps, { type: "list_sessions", id: "ls-1", allFolders: false, cwd: "/work/a" });
		expect(mocks.listPiSessions).toHaveBeenCalledWith(expect.any(String), "/work/a");
		mocks.listPiSessions.mockClear();
		await handleListSessions(deps, { type: "list_sessions", id: "ls-2", allFolders: true, cwd: "/work/a" });
		expect(mocks.listPiSessions).toHaveBeenCalledWith(expect.any(String), undefined);
	});

	it("search_sessions passes cwd when allFolders is false and undefined when true", async () => {
		await handleSearchSessions(deps, { type: "search_sessions", id: "ss-1", query: "hi", allFolders: false, cwd: "/work/a" });
		expect(mocks.searchPiSessions).toHaveBeenCalledWith(expect.any(String), "hi", "/work/a");
		mocks.searchPiSessions.mockClear();
		await handleSearchSessions(deps, { type: "search_sessions", id: "ss-2", query: "hi", allFolders: true, cwd: "/work/a" });
		expect(mocks.searchPiSessions).toHaveBeenCalledWith(expect.any(String), "hi", undefined);
	});

	it("rename and pin preserve session identity fields", async () => {
		await handleRenameSession(deps, { type: "rename_session", id: "rn-1", sessionFile: "/a.jsonl", title: "New" });
		expect(mocks.renamePiSession).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("a.jsonl"), "New");
		await handleSetSessionPinned(deps, { type: "set_session_pinned", id: "pn-1", sessionFile: "/a.jsonl", pinned: true });
		expect(mocks.setPiSessionPinned).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("a.jsonl"), true);
	});

	it("reload delegates to initAgent", async () => {
		await handleReload(deps, { type: "reload", id: "rl-1" });
		expect(deps.initAgent).toHaveBeenCalledWith("/zosma");
	});
});

describe("initAgent preserves runtimes on in-process refresh", () => {
	it("existing-manager branch calls reloadAll and never disposes", async () => {
		const { readFileSync } = await import("node:fs");
		const src = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");
		// Isolate the initAgent function body (non-greedy to the first 2-tab close,
		// which is the end of the existing-manager refresh block).
		const fnMatch = src.match(/async function initAgent[\s\S]*?\n\t\t\}/);
		expect(fnMatch).not.toBeNull();
		const body = fnMatch![0];
		// The refresh branch must reload existing runtimes
		expect(body).toContain("runtimeManager.reloadAll()");
		// ...and must NOT dispose them (disposal belongs to stdin-close)
		expect(body).not.toContain("runtimeManager.disposeAll()");
	});
});