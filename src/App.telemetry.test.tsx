import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseTelemetry = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useTelemetry", () => ({
	useTelemetry: mockUseTelemetry,
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: mockInvoke,
	isTauri: () => false,
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

vi.mock("@/hooks/usePiStream", () => ({
	usePiStream: () => ({
		state: {
			messages: [],
			streamingMessage: null,
			isRunning: false,
			status: "idle",
			error: null,
			sessionError: null,
			queue: { steering: [], followUp: [] },
			cwd: null,
			model: undefined,
			runtimeLoaded: false,
			loadStatus: "loaded",
			awaitingDone: false,
			settledVersion: 0,
		},
		states: new Map(),
		getSessionState: vi.fn(),
		hydrateSession: vi.fn(),
		ensureSession: vi.fn(),
		startStream: vi.fn(),
		abortStream: vi.fn(),
		steerStream: vi.fn(),
		followUpStream: vi.fn(),
		clearQueue: vi.fn(),
		setSessionModel: vi.fn(),
		removeSession: vi.fn(),
		dispatch: vi.fn(),
	}),
}));

vi.mock("@/hooks/useProviders", () => ({
	useProviders: () => ({ models: [] }),
}));

vi.mock("@/hooks/useAuth", () => ({
	useAuth: () => ({
		hasCredentials: false,
		loading: false,
		saveApiKey: vi.fn(),
		checkAuth: vi.fn(),
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

vi.mock("@/components/Sidebar", () => ({
	Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("@/chat/ChatView", () => ({
	ChatView: () => <div data-testid="chat" />,
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

vi.mock("@/components/ui/confirm-dialog", () => ({
	ConfirmDialog: () => <div data-testid="confirm" />,
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

describe("App telemetry integration", () => {
	beforeEach(() => {
		mockInvoke.mockImplementation((cmd) => {
			if (cmd === "get_settings") return Promise.resolve({ telemetry: { enabled: true } });
			if (cmd === "list_sessions") return Promise.resolve({ sessions: [] });
			if (cmd === "get_onboarding_status")
				return Promise.resolve({ hasExistingSetup: false, zosmaConnected: false });
			return Promise.resolve(null);
		});
	});

	afterEach(() => {
		mockInvoke.mockClear();
		mockUseTelemetry.mockClear();
	});

	it("initializes telemetry on mount", () => {
		render(<App />);
		expect(mockUseTelemetry).toHaveBeenCalledTimes(1);
	});

	it("shows Zosma-first connect screen when no existing setup exists", async () => {
		const { getByTestId, queryByTestId } = render(<App />);
		await new Promise((r) => setTimeout(r, 50));
		expect(getByTestId("zosma-connect")).toBeInTheDocument();
		expect(queryByTestId("chat")).not.toBeInTheDocument();
	});
});
