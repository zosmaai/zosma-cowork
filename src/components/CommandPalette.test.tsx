import { cleanupMocks } from "@/test/mocks";
import type { Command } from "@/types/commands";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageInput, parseSlashInput } from "./MessageInput";

const COMMANDS: Command[] = [
	{
		id: "session.new",
		name: "new",
		aliases: ["clear"],
		description: "Start a new session",
		category: "session",
	},
	{ id: "session.resume", name: "resume", description: "Resume a session", category: "session" },
	{
		id: "model.switch",
		name: "model",
		description: "Switch the model",
		category: "model",
		argHint: "model-id",
	},
	{ id: "view.settings", name: "settings", description: "Open settings", category: "view" },
];

describe("parseSlashInput", () => {
	it("returns null for non-slash input", () => {
		expect(parseSlashInput("hello")).toBeNull();
		expect(parseSlashInput("")).toBeNull();
	});

	it("parses a bare command name", () => {
		expect(parseSlashInput("/new")).toEqual({ query: "new", args: "" });
	});

	it("splits command name from args at the first space", () => {
		expect(parseSlashInput("/model gpt-4o latest")).toEqual({
			query: "model",
			args: "gpt-4o latest",
		});
	});

	it("only treats the first line as the command line", () => {
		expect(parseSlashInput("/new\nsecond line")).toEqual({ query: "new", args: "" });
	});
});

describe("MessageInput slash-command palette", () => {
	afterEach(() => cleanupMocks());

	it("does not open the palette for normal text", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "hello");
		expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
	});

	it("opens the palette when input starts with /", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/");
		expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
		expect(screen.getByRole("option", { name: /new/ })).toBeInTheDocument();
	});

	it("filters commands by the typed query", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/mod");
		expect(screen.getByRole("option", { name: /model/ })).toBeInTheDocument();
		expect(screen.queryByRole("option", { name: /settings/ })).not.toBeInTheDocument();
	});

	it("runs the selected command on Enter instead of sending", async () => {
		const onSend = vi.fn();
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={onSend} commands={COMMANDS} onRunCommand={onRunCommand} />);
		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "/resume");
		await user.keyboard("{Enter}");
		expect(onRunCommand).toHaveBeenCalledTimes(1);
		expect(onRunCommand.mock.calls[0][0].id).toBe("session.resume");
		expect(onSend).not.toHaveBeenCalled();
	});

	it("passes trailing args through to onRunCommand", async () => {
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={onRunCommand} />);
		await user.type(screen.getByRole("textbox"), "/model gpt-4o");
		await user.keyboard("{Enter}");
		expect(onRunCommand).toHaveBeenCalledWith(
			expect.objectContaining({ id: "model.switch" }),
			"gpt-4o",
		);
	});

	it("moves selection with ArrowDown and runs the new selection", async () => {
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={onRunCommand} />);
		await user.type(screen.getByRole("textbox"), "/");
		await user.keyboard("{ArrowDown}"); // new -> resume
		await user.keyboard("{Enter}");
		expect(onRunCommand.mock.calls[0][0].id).toBe("session.resume");
	});

	it("dismisses the palette on Escape", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/new");
		expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
	});

	it("completes the command name on Tab without running it", async () => {
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={onRunCommand} />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		await user.type(textarea, "/res");
		await user.keyboard("{Tab}");
		expect(textarea.value).toBe("/resume ");
		expect(onRunCommand).not.toHaveBeenCalled();
	});

	it("runs a command on click", async () => {
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={onRunCommand} />);
		await user.type(screen.getByRole("textbox"), "/set");
		await user.click(screen.getByRole("option", { name: /settings/ }));
		expect(onRunCommand.mock.calls[0][0].id).toBe("view.settings");
	});

	it("stays closed when no commands are provided", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/new");
		expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
	});
});
