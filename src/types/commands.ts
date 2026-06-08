/**
 * Slash-command types (epic #179).
 *
 * A `Command` is a pure data descriptor of something the user can run by
 * typing `/` in the composer. A1 (#181) only renders and selects commands;
 * the actual implementations are supplied by later slices:
 *   - A2 (#182) built-in app actions → Tauri invokes
 *   - A4 (#184) skill & prompt-template commands
 *   - A3 (#183) extension-registered commands via the sidecar bridge
 */

/** Logical grouping shown as a section header in the palette. */
export type CommandCategory = "session" | "model" | "view" | "extensions" | "skills";

export interface Command {
	/** Stable unique id (e.g. "session.new"). */
	id: string;
	/** Primary name typed after the slash, without the leading `/` (e.g. "new"). */
	name: string;
	/** Alternate names that also match (e.g. ["clear"] for "new"). */
	aliases?: string[];
	/** One-line human description shown in the palette row. */
	description: string;
	/** Section the command is grouped under. */
	category: CommandCategory;
	/** Optional lucide icon name (resolved by the palette's icon map). */
	icon?: string;
	/**
	 * Hint describing expected arguments, shown when the command is selected
	 * (e.g. "gpt-4o" for `/model`). Presence does not enforce args.
	 */
	argHint?: string;
}

/** Display order + labels for category section headers. */
export const COMMAND_CATEGORY_ORDER: CommandCategory[] = [
	"session",
	"model",
	"view",
	"extensions",
	"skills",
];

export const COMMAND_CATEGORY_LABELS: Record<CommandCategory, string> = {
	session: "Session",
	model: "Model",
	view: "View",
	extensions: "Extensions",
	skills: "Skills",
};
