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

	it("wraps selection with ArrowUp from the first item to the last", async () => {
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={onRunCommand} />);
		await user.type(screen.getByRole("textbox"), "/");
		await user.keyboard("{ArrowUp}"); // index 0 -> wraps to last (settings)
		await user.keyboard("{Enter}");
		expect(onRunCommand.mock.calls[0][0].id).toBe("view.settings");
	});

	it("clamps the selection when the filtered list shrinks", async () => {
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={onRunCommand} />);
		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "/");
		await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}"); // select last (settings, idx 3)
		await user.type(textarea, "res"); // narrows to [resume], idx must clamp 3 -> 0
		await user.keyboard("{Enter}");
		expect(onRunCommand.mock.calls[0][0].id).toBe("session.resume");
	});

	it("shows an empty state when nothing matches but keeps the palette open", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/zzzz");
		expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
		expect(screen.getByText("No matching commands")).toBeInTheDocument();
		expect(screen.queryByRole("option")).not.toBeInTheDocument();
	});

	it("groups results under category section headers", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/");
		expect(screen.getByRole("group", { name: "Session" })).toBeInTheDocument();
		expect(screen.getByRole("group", { name: "Model" })).toBeInTheDocument();
		expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
		// Categories with no matching command are not rendered.
		expect(screen.queryByRole("group", { name: "Skills" })).not.toBeInTheDocument();
	});

	it("shows the argHint pill on the selected command", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/model"); // only model matches, auto-selected
		expect(screen.getByText("model-id")).toBeInTheDocument();
	});

	it("selects a row on hover, then runs it on Enter", async () => {
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={onRunCommand} />);
		await user.type(screen.getByRole("textbox"), "/");
		await user.hover(screen.getByRole("option", { name: /settings/ }));
		await user.keyboard("{Enter}");
		expect(onRunCommand.mock.calls[0][0].id).toBe("view.settings");
	});

	it("closes the palette when backspacing past the leading /", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "/n");
		expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
		await user.type(textarea, "{Backspace}{Backspace}"); // delete "n" then "/"
		expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
	});

	it("highlights the matched characters in the command name", async () => {
		const user = userEvent.setup();
		// Palette renders in a portal on document.body, so query the document.
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/set");
		const marks = Array.from(document.querySelectorAll("mark")).map((m) => m.textContent);
		expect(marks.join("")).toBe("set");
		// Accessible name is unaffected by the highlight spans.
		expect(screen.getByRole("option", { name: /settings/ })).toBeInTheDocument();
	});

	it("shows the keyboard-hint footer", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} commands={COMMANDS} onRunCommand={vi.fn()} />);
		await user.type(screen.getByRole("textbox"), "/");
		expect(screen.getByText("navigate")).toBeInTheDocument();
		expect(screen.getByText("dismiss")).toBeInTheDocument();
	});

	it("does not run or send on Shift+Enter while the palette is open", async () => {
		const onSend = vi.fn();
		const onRunCommand = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={onSend} commands={COMMANDS} onRunCommand={onRunCommand} />);
		await user.type(screen.getByRole("textbox"), "/new");
		await user.keyboard("{Shift>}{Enter}{/Shift}");
		expect(onRunCommand).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
	});
});
