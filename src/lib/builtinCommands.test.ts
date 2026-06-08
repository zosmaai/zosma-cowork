import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./builtinCommands";
import { BUILTIN_COMMANDS, findBuiltinCommand, runBuiltinCommand } from "./builtinCommands";

/** Resolve a command for dispatch tests, failing loudly if the name is wrong. */
function cmd(name: string) {
	const found = findBuiltinCommand(name);
	if (!found) throw new Error(`no builtin command for "${name}"`);
	return found;
}

function mockCtx(): CommandContext {
	return {
		newSession: vi.fn(),
		openSessions: vi.fn(),
		openModelSelector: vi.fn(),
		setModel: vi.fn(),
		openSettings: vi.fn(),
		showHelp: vi.fn(),
	};
}

describe("BUILTIN_COMMANDS registry", () => {
	it("exposes the clean-subset commands", () => {
		const ids = BUILTIN_COMMANDS.map((c) => c.id).sort();
		expect(ids).toEqual(
			["session.new", "session.resume", "model.switch", "view.settings", "help.list"].sort(),
		);
	});

	it("every command is a valid palette Command (name + description + category)", () => {
		for (const cmd of BUILTIN_COMMANDS) {
			expect(cmd.name).toBeTruthy();
			expect(cmd.description).toBeTruthy();
			expect(cmd.category).toBeTruthy();
			expect(typeof cmd.run).toBe("function");
		}
	});

	it("declares the documented aliases", () => {
		expect(findBuiltinCommand("new-session")?.id).toBe("session.new");
		expect(findBuiltinCommand("sessions")?.id).toBe("session.resume");
		expect(findBuiltinCommand("history")?.id).toBe("session.resume");
		expect(findBuiltinCommand("config")?.id).toBe("view.settings");
		expect(findBuiltinCommand("?")?.id).toBe("help.list");
	});

	it("resolves a command by its primary name", () => {
		expect(findBuiltinCommand("new")?.id).toBe("session.new");
		expect(findBuiltinCommand("model")?.id).toBe("model.switch");
	});

	it("returns undefined for an unknown command", () => {
		expect(findBuiltinCommand("definitely-not-a-command")).toBeUndefined();
	});
});

describe("runBuiltinCommand dispatch", () => {
	it("/new with no args starts a fresh session", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("new"), "");
		expect(ctx.newSession).toHaveBeenCalledWith(undefined);
	});

	it("/new <folder> passes the folder through", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("new"), "  ~/projects/app  ");
		expect(ctx.newSession).toHaveBeenCalledWith("~/projects/app");
	});

	it("/resume opens the sessions list", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("resume"), "");
		expect(ctx.openSessions).toHaveBeenCalledTimes(1);
	});

	it("/model with no args opens the model selector", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("model"), "");
		expect(ctx.openModelSelector).toHaveBeenCalledTimes(1);
		expect(ctx.setModel).not.toHaveBeenCalled();
	});

	it("/model <id> sets the model directly", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("model"), " gpt-4o ");
		expect(ctx.setModel).toHaveBeenCalledWith("gpt-4o");
		expect(ctx.openModelSelector).not.toHaveBeenCalled();
	});

	it("/settings opens settings", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("settings"), "");
		expect(ctx.openSettings).toHaveBeenCalledTimes(1);
	});

	it("/help shows the command list", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("help"), "");
		expect(ctx.showHelp).toHaveBeenCalledTimes(1);
	});
});
