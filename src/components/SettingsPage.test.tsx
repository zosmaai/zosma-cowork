import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

vi.mock("./settings/Authentication", () => ({
	Authentication: function MockAuth() {
		return "AUTH_SECTION_MOCK";
	},
}));

vi.mock("./FeedbackDialog", () => ({
	FeedbackDialog: function MockFeedback({ open }: { open: boolean }) {
		return open ? "FEEDBACK_DIALOG_OPEN" : null;
	},
}));

// About uses the update context (Tauri IPC); stub it to a no-op idle state.
vi.mock("@/contexts/UpdateProvider", () => ({
	useUpdate: () => ({
		status: "idle",
		info: null,
		progress: 0,
		policy: null,
		error: null,
		checkNow: vi.fn(),
		installAndRestart: vi.fn(),
		dismiss: vi.fn(),
	}),
}));

beforeAll(() => {
	if (typeof window.matchMedia !== "function") {
		Object.defineProperty(window, "matchMedia", {
			writable: true,
			value: vi.fn().mockImplementation((query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			})),
		});
	}
});

function clickNavButton(name: string | RegExp) {
	const buttons = screen.getAllByRole("button", { name });
	if (buttons.length > 0) {
		fireEvent.click(buttons[0]);
	}
}

describe("SettingsPage", () => {
	it("renders the close button", () => {
		const onClose = vi.fn();
		render(<SettingsPage onClose={onClose} />);
		const buttons = screen.getAllByRole("button", { name: /close/i });
		expect(buttons.length).toBeGreaterThanOrEqual(1);
	});

	it("calls onClose when close button is clicked", () => {
		const onClose = vi.fn();
		render(<SettingsPage onClose={onClose} />);
		fireEvent.click(screen.getAllByRole("button", { name: /close/i })[0]);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("renders only cowork navigation items", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getAllByRole("button", { name: "Authentication" }).length).toBeGreaterThanOrEqual(
			1,
		);
		expect(
			screen.getAllByRole("button", { name: /Custom Instructions/ }).length,
		).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByRole("button", { name: "Appearance" }).length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByRole("button", { name: "Workspace" }).length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByRole("button", { name: "About" }).length).toBeGreaterThanOrEqual(1);

		// Removed sections must not appear
		expect(screen.queryAllByRole("button", { name: "Extensions" }).length).toBe(0);
		expect(screen.queryAllByRole("button", { name: "Skills" }).length).toBe(0);
		expect(screen.queryAllByRole("button", { name: "Apps" }).length).toBe(0);
		expect(screen.queryAllByRole("button", { name: "Remote Access" }).length).toBe(0);
		expect(screen.queryAllByRole("button", { name: "Telemetry" }).length).toBe(0);
	});

	it("shows Authentication content by default", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getAllByText("AUTH_SECTION_MOCK").length).toBeGreaterThanOrEqual(1);
	});

	it("navigates to the Appearance section on click", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		clickNavButton("Appearance");
		expect(screen.getByRole("heading", { name: "Appearance" })).toBeDefined();
	});

	it("renders About section on click", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		clickNavButton("About");
		expect(screen.getByRole("heading", { name: "About" })).toBeDefined();
	});

	it("renders Send Feedback button", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.getAllByText("Send Feedback").length).toBeGreaterThanOrEqual(1);
	});

	it("shows FeedbackDialog when Send Feedback is clicked", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		expect(screen.queryAllByText("FEEDBACK_DIALOG_OPEN").length).toBe(0);
		fireEvent.click(screen.getAllByText("Send Feedback")[0]);
		expect(screen.getAllByText("FEEDBACK_DIALOG_OPEN").length).toBeGreaterThanOrEqual(1);
	});

	it("calls onClose when Escape key is pressed", () => {
		const onClose = vi.fn();
		render(<SettingsPage onClose={onClose} />);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
