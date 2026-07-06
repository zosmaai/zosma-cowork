import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./builtinCommands";
import {
	BUILTIN_COMMANDS,
	findBuiltinCommand,
	parseLoopArgs,
	runBuiltinCommand,
} from "./builtinCommands";

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
		startLoop: vi.fn(),
	};
}

describe("BUILTIN_COMMANDS registry", () => {
	it("exposes the clean-subset commands", () => {
		const ids = BUILTIN_COMMANDS.map((c) => c.id).sort();
		expect(ids).toEqual(
			[
				"session.new",
				"session.resume",
				"session.loop",
				"model.switch",
				"view.settings",
				"help.list",
			].sort(),
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
		expect(findBuiltinCommand("repeat")?.id).toBe("session.loop");
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

	it("/loop passes a parsed spec to startLoop", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("loop"), "30m check the build");
		expect(ctx.startLoop).toHaveBeenCalledWith({
			ok: true,
			cron: "*/30 * * * *",
			prompt: "check the build",
			label: "every 30 minutes",
		});
	});

	it("/loop passes an error result for bad input", () => {
		const ctx = mockCtx();
		runBuiltinCommand(ctx, cmd("loop"), "");
		expect(ctx.startLoop).toHaveBeenCalledWith(
			expect.objectContaining({ ok: false }),
		);
	});
});

describe("parseLoopArgs", () => {
	it("reads a bare number as minutes", () => {
		expect(parseLoopArgs("5 ping")).toEqual({
			ok: true,
			cron: "*/5 * * * *",
			prompt: "ping",
			label: "every 5 minutes",
		});
	});

	it("supports s / m / h / d units and singular labels", () => {
		expect(parseLoopArgs("1m tick")).toMatchObject({
			cron: "*/1 * * * *",
			label: "every minute",
		});
		expect(parseLoopArgs("2h build")).toMatchObject({
			cron: "0 */2 * * *",
			label: "every 2 hours",
		});
		expect(parseLoopArgs("1d digest")).toMatchObject({
			cron: "0 0 */1 * *",
			label: "every day",
		});
		// sub-minute rounds up to a whole minute
		expect(parseLoopArgs("30s poll")).toMatchObject({
			cron: "*/1 * * * *",
			label: "every minute",
		});
	});

	it("normalises boundary values to the coarser unit", () => {
		expect(parseLoopArgs("60m x")).toMatchObject({ cron: "0 * * * *", label: "every hour" });
		expect(parseLoopArgs("24h x")).toMatchObject({ cron: "0 0 * * *", label: "every day" });
	});

	it("keeps the full prompt including inner whitespace", () => {
		expect(parseLoopArgs("10m  summarise  my inbox ")).toMatchObject({
			prompt: "summarise  my inbox",
		});
	});

	it("rejects a missing prompt", () => {
		expect(parseLoopArgs("10m")).toMatchObject({ ok: false });
		expect(parseLoopArgs("")).toMatchObject({ ok: false });
	});

	it("rejects an unreadable or out-of-range interval", () => {
		expect(parseLoopArgs("abc do it")).toMatchObject({ ok: false });
		expect(parseLoopArgs("0m do it")).toMatchObject({ ok: false });
		expect(parseLoopArgs("90m do it")).toMatchObject({ ok: false });
		expect(parseLoopArgs("25h do it")).toMatchObject({ ok: false });
	});
});
