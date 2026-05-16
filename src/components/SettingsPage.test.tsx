import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";

// Mock child components that make Tauri IPC calls to avoid unhandled rejections
vi.mock("./ExtensionPanel", () => ({
	ExtensionPanel: function MockExt() {
		return null;
	},
}));

vi.mock("./SkillsPanel", () => ({
	SkillsPanel: function MockSkills() {
		return null;
	},
}));

vi.mock("./ProviderAuthSection", () => ({
	ProviderAuthSection: function MockAuth() {
		return "AUTH_SECTION_MOCK";
	},
}));

vi.mock("./CustomInstructions", () => ({
	CustomInstructions: function MockInstructions() {
		return "INSTRUCTIONS_MOCK";
	},
}));

vi.mock("./FeedbackDialog", () => ({
	FeedbackDialog: function MockFeedback({ open }: { open: boolean }) {
		return open ? "FEEDBACK_DIALOG_OPEN" : null;
	},
}));

// Polyfill window.matchMedia for jsdom (needed by getSavedTheme)
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

// In jsdom, CSS media queries aren't evaluated, so both desktop (hidden md:flex)
// and mobile (md:hidden) layouts render simultaneously. For nav button clicks,
// we target the first match which is the desktop sidebar nav button (DOM order).
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

	it("renders all navigation section items", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		// Desktop sidebar nav buttons - they'll have duplicates from mobile bar,
		// but at least one instance of each must exist
		expect(screen.getAllByRole("button", { name: "Authentication" }).length).toBeGreaterThanOrEqual(
			1,
		);
		expect(screen.getAllByRole("button", { name: "Extensions" }).length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByRole("button", { name: "Skills" }).length).toBeGreaterThanOrEqual(1);
		expect(
			screen.getAllByRole("button", { name: /Custom Instructions/ }).length,
		).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByRole("button", { name: "Theme" }).length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByRole("button", { name: "Telemetry" }).length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByRole("button", { name: "About" }).length).toBeGreaterThanOrEqual(1);
	});

	it("shows Authentication content by default", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		// Default section is Authentication — its content should render (3 provider rows)
		expect(screen.getAllByText("AUTH_SECTION_MOCK").length).toBeGreaterThanOrEqual(1);
	});

	it("navigates to Extensions section on click", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		clickNavButton("Extensions");
		expect(screen.getByRole("heading", { name: "Extensions" })).toBeDefined();
	});

	it("navigates to Theme section on click", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		clickNavButton("Theme");
		expect(screen.getByRole("heading", { name: "Theme" })).toBeDefined();
	});

	it("navigates to Custom Instructions section on click", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		clickNavButton(/Custom Instructions/);
		expect(screen.getAllByText("INSTRUCTIONS_MOCK").length).toBeGreaterThanOrEqual(1);
	});

	it("navigates to Skills section on click", () => {
		render(<SettingsPage onClose={vi.fn()} />);
		clickNavButton("Skills");
		expect(screen.getByRole("heading", { name: "Skills" })).toBeDefined();
	});

	it("renders Telemetry content when telemetry props provided", () => {
		render(
			<SettingsPage
				onClose={vi.fn()}
				telemetryEnabled={false}
				onTelemetryToggle={vi.fn()}
			/>,
		);
		clickNavButton("Telemetry");
		expect(screen.getByRole("heading", { name: "Telemetry" })).toBeDefined();
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
