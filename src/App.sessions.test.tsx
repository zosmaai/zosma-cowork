import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const controller = vi.hoisted(() => ({
	states: new Map<string, any>(),
	entries: [] as Array<any>,
	newSnapshot: null as any,
	ensureSession: vi.fn(),
	abortStream: vi.fn(),
	hydrateSession: vi.fn(),
	removeSession: vi.fn(),
	setSessionModel: vi.fn(),
	startStream: vi.fn(),
	steerStream: vi.fn(),
	followUpStream: vi.fn(),
	clearQueue: vi.fn(),
	dispatch: vi.fn(),
	getSessionState: vi.fn(),
}));

function streamState(
	sessionFile: string,
	content: string,
	options: {
		running?: boolean;
		model?: { provider: string; id: string };
		settledVersion?: number;
	} = {},
) {
	return {
		sessionFile,
		cwd: `/work/${sessionFile.slice(1, 2)}`,
		model: options.model,
		runtimeLoaded: true,
		loadStatus: "loaded",
		messages: [{ id: content, role: "assistant", content, timestamp: 1 }],
		streamingMessage: null,
		isRunning: options.running ?? false,
		status: options.running ? "responding" : "idle",
		error: null,
		sessionError: null,
		queue: { steering: [], followUp: [] },
		streamSegments: [],
		queuedKinds: {},
		promptEchoConsumed: false,
		awaitingDone: options.running ?? false,
		settledVersion: options.settledVersion ?? 0,
	};
}

const EMPTY: any = streamState("", "");
EMPTY.messages = [];
EMPTY.sessionFile = null;
EMPTY.cwd = null;
EMPTY.runtimeLoaded = false;

vi.mock("@/hooks/usePiStream", () => ({
	usePiStream: (activeFile: string | null) => ({
		state: activeFile ? controller.states.get(activeFile) ?? streamState(activeFile, "") : EMPTY,
		states: controller.states,
		getSessionState: controller.getSessionState,
		hydrateSession: controller.hydrateSession,
		ensureSession: controller.ensureSession,
		startStream: controller.startStream,
		abortStream: controller.abortStream,
		steerStream: controller.steerStream,
		followUpStream: controller.followUpStream,
		clearQueue: controller.clearQueue,
		setSessionModel: controller.setSessionModel,
		removeSession: controller.removeSession,
		dispatch: controller.dispatch,
	}),
}));

vi.mock("@tauri-apps/api/core", () => ({
	isTauri: () => false,
	invoke: mockInvoke,
}));

vi.mock("@/components/Sidebar", () => ({
	Sidebar: ({ sessions, onSessionSelect, onNewSession, onDeleteSession }: {
		sessions: Array<{ id: string; title: string; lastMessage: string; runtimeStatus?: string }>;
		onSessionSelect: (id: string) => void;
		onNewSession: () => void;
		onDeleteSession: (id: string) => void;
	}) => (
		<div>
			{sessions.map((session) => (
				<div key={session.id}>
					<button
						type="button"
						aria-label={`select ${session.id}`}
						onClick={() => onSessionSelect(session.id)}
					>
						{session.title}:{session.runtimeStatus}:{session.lastMessage}
					</button>
					<button
						type="button"
						aria-label={`delete ${session.id}`}
						onClick={() => onDeleteSession(session.id)}
					>
						delete
					</button>
				</div>
			))}
			<button type="button" onClick={onNewSession}>
				new-session
			</button>
		</div>
	),
}));

vi.mock("@/chat/ChatView", () => ({
	ChatView: ({ messages, currentModelId }: {
		messages: Array<{ content: string }>;
		currentModelId?: string;
	}) => (
		<div data-testid="chat-state">
			{messages.map((message) => message.content).join("|")}:{currentModelId}
		</div>
	),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
	ConfirmDialog: ({ open, title, confirmLabel, onConfirm }: {
		open: boolean;
		title: string;
		confirmLabel: string;
		onConfirm: () => void;
	}) =>
		open ? (
			<div>
				<span>{title}</span>
				<button type="button" onClick={onConfirm}>
					{confirmLabel}
				</button>
			</div>
		) : null,
}));

// ── Static startup mocks (identical to App.telemetry.test.tsx) ──

vi.mock("@/hooks/useTelemetry", () => ({
	useTelemetry: vi.fn(),
}));

