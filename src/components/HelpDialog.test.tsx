/**
 * HelpDialog — shows all available slash commands when /help is run.
 */
import { cleanupMocks } from "@/test/mocks";
import type { Command } from "@/types/commands";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpDialog } from "./HelpDialog";

afterEach(() => cleanupMocks());

const COMMANDS: Command[] = [
	{
		id: "session.new",
		name: "new",
		aliases: ["new-session"],
		description: "Start a new session",
		category: "session",
	},
	{
		id: "session.resume",
		name: "resume",
		aliases: ["sessions", "history"],
		description: "Open previous sessions",
		category: "session",
	},
	{
		id: "model.switch",
		name: "model",
		description: "Switch the model",
		category: "model",
		argHint: "model-id",
	},
	{
		id: "view.settings",
		name: "settings",
		aliases: ["config"],
		description: "Open settings",
		category: "view",
	},
	{
		id: "help.list",
		name: "help",
		aliases: ["?"],
		description: "List available commands",
		category: "view",
	},
];

describe("HelpDialog", () => {
	it("renders nothing when open={false}", () => {
		render(<HelpDialog open={false} commands={COMMANDS} onClose={vi.fn()} />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("renders a dialog when open={true}", () => {
		render(<HelpDialog open commands={COMMANDS} onClose={vi.fn()} />);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});

	it("shows every command name", () => {
		render(<HelpDialog open commands={COMMANDS} onClose={vi.fn()} />);
		for (const cmd of COMMANDS) {
			// exact match on the name span (aliases share the same prefix so we anchor)
			expect(screen.getByText(`/${cmd.name}`, { exact: true })).toBeInTheDocument();
		}
	});

	it("shows each command's description", () => {
		render(<HelpDialog open commands={COMMANDS} onClose={vi.fn()} />);
		expect(screen.getByText(/start a new session/i)).toBeInTheDocument();
		expect(screen.getByText(/switch the model/i)).toBeInTheDocument();
	});

	it("shows aliases next to their command", () => {
		render(<HelpDialog open commands={COMMANDS} onClose={vi.fn()} />);
		// aliases are rendered with a leading / so they're unambiguous
		expect(screen.getByText(/\/new-session/i)).toBeInTheDocument();
		expect(screen.getByText(/\/sessions/i)).toBeInTheDocument();
		expect(screen.getByText(/\/history/i)).toBeInTheDocument();
	});

	it("shows the argHint when present", () => {
		render(<HelpDialog open commands={COMMANDS} onClose={vi.fn()} />);
		expect(screen.getByText(/model-id/i)).toBeInTheDocument();
	});

	it("groups commands under category section headers", () => {
		render(<HelpDialog open commands={COMMANDS} onClose={vi.fn()} />);
		const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
		expect(headings.some((h) => /session/i.test(h))).toBe(true);
		expect(headings.some((h) => /model/i.test(h))).toBe(true);
		expect(headings.some((h) => /view/i.test(h))).toBe(true);
	});

	it("calls onClose when the close button is clicked", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(<HelpDialog open commands={COMMANDS} onClose={onClose} />);
		await user.click(screen.getByRole("button", { name: /close/i }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose when Escape is pressed", async () => {
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(<HelpDialog open commands={COMMANDS} onClose={onClose} />);
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
