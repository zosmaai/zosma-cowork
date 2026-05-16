import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsPanel } from "./SkillsPanel";

// Mock Tauri invoke
const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("SkillsPanel", () => {
	beforeEach(() => {
		mockInvoke.mockReset();
		// Default: no installed skills
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "list_skills") return Promise.resolve([]);
			if (cmd === "search_skills") return Promise.resolve({ results: [] });
			if (cmd === "install_skill") return Promise.resolve({ success: true });
			if (cmd === "remove_skill") return Promise.resolve({ success: true });
			return Promise.resolve(null);
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("renders the search input", () => {
		render(<SkillsPanel />);
		expect(screen.getByPlaceholderText("Search skills by name or keyword...")).toBeDefined();
	});

	it("renders Installed Skills section", () => {
		render(<SkillsPanel />);
		expect(screen.getByText("Installed Skills")).toBeDefined();
	});

	it("shows empty state when no installed skills", () => {
		render(<SkillsPanel />);
		expect(screen.getByText("No skills installed yet")).toBeDefined();
	});

	it("calls search_skills IPC with debounced query", async () => {
		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills by name or keyword...");
		fireEvent.change(input, { target: { value: "typescript" } });

		// Should show searching state
		await waitFor(() => {
			expect(screen.getByText("Search results")).toBeDefined();
		});

		// Wait for debounce and verify IPC was called
		await waitFor(
			() => {
				expect(mockInvoke).toHaveBeenCalledWith("search_skills", {
					query: "typescript",
				});
			},
			{ timeout: 1000 },
		);
	});

	it("displays search results with ExtensionCards", async () => {
		mockInvoke.mockImplementation((cmd: string, _args?: Record<string, unknown>) => {
			if (cmd === "list_skills") return Promise.resolve([]);
			if (cmd === "search_skills") {
				return Promise.resolve({
					results: [
						{
							id: "wshobson/agents@typescript-advanced-types",
							installCount: 41200,
							url: "https://skills.sh/wshobson/agents/typescript-advanced-types",
							npmData: null,
						},
						{
							id: "github/awesome-copilot@jest-typescript",
							installCount: 10500,
							url: "https://skills.sh/github/awesome-copilot/jest-typescript",
							npmData: null,
						},
					],
				});
			}
			return Promise.resolve(null);
		});

		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills by name or keyword...");
		fireEvent.change(input, { target: { value: "typescript" } });

		await waitFor(() => {
			expect(screen.getByText("wshobson/agents@typescript-advanced-types")).toBeDefined();
		});
		expect(screen.getByText("41.2K")).toBeDefined();
		expect(screen.getByText("10.5K")).toBeDefined();
	});

	it("displays installed skills with Remove button", async () => {
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "list_skills") {
				return Promise.resolve([
					{
						name: "find-skills",
						path: "/home/user/.agents/skills/find-skills",
						scope: "project",
						agents: ["Codex"],
					},
				]);
			}
			return Promise.resolve(null);
		});

		render(<SkillsPanel />);

		await waitFor(() => {
			expect(screen.getByText("find-skills")).toBeDefined();
		});

		// Should show Remove button for installed skills
		const removeButtons = screen.getAllByTitle("Remove skill");
		expect(removeButtons.length).toBeGreaterThan(0);
	});

	it("calls install_skill IPC when Install button clicked", async () => {
		mockInvoke.mockImplementation((cmd: string, _args?: Record<string, unknown>) => {
			if (cmd === "list_skills") return Promise.resolve([]);
			if (cmd === "search_skills") {
				return Promise.resolve({
					results: [{ id: "test/skill@my-skill", installCount: 100, url: "", npmData: null }],
				});
			}
			if (cmd === "install_skill") return Promise.resolve({ success: true });
			return Promise.resolve(null);
		});

		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills by name or keyword...");
		fireEvent.change(input, { target: { value: "test" } });

		await waitFor(() => {
			expect(screen.getByText("test/skill@my-skill")).toBeDefined();
		});

		const installButtons = screen.getAllByTitle("Install skill");
		fireEvent.click(installButtons[0]);

		expect(mockInvoke).toHaveBeenCalledWith("install_skill", {
			source: "test/skill@my-skill",
		});
	});

	it("opens ExtensionDetail modal when card is clicked", async () => {
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "list_skills") return Promise.resolve([]);
			if (cmd === "search_skills") {
				return Promise.resolve({
					results: [
						{
							id: "test/pkg",
							installCount: 100,
							url: "https://skills.sh/test/pkg",
							npmData: null,
						},
					],
				});
			}
			return Promise.resolve(null);
		});

		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills by name or keyword...");
		fireEvent.change(input, { target: { value: "test" } });

		await waitFor(() => {
			expect(screen.getByText("test/pkg")).toBeDefined();
		});

		// Click the card (it's a button with the skill ID)
		const card = screen.getByText("test/pkg").closest("button") || screen.getByText("test/pkg");
		fireEvent.click(card);

		// Detail modal should appear
		await waitFor(() => {
			expect(screen.getByText("Loading details...")).toBeDefined();
		});
	});

	it("shows empty results message when search returns nothing", async () => {
		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills by name or keyword...");
		fireEvent.change(input, { target: { value: "zzznotexist" } });

		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("search_skills", {
				query: "zzznotexist",
			});
		});

		await waitFor(() => {
			expect(screen.getByText(/No skills found for/)).toBeDefined();
		});
	});

	it("shows skill count in search results header", async () => {
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "list_skills") return Promise.resolve([]);
			if (cmd === "search_skills") {
				return Promise.resolve({
					results: [
						{ id: "a/b@c", installCount: 1, url: "", npmData: null },
						{ id: "d/e@f", installCount: 2, url: "", npmData: null },
					],
				});
			}
			return Promise.resolve(null);
		});

		render(<SkillsPanel />);
		const input = screen.getByPlaceholderText("Search skills by name or keyword...");
		fireEvent.change(input, { target: { value: "test" } });

		await waitFor(() => {
			expect(screen.getByText("2 skills")).toBeDefined();
		});
	});
});
