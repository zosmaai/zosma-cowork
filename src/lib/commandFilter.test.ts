import type { Command } from "@/types/commands";
import { describe, expect, it } from "vitest";
import { filterCommands } from "./commandFilter";

const CMDS: Command[] = [
	{
		id: "session.new",
		name: "new",
		aliases: ["clear"],
		description: "Start a new session",
		category: "session",
	},
	{
		id: "session.resume",
		name: "resume",
		description: "Resume a previous session",
		category: "session",
	},
	{
		id: "model.switch",
		name: "model",
		description: "Switch the model",
		category: "model",
		argHint: "model-id",
	},
	{ id: "view.settings", name: "settings", description: "Open settings", category: "view" },
];

describe("filterCommands", () => {
	it("returns all commands for an empty query", () => {
		expect(filterCommands(CMDS, "").map((c) => c.id)).toEqual(CMDS.map((c) => c.id));
	});

	it("matches a name prefix", () => {
		expect(filterCommands(CMDS, "re").map((c) => c.id)).toEqual(["session.resume"]);
	});

	it("matches an alias", () => {
		expect(filterCommands(CMDS, "clear").map((c) => c.id)).toEqual(["session.new"]);
	});

	it("is case-insensitive", () => {
		expect(filterCommands(CMDS, "MOD").map((c) => c.id)).toEqual(["model.switch"]);
	});

	it("matches subsequence (fuzzy), not just prefix", () => {
		// "stns" is a subsequence of "settings"
		expect(filterCommands(CMDS, "stns").map((c) => c.id)).toEqual(["view.settings"]);
	});

	it("falls back to description match", () => {
		expect(filterCommands(CMDS, "switch").map((c) => c.id)).toEqual(["model.switch"]);
	});

	it("ranks exact/prefix name above description matches", () => {
		const cmds: Command[] = [
			{ id: "a", name: "alpha", description: "mentions new things", category: "session" },
			{ id: "b", name: "new", description: "create", category: "session" },
		];
		expect(filterCommands(cmds, "new").map((c) => c.id)).toEqual(["b", "a"]);
	});

	it("returns empty for no match", () => {
		expect(filterCommands(CMDS, "zzzzz")).toEqual([]);
	});
});
