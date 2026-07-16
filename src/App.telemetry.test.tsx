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
			queue: [],
			isStreaming: false,
			model: undefined,
		},
		startStream: vi.fn(),
		abortStream: vi.fn(),
		steerStream: vi.fn(),
		followUpStream: vi.fn(),
		clearQueue: vi.fn(),
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
	HomeView: () => <div data-testid="home" />,
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
});
