/**
 * instructions-store — persistence for the user's custom instructions.
 *
 * Custom instructions are stored as a plain Markdown file (`INSTRUCTIONS.md`)
 * under the Cowork dir (e.g. `~/.zosmaai/cowork`), as a sibling of the
 * self-knowledge `ABOUT-ZOSMA-COWORK.md` doc. A real file (not a `settings.json`
 * key) is used so the content can be edited in a rich Markdown editor, kept in
 * version control, and read/grep'd like any other doc.
 *
 * The file becomes always-on context: the sidecar's `systemPromptOverride`
 * reads it and appends it to the system prompt. Because pi caches the system
 * prompt at `ResourceLoader.reload()` time, the `save_instructions` RPC reloads
 * the session after writing so the change takes effect immediately (active
 * session + every new chat) without restarting the app.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Stable filename for the custom-instructions doc, under the Cowork dir. */
export const INSTRUCTIONS_FILENAME = "INSTRUCTIONS.md";

/** Absolute path to the instructions file inside `coworkDir`. */
export function instructionsFilePath(coworkDir: string): string {
	return join(coworkDir, INSTRUCTIONS_FILENAME);
}

/**
 * Read the custom instructions. Returns `""` when the file is absent or
 * unreadable — an empty result means "no custom instructions", which callers
 * treat as a no-op (nothing appended to the system prompt).
 */
export function loadInstructions(coworkDir: string): string {
	const fp = instructionsFilePath(coworkDir);
	if (!existsSync(fp)) return "";
	try {
		return readFileSync(fp, "utf-8");
	} catch {
		return "";
	}
}

/**
 * Persist the custom instructions, creating `coworkDir` if needed. Returns the
 * absolute path written. Empty/whitespace-only content is still written (the
 * user clearing the field is a valid "remove my instructions" action).
 */
export function saveInstructions(coworkDir: string, content: string): string {
	if (!existsSync(coworkDir)) {
		mkdirSync(coworkDir, { recursive: true });
	}
	const fp = instructionsFilePath(coworkDir);
	writeFileSync(fp, content, "utf-8");
	return fp;
}

/**
 * Render the system-prompt block for the user's custom instructions, or `""`
 * when there are none. Kept as a clearly-delimited section so the model treats
 * it as user-authored guidance layered on top of the base prompt.
 */
export function customInstructionsBlock(content: string): string {
	const trimmed = content.trim();
	if (trimmed.length === 0) return "";
	return `## User's custom instructions\n\nThe user has configured the following standing instructions. Honor them across every task unless they conflict with a more specific request:\n\n${trimmed}`;
}
