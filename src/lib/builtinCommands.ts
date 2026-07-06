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
	/**
	 * Start (or reject) a recurring task from `/loop`. Receives the parsed
	 * result so the host can create the task on success or surface the error.
	 */
	startLoop: (result: LoopParseResult) => void;
}

/** Outcome of parsing `/loop <interval> <prompt>` (see {@link parseLoopArgs}). */
export type LoopParseResult =
	| {
			ok: true;
			/** cron expression the recurring task runs on. */
			cron: string;
			/** The prompt fired on every tick. */
			prompt: string;
			/** Human-readable cadence, e.g. "every 5 minutes". */
			label: string;
	  }
	| { ok: false; error: string };

const LOOP_USAGE =
	"Usage: /loop <interval> <prompt> — e.g. /loop 30m check the build. " +
	"Interval units: s, m, h, d (minutes if omitted).";

const UNIT_ALIASES: Record<string, "s" | "m" | "h" | "d"> = {
	s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
	m: "m", min: "m", mins: "m", minute: "m", minutes: "m",
	h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
	d: "d", day: "d", days: "d",
};

const UNIT_NOUN: Record<"m" | "h" | "d", string> = {
	m: "minute",
	h: "hour",
	d: "day",
};

/**
 * Convert a `/loop` interval token (e.g. "5m", "90s", "2h", "1d", or a bare
 * number read as minutes) into a cron expression + human label.
 *
 * cron is minute-granular, so sub-minute intervals round up to 1 minute. Each
 * unit maps to its natural cron slot; a value that overflows its slot (e.g.
 * `90m`) is rejected with a hint rather than silently mangled.
 */
function intervalToCron(token: string): { cron: string; label: string } | null {
	const match = /^(\d+)\s*([a-z]*)$/i.exec(token.trim());
	if (!match) return null;
	const value = Number.parseInt(match[1], 10);
	if (!Number.isFinite(value) || value <= 0) return null;

	const rawUnit = match[2].toLowerCase();
	const unit = rawUnit === "" ? "m" : UNIT_ALIASES[rawUnit];
	if (!unit) return null;

	// Seconds can't be expressed in cron: round up to whole minutes.
	if (unit === "s") {
		const mins = Math.max(1, Math.ceil(value / 60));
		if (mins > 59) return null;
		return { cron: `*/${mins} * * * *`, label: cadence(mins, "m") };
	}
	if (unit === "m") {
		if (value === 60) return { cron: "0 * * * *", label: cadence(1, "h") };
		if (value > 59) return null;
		return { cron: `*/${value} * * * *`, label: cadence(value, "m") };
	}
	if (unit === "h") {
		if (value === 24) return { cron: "0 0 * * *", label: cadence(1, "d") };
		if (value > 23) return null;
		return { cron: `0 */${value} * * *`, label: cadence(value, "h") };
	}
	// days
	if (value > 31) return null;
	return { cron: `0 0 */${value} * *`, label: cadence(value, "d") };
}

function cadence(value: number, unit: "m" | "h" | "d"): string {
	const noun = UNIT_NOUN[unit];
	return value === 1 ? `every ${noun}` : `every ${value} ${noun}s`;
}

/**
 * Parse `/loop <interval> <prompt>`. The first whitespace-delimited token is the
 * interval; the remainder (trimmed) is the prompt. Both are required.
 */
export function parseLoopArgs(args: string): LoopParseResult {
	const trimmed = args.trim();
	if (!trimmed) return { ok: false, error: LOOP_USAGE };

	const spaceAt = trimmed.search(/\s/);
	if (spaceAt === -1) {
		return { ok: false, error: `Add a prompt to run. ${LOOP_USAGE}` };
	}
	const intervalToken = trimmed.slice(0, spaceAt);
	const prompt = trimmed.slice(spaceAt + 1).trim();
	if (!prompt) {
		return { ok: false, error: `Add a prompt to run. ${LOOP_USAGE}` };
	}

	const parsed = intervalToCron(intervalToken);
	if (!parsed) {
		return {
			ok: false,
			error: `Couldn't read the interval "${intervalToken}". ${LOOP_USAGE}`,
		};
	}
	return { ok: true, cron: parsed.cron, prompt, label: parsed.label };
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
		id: "session.loop",
		name: "loop",
		aliases: ["repeat"],
		description: "Run a prompt on a repeating schedule (starts now)",
		category: "session",
		icon: "Repeat",
		argHint: "<interval> <prompt> — e.g. 30m check the build",
		run: (ctx, args) => ctx.startLoop(parseLoopArgs(args)),
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
