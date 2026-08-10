import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Ref } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const controller = vi.hoisted(() => ({
	// biome-ignore lint/suspicious/noExplicitAny: test harness holds loose cached state
	states: new Map<string, any>(),
	// biome-ignore lint/suspicious/noExplicitAny: sidebar disk entries
	entries: [] as Array<any>,
	// biome-ignore lint/suspicious/noExplicitAny: new_session result
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
	setSessionMode: vi.fn(),
	getSessionState: vi.fn(),
}));

function streamState(
	sessionFile: string,
	content: string,
	options: {
		running?: boolean;
		model?: { provider: string; id: string };
		settledVersion?: number;
		mode?: "chat" | "work";
	} = {},
) {
	return {
		sessionFile,
		cwd: `/work/${sessionFile.slice(1, 2)}`,
		model: options.model,
		mode: options.mode ?? "chat",
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

// biome-ignore lint/suspicious/noExplicitAny: empty initial render state
const EMPTY: any = streamState("", "");
EMPTY.messages = [];
EMPTY.sessionFile = null;
EMPTY.cwd = null;
EMPTY.runtimeLoaded = false;

vi.mock("@/hooks/usePiStream", () => ({
	usePiStream: (activeFile: string | null) => ({
		state: activeFile ? (controller.states.get(activeFile) ?? streamState(activeFile, "")) : EMPTY,
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
		setSessionMode: controller.setSessionMode,
		removeSession: controller.removeSession,
	}),
}));

vi.mock("@tauri-apps/api/core", () => ({
	isTauri: () => false,
	invoke: mockInvoke,
}));

vi.mock("@/components/Sidebar", () => ({
	Sidebar: ({
		sessions,
		onSessionSelect,
		onNewSession,
		onDeleteSession,
		collapsed,
		onCollapsedChange,
	}: {
		sessions: Array<{ id: string; title: string; lastMessage: string; runtimeStatus?: string }>;
		onSessionSelect: (id: string) => void;
		onNewSession: () => void;
		onDeleteSession: (id: string) => void;
		collapsed?: boolean;
		onCollapsedChange?: (collapsed: boolean) => void;
	}) => (
		<div>
			<span>{`sidebar:${collapsed ? "collapsed" : "expanded"}`}</span>
			<button type="button" onClick={() => onCollapsedChange?.(false)}>
				expand-sidebar
			</button>
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
	ChatView: ({
		messages,
		currentModelId,
		mode,
		onModeChange,
		onSend,
		onFollowUp,
		onStarterSelect,
		modeChangeDisabled,
		modeError,
		draft,
		taskTitle,
		drawer,
		onDrawerChange,
		sidebarButtonRef,
		panelButtonRef,
	}: {
		messages: Array<{ content: string }>;
		currentModelId?: string;
		mode: "chat" | "work";
		onModeChange: (mode: "chat" | "work") => void;
		onSend: (text: string) => void;
		onFollowUp?: (text: string) => void;
		onStarterSelect: (text: string) => void;
		modeChangeDisabled?: boolean;
		modeError?: string | null;
		draft?: { text: string; nonce: number };
		taskTitle?: string;
		drawer?: null | "sidebar" | "work-panel";
		onDrawerChange?: (drawer: null | "sidebar" | "work-panel") => void;
		sidebarButtonRef?: Ref<HTMLButtonElement>;
		panelButtonRef?: Ref<HTMLButtonElement>;
	}) => (
		<div>
			{modeError && <div>{modeError}</div>}
			<div data-testid="chat-state">
				{messages.map((message) => message.content).join("|")}:{currentModelId}:{mode}
			</div>
			<div data-testid="composer-draft">{draft?.text ?? ""}</div>
			<div data-testid="task-title">{taskTitle}</div>
			<div data-testid="drawer-state">{drawer ?? "closed"}</div>
			<button type="button" disabled={modeChangeDisabled} onClick={() => onModeChange("work")}>
				choose-work
			</button>
			<button type="button" onClick={() => onStarterSelect("Help me write")}>
				choose-starter
			</button>
			<button type="button" onClick={() => onSend("first task")}>
				send-first
			</button>
			<button
				type="button"
				onClick={() => onSend("> quote\n\nStart writing from this excerpt.")}
			>
				idle-start-writing
			</button>
			<button
				type="button"
				onClick={() => onFollowUp?.("> quote\n\nStart writing from this excerpt.")}
			>
				running-start-writing
			</button>
			<button ref={sidebarButtonRef} type="button" onClick={() => onDrawerChange?.("sidebar")}>
				open-sidebar-drawer
			</button>
			<button ref={panelButtonRef} type="button" onClick={() => onDrawerChange?.("work-panel")}>
				open-work-panel
			</button>
			<button type="button" onClick={() => onDrawerChange?.(null)}>
				close-drawer
			</button>
		</div>
	),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
	ConfirmDialog: ({
		open,
		title,
		confirmLabel,
		onConfirm,
	}: {
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
			controller.setSessionMode,
			controller.startStream,
			controller.steerStream,
			controller.followUpStream,
			controller.clearQueue,
			controller.getSessionState,
		]) {
			mock.mockReset();
		}
		controller.getSessionState.mockImplementation((file: string) => controller.states.get(file));
		controller.abortStream.mockResolvedValue(true);
		controller.ensureSession.mockResolvedValue(null);
		// biome-ignore lint/suspicious/noExplicitAny: test harness snapshot is untyped by design
		controller.hydrateSession.mockImplementation((snapshot: any) => {
			controller.states = new Map(controller.states).set(
				snapshot.sessionFile,
				streamState(snapshot.sessionFile, snapshot.messages.at(0)?.content ?? "", {
					model: snapshot.model,
					mode: snapshot.mode ?? "chat",
				}),
			);
		});
		controller.removeSession.mockImplementation((file: string) => {
			controller.states = new Map(controller.states);
			controller.states.delete(file);
		});
		controller.setSessionMode.mockImplementation(async (file: string, mode: "chat" | "work") => {
			const current = controller.states.get(file);
			if (current) controller.states = new Map(controller.states).set(file, { ...current, mode });
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
			[
				"/a.jsonl",
				streamState("/a.jsonl", "A", { model: { provider: "provider-a", id: "model-a" } }),
			],
			[
				"/b.jsonl",
				streamState("/b.jsonl", "B", { model: { provider: "provider-b", id: "model-b" } }),
			],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
			{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		await waitFor(() =>
			expect(screen.getByTestId("chat-state")).toHaveTextContent("provider-a/model-a"),
		);
		fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
		await waitFor(() =>
			expect(screen.getByTestId("chat-state")).toHaveTextContent("provider-b/model-b"),
		);
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
			{
				file: "/a.jsonl",
				title: "A",
				messageCount: 1,
				createdAt: 1,
				lastActivity: 2,
				preview: "A completed result",
			},
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
		controller.states = new Map([["/a.jsonl", streamState("/a.jsonl", "A idle")]]);
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

	it("persists Work before dispatching the first prompt", async () => {
		controller.states = new Map([
			["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "work" }), messages: [] }],
		]);
		controller.entries = [
			{
				file: "/a.jsonl",
				title: "A",
				messageCount: 0,
				createdAt: 1,
				lastActivity: 2,
				mode: "work",
			},
		];
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		fireEvent.click(screen.getByText("send-first"));
		await waitFor(() =>
			expect(controller.startStream).toHaveBeenCalledWith("/a.jsonl", "first task"),
		);
		expect(controller.setSessionMode).toHaveBeenCalledWith("/a.jsonl", "work");
		expect(controller.setSessionMode.mock.invocationCallOrder[0]).toBeLessThan(
			controller.startStream.mock.invocationCallOrder[0],
		);
	});

	it("does not start the first prompt when mode persistence fails", async () => {
		controller.states = new Map([
			["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "work" }), messages: [] }],
		]);
		controller.entries = [
			{
				file: "/a.jsonl",
				title: "A",
				messageCount: 0,
				createdAt: 1,
				lastActivity: 2,
				mode: "work",
			},
		];
		controller.setSessionMode.mockRejectedValueOnce(new Error("metadata unavailable"));
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		fireEvent.click(screen.getByText("send-first"));
		await screen.findByText("Couldn’t save this session’s mode. Try again.");
		expect(controller.startStream).not.toHaveBeenCalled();
	});

	it("defaults legacy active sessions to chat", async () => {
		controller.states = new Map([
			["/legacy.jsonl", streamState("/legacy.jsonl", "history", { mode: "chat" })],
		]);
		controller.entries = [
			{ file: "/legacy.jsonl", title: "Legacy", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		await screen.findByRole("button", { name: "select /legacy.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /legacy.jsonl" }));
		await waitFor(() => expect(screen.getByTestId("chat-state")).toHaveTextContent(":chat"));
	});

	it("carries an unbound Work choice into the canonical session created on send", async () => {
		controller.newSnapshot = {
			sessionFile: "/new.jsonl",
			mode: "chat",
			cwd: "/work/new",
			messages: [],
			isRunning: false,
			status: "idle",
			queue: { steering: [], followUp: [] },
		};
		render(<App />);
		fireEvent.click(screen.getByText("choose-work"));
		fireEvent.click(screen.getByText("send-first"));
		await waitFor(() =>
			expect(controller.startStream).toHaveBeenCalledWith("/new.jsonl", "first task"),
		);
		expect(controller.setSessionMode).toHaveBeenCalledWith("/new.jsonl", "work");
	});

	it("collapses only empty Chat by default and allows one-action expansion", async () => {
		controller.states = new Map([
			["/chat.jsonl", { ...streamState("/chat.jsonl", "", { mode: "chat" }), messages: [] }],
			["/work.jsonl", { ...streamState("/work.jsonl", "", { mode: "work" }), messages: [] }],
		]);
		controller.entries = [
			{
				file: "/chat.jsonl",
				title: "Chat",
				messageCount: 0,
				createdAt: 1,
				lastActivity: 2,
				mode: "chat",
			},
			{
				file: "/work.jsonl",
				title: "Work",
				messageCount: 0,
				createdAt: 1,
				lastActivity: 2,
				mode: "work",
			},
		];
		render(<App />);
		await screen.findByRole("button", { name: "select /chat.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /chat.jsonl" }));
		await screen.findByText("sidebar:collapsed");
		fireEvent.click(screen.getByText("expand-sidebar"));
		expect(screen.getByText("sidebar:expanded")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "select /work.jsonl" }));
		await screen.findByText("sidebar:expanded");
	});

	it("targets starter drafts to one session so they do not bleed on switch", async () => {
		controller.states = new Map([
			["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "chat" }), messages: [] }],
			["/b.jsonl", { ...streamState("/b.jsonl", "", { mode: "chat" }), messages: [] }],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 0, createdAt: 1, lastActivity: 2 },
			{ file: "/b.jsonl", title: "B", messageCount: 0, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		fireEvent.click(screen.getByText("choose-starter"));
		expect(screen.getByTestId("composer-draft")).toHaveTextContent("Help me write");
		fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
		expect(screen.getByTestId("composer-draft")).toBeEmptyDOMElement();
	});

	it("uses the clicked mode when send happens before its reducer rerender", async () => {
		controller.states = new Map([
			["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "chat" }), messages: [] }],
		]);
		controller.entries = [
			{
				file: "/a.jsonl",
				title: "A",
				messageCount: 0,
				createdAt: 1,
				lastActivity: 2,
				mode: "chat",
			},
		];
		let release!: () => void;
		controller.setSessionMode
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						release = resolve;
					}),
			)
			.mockResolvedValueOnce(undefined);
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		fireEvent.click(screen.getByText("choose-work"));
		fireEvent.click(screen.getByText("send-first"));
		expect(controller.setSessionMode.mock.calls.map(([, mode]) => mode)).toEqual(["work", "work"]);
		release();
		await waitFor(() =>
			expect(controller.startStream).toHaveBeenCalledWith("/a.jsonl", "first task"),
		);
	});

	it("re-enables empty mode controls when first stream startup rejects", async () => {
		controller.states = new Map([
			["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "work" }), messages: [] }],
		]);
		controller.entries = [
			{
				file: "/a.jsonl",
				title: "A",
				messageCount: 0,
				createdAt: 1,
				lastActivity: 2,
				mode: "work",
			},
		];
		controller.startStream.mockRejectedValueOnce(new Error("runtime lost"));
		render(<App />);
		await screen.findByRole("button", { name: "select /a.jsonl" });
		fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
		fireEvent.click(screen.getByText("send-first"));
		await screen.findByText("Couldn’t start this session. Try again.");
		expect(screen.getByText("choose-work")).toBeEnabled();
	});

	it("passes the active Work title to the session shell", async () => {
		controller.states = new Map([
			["/w.jsonl", streamState("/w.jsonl", "Result", { mode: "work" })],
		]);
		controller.entries = [
			{
				file: "/w.jsonl",
				title: "Market report",
				messageCount: 2,
				createdAt: 1,
				lastActivity: 2,
				mode: "work",
			},
		];
		render(<App />);
		fireEvent.click(await screen.findByRole("button", { name: "select /w.jsonl" }));
		expect(screen.getByTestId("task-title")).toHaveTextContent("Market report");
	});

	it("uses one mutually exclusive sidebar or Work-panel drawer state", async () => {
		controller.states = new Map([
			["/w.jsonl", streamState("/w.jsonl", "Result", { mode: "work" })],
		]);
		controller.entries = [
			{
				file: "/w.jsonl",
				title: "Work",
				messageCount: 2,
				createdAt: 1,
				lastActivity: 2,
				mode: "work",
			},
		];
		render(<App />);
		fireEvent.click(await screen.findByRole("button", { name: "select /w.jsonl" }));
		fireEvent.click(screen.getByText("open-sidebar-drawer"));
		expect(screen.getByTestId("drawer-state")).toHaveTextContent("sidebar");
		fireEvent.click(screen.getByText("open-work-panel"));
		expect(screen.getByTestId("drawer-state")).toHaveTextContent("work-panel");
	});

	it("closes drawers when switching sessions", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A", { mode: "work" })],
			["/b.jsonl", streamState("/b.jsonl", "B", { mode: "chat" })],
		]);
		controller.entries = [
			{
				file: "/a.jsonl",
				title: "A",
				messageCount: 2,
				createdAt: 1,
				lastActivity: 2,
				mode: "work",
			},
			{
				file: "/b.jsonl",
				title: "B",
				messageCount: 2,
				createdAt: 1,
				lastActivity: 2,
				mode: "chat",
			},
		];
		render(<App />);
		fireEvent.click(await screen.findByRole("button", { name: "select /a.jsonl" }));
		fireEvent.click(screen.getByText("open-work-panel"));
		fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
		expect(screen.getByTestId("drawer-state")).toHaveTextContent("closed");
	});

	it("returns focus to each drawer trigger and labels the mobile sidebar dialog", async () => {
		controller.states = new Map([
			["/w.jsonl", streamState("/w.jsonl", "Result", { mode: "work" })],
		]);
		controller.entries = [
			{
				file: "/w.jsonl",
				title: "Work",
				messageCount: 2,
				createdAt: 1,
				lastActivity: 2,
				mode: "work",
			},
		];
		render(<App />);
		fireEvent.click(await screen.findByRole("button", { name: "select /w.jsonl" }));
		const panelTrigger = screen.getByText("open-work-panel");
		fireEvent.click(panelTrigger);
		fireEvent.click(screen.getByText("close-drawer"));
		await waitFor(() => expect(panelTrigger).toHaveFocus());

		const sidebarTrigger = screen.getByText("open-sidebar-drawer");
		fireEvent.click(sidebarTrigger);
		expect(screen.getByRole("dialog", { name: "Sessions" })).toHaveAttribute("aria-modal", "true");
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => expect(sidebarTrigger).toHaveFocus());
	});

	it("targets idle Start writing to the active session only", async () => {
		controller.states = new Map([
			["/a.jsonl", streamState("/a.jsonl", "A history")],
			["/b.jsonl", streamState("/b.jsonl", "B history")],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
			{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		fireEvent.click(await screen.findByRole("button", { name: "select /b.jsonl" }));
		fireEvent.click(screen.getByText("idle-start-writing"));
		await waitFor(() =>
			expect(controller.startStream).toHaveBeenCalledWith(
				"/b.jsonl",
				"> quote\n\nStart writing from this excerpt.",
			),
		);
		expect(controller.startStream).not.toHaveBeenCalledWith(
			"/a.jsonl",
			expect.anything(),
		);
	});

	it("targets running Start writing to the active session follow-up only", async () => {
		controller.states = new Map([
			[
				"/a.jsonl",
				streamState("/a.jsonl", "A running", { running: true }),
			],
		]);
		controller.entries = [
			{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		];
		render(<App />);
		fireEvent.click(await screen.findByRole("button", { name: "select /a.jsonl" }));
		fireEvent.click(screen.getByText("running-start-writing"));
		expect(controller.followUpStream).toHaveBeenCalledWith(
			"/a.jsonl",
			"> quote\n\nStart writing from this excerpt.",
		);
		expect(controller.startStream).not.toHaveBeenCalled();
	});
});
