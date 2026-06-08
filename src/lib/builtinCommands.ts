/**
 * Built-in slash commands (#182, epic #179) — the "clean subset" that wires to
 * handlers App.tsx already exposes. Plumbing-dependent commands
 * (/extensions, /skills, /share, /clear, /compact) are tracked in
 * docs/plans/slash-commands-roadmap.md (A2b) and intentionally omitted here.
 *
 * Each command's `run(ctx, args)` closes over a CommandContext of GUI actions;
 * the actual handlers are provided by App.tsx when it builds the context. This
 * module is pure + framework-free so it can be unit-tested in isolation.
 */

import type { Command } from "@/types/commands";

/** GUI actions a built-in command can invoke. Supplied by App.tsx. */
export interface CommandContext {
	/** Start a new session, optionally in a specific folder. */
	newSession: (folder?: string) => void;
	/** Open the sessions/history list. */
	openSessions: () => void;
	/** Open the model selector UI. */
	openModelSelector: () => void;
	/** Switch to a model by id. */
	setModel: (modelId: string) => void;
	/** Open the settings view. */
	openSettings: () => void;
	/** Show the list of available commands. */
	showHelp: () => void;
}

/** A built-in command: a palette {@link Command} plus its dispatch action. */
export interface BuiltinCommand extends Command {
	run: (ctx: CommandContext, args: string) => void;
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
	{
		id: "session.new",
		name: "new",
		aliases: ["new-session"],
		description: "Start a new session",
		category: "session",
		icon: "MessageSquarePlus",
		argHint: "folder (optional)",
		run: (ctx, args) => {
			const folder = args.trim();
			ctx.newSession(folder || undefined);
		},
	},
	{
		id: "session.resume",
		name: "resume",
		aliases: ["sessions", "history"],
		description: "Open previous sessions",
		category: "session",
		run: (ctx) => ctx.openSessions(),
	},
	{
		id: "model.switch",
		name: "model",
		description: "Switch the model",
		category: "model",
		argHint: "model-id (optional)",
		run: (ctx, args) => {
			const id = args.trim();
			if (id) ctx.setModel(id);
			else ctx.openModelSelector();
		},
	},
	{
		id: "view.settings",
		name: "settings",
		aliases: ["config"],
		description: "Open settings",
		category: "view",
		run: (ctx) => ctx.openSettings(),
	},
	{
		id: "help.list",
		name: "help",
		aliases: ["?"],
		description: "List available commands",
		category: "view",
		run: (ctx) => ctx.showHelp(),
	},
];

/** Resolve a command by its primary name or any alias (case-insensitive). */
export function findBuiltinCommand(nameOrAlias: string): BuiltinCommand | undefined {
	const needle = nameOrAlias.trim().toLowerCase();
	return BUILTIN_COMMANDS.find(
		(cmd) =>
			cmd.name.toLowerCase() === needle ||
			(cmd.aliases ?? []).some((a) => a.toLowerCase() === needle),
	);
}

/** Dispatch a built-in command with its trailing argument string. */
export function runBuiltinCommand(
	ctx: CommandContext,
	command: BuiltinCommand,
	args: string,
): void {
	command.run(ctx, args);
}