vi.mock("@/contexts/UpdateProvider", () => ({
	useUpdate: () => ({
		isUpdateAvailable: false,
		isChecking: false,
		check: vi.fn(),
		install: vi.fn(),
		progress: 0,
		bannerDismissed: false,
		dismissBanner: vi.fn(),
		reset: vi.fn(),
	}),
}));

vi.mock("@/hooks/useProviders", () => ({
	useProviders: () => ({
		models: [
			{
				id: "model-a",
				name: "Model A",
				provider: "provider-a",
				reasoning: false,
				contextWindow: 128000,
				maxTokens: 8192,
				input: ["text"],
			},
			{
				id: "model-b",
				name: "Model B",
				provider: "provider-b",
				reasoning: false,
				contextWindow: 128000,
				maxTokens: 8192,
				input: ["text"],
			},
		],
	}),
}));

vi.mock("@/hooks/useAuth", () => ({
	useAuth: () => ({
		hasCredentials: false,
		loading: false,
		saveApiKey: vi.fn(),
		checkAuth: vi.fn(),
	}),
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({
	useOnboardingStatus: () => ({
		status: { hasExistingSetup: true, zosmaConnected: true },
		loading: false,
		refresh: vi.fn(),
	}),
}));

vi.mock("@/components/SplashScreen", () => ({
	SplashScreen: () => <div data-testid="splash" />,
}));

vi.mock("@/components/HomeView", () => ({
	HomeView: () => <div data-testid="zosma-connect" />,
}));

vi.mock("@/components/ZosmaRouterAnnouncement", () => ({
	ZosmaRouterAnnouncement: () => <div data-testid="zosma-announcement" />,
}));

vi.mock("@/components/SettingsPage", () => ({
	SettingsPage: () => <div data-testid="settings" />,
}));

vi.mock("@/components/HelpDialog", () => ({
	HelpDialog: () => <div data-testid="help" />,
}));

vi.mock("@/components/UpdateBanner", () => ({
	UpdateBanner: () => <div data-testid="update-banner" />,
}));

vi.mock("@/components/ui/rename-dialog", () => ({
	RenameDialog: () => <div data-testid="rename" />,
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
}));

import App from "./App";

describe("App cached session switching", () => {
	beforeEach(() => {
		controller.states = new Map();
		controller.entries = [];
		controller.newSnapshot = null;
		for (const mock of [
			controller.ensureSession,
			controller.abortStream,
			controller.hydrateSession,
			controller.removeSession,
			controller.setSessionModel,
			controller.startStream,
			controller.steerStream,
			controller.followUpStream,
			controller.clearQueue,
			controller.dispatch,
			controller.getSessionState,
		]) {
			mock.mockReset();
		}
		controller.getSessionState.mockImplementation((file: string) => controller.states.get(file));
		controller.abortStream.mockResolvedValue(true);
		controller.ensureSession.mockResolvedValue(null);
		controller.hydrateSession.mockImplementation((snapshot: any) => {
			controller.states = new Map(controller.states).set(
				snapshot.sessionFile,
				streamState(snapshot.sessionFile, snapshot.messages.at(0)?.content ?? "", {
					model: snapshot.model,
				}),
			);
		});
		controller.removeSession.mockImplementation((file: string) => {
			controller.states = new Map(controller.states);
			controller.states.delete(file);
		});
		mockInvoke.mockReset().mockImplementation((command: string) => {
			if (command === "list_sessions") return Promise.resolve({ sessions: controller.entries });
			if (command === "new_session") return Promise.resolve(controller.newSnapshot);
			if (command === "get_settings") return Promise.resolve({});
			if (command === "get_auth_status") return Promise.resolve({ providers: [] });
			return Promise.resolve(null);
		});
	});

	it("switches to a cached session without aborting or loading", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A history", { running: true })],
			["/b.jsonl", streamState("/b.jsonl", "B history")],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
			{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		controller.ensureSession.mockClear();
		controller.abortStream.mockClear();
		fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
		await waitFor(() => expect(screen.getByTestId("chat-state")).toHaveTextContent("B history"));
		expect(controller.ensureSession).not.toHaveBeenCalled();
		expect(controller.abortStream).not.toHaveBeenCalled();
		expect(mockInvoke).not.toHaveBeenCalledWith("load_session", expect.anything());
	});

	it("starts one cold load without stopping a running visible session", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A live", { running: true })],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
			{ file: "/c.jsonl", title: "C", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		controller.abortStream.mockClear();
		fireEvent.click(screen.getByRole("button", { name: "select /c.jsonl" }));
		fireEvent.click(screen.getByRole("button", { name: "select /c.jsonl" }));
		expect(controller.ensureSession).toHaveBeenCalledTimes(1);
		expect(controller.ensureSession).toHaveBeenCalledWith("/c.jsonl");
		expect(controller.abortStream).not.toHaveBeenCalled();
	});

	it("keeps each cached session model visible when switching", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A", { model: { provider: "provider-a", id: "model-a" } })],
			["/b.jsonl", streamState("/b.jsonl", "B", { model: { provider: "provider-b", id: "model-b" } })],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
			{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		await waitFor(() => expect(screen.getByTestId("chat-state")).toHaveTextContent("provider-a/model-a"));
		fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
		await waitFor(() => expect(screen.getByTestId("chat-state")).toHaveTextContent("provider-b/model-b"));
	});

	it("creates a new session without aborting the previous running session", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A live", { running: true })],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		controller.newSnapshot = {
			sessionFile: "/b.jsonl",
			mode: "chat",
			cwd: "/work/b",
			messages: [],
			isRunning: false,
			status: "idle",
			queue: { steering: [], followUp: [] },
		};
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		controller.abortStream.mockClear();
		fireEvent.click(screen.getByText("new-session"));
		await waitFor(() =>
			expect(controller.hydrateSession).toHaveBeenCalledWith(controller.newSnapshot),
		);
		expect(controller.abortStream).not.toHaveBeenCalled();
	});

	it("updates a hidden session row when it completes", async () => {
		const runningA = streamState("/a.jsonl", "A started", { running: true });
		const idleB = streamState("/b.jsonl", "B history");
		controller.states = new Map([
			["/a.jsonl", runningA],
			["/b.jsonl", idleB],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
			{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		const view = render(<App />);
		await screen.findByRole("button", { name: "select /b.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "select /a.jsonl" })).toHaveTextContent("running"),
		);

		// A completed and persisted while hidden: live cache + disk both reflect it.
		const completedA = streamState("/a.jsonl", "A completed result", { settledVersion: 1 });
		controller.states = new Map([
			["/a.jsonl", completedA],
			["/b.jsonl", idleB],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2, preview: "A completed result" },
			{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		view.rerender(<App />);

		await waitFor(() => {
			const row = screen.getByRole("button", { name: "select /a.jsonl" });
			expect(row).toHaveTextContent("idle");
			expect(row).toHaveTextContent("A completed result");
		});
		expect(screen.getByTestId("chat-state")).toHaveTextContent("B history");
	});

	it("stops a running session before deleting it", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A live", { running: true })],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		await screen.findByRole("button", { name: "delete /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "delete /a.jsonl" }));
		expect(screen.getByText("Stop and delete chat?")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Stop and delete" }));
		await waitFor(() =>
			expect(mockInvoke).toHaveBeenCalledWith("delete_session", {
				sessionFile: "/a.jsonl",
			}),
		);
		const deleteIndex = mockInvoke.mock.calls.findIndex(
			([command]) => command === "delete_session",
		);
		expect(controller.abortStream.mock.invocationCallOrder[0]).toBeLessThan(
			mockInvoke.mock.invocationCallOrder[deleteIndex],
		);
		expect(controller.removeSession).toHaveBeenCalledWith("/a.jsonl");
	});

	it("does not delete when stopping the running session fails", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A live", { running: true })],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		controller.abortStream.mockResolvedValue(false);
		render(<App />);
		await screen.findByRole("button", { name: "delete /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "delete /a.jsonl" }));
		fireEvent.click(screen.getByRole("button", { name: "Stop and delete" }));
		await waitFor(() => expect(controller.abortStream).toHaveBeenCalledWith("/a.jsonl"));
		expect(mockInvoke.mock.calls.some(([command]) => command === "delete_session")).toBe(false);
		expect(controller.removeSession).not.toHaveBeenCalled();
	});

	it("deletes an idle session without sending abort", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A idle")],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		await screen.findByRole("button", { name: "delete /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "delete /a.jsonl" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() =>
			expect(mockInvoke).toHaveBeenCalledWith("delete_session", {
				sessionFile: "/a.jsonl",
			}),
		);
		expect(controller.abortStream).not.toHaveBeenCalled();
	});
});