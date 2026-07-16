/**
 * Cowork self-knowledge (issue #263) — progressive disclosure.
 *
 * Cowork sets `systemPromptOverride`, which makes pi's `buildSystemPrompt()`
 * skip its default "Pi documentation (read only when the user asks…)" block.
 * Without that block Cowork can't answer "where do my sessions live". We keep
 * the knowledge minimal since this is a stripped-down build with no extension
 * or skills marketplace.
 *
 * Instead we mirror pi's own pattern:
 *   1. ship the knowledge as a string constant (`ABOUT_COWORK_MD`);
 *   2. write it to a stable on-disk path on init (`writeAboutDoc`) — a GUI
 *      bundle can't rely on a packaged resource path the `read` tool can open,
 *      so we materialize it under the user's Cowork dir instead;
 *   3. add a tiny pointer to the system prompt (`coworkSelfKnowledgePointer`)
 *      telling the model to `read` that path on demand.
 *
 * The doc is the single source of truth and is rewritten on every init, so it
 * always tracks the installed app version.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Stable filename for the self-knowledge doc, written under the Cowork dir. */
export const ABOUT_DOC_FILENAME = "ABOUT-ZOSMA-COWORK.md";

/**
 * The self-knowledge document. Read by the model on demand (never inlined into
 * the always-on prompt). Covers core capabilities and session/state locations.
 */
export const ABOUT_COWORK_MD = `# About Zosma Cowork

You are **Zosma Cowork**, a desktop AI coworker. You help users with
their projects by reading files, running shell commands, editing code, and
writing new files via your built-in tools.

Always identify yourself as "Zosma Cowork" (some upstream APIs may
transport-identify this client as "Claude Code" or "pi" for compatibility — that
is not your user-facing identity).

## Capabilities

- **Read & edit files** — work on code, text, or markdown in the workspace.
- **Run shell commands** — build, test, deploy via the terminal.
- **Write code** — create new files, apps, and automations.

## Sessions and local state

Sessions use pi's native store (shared with the pi CLI); other private state
lives under \`~/.zosmaai/cowork\`:

- **Sessions:** \`~/.pi/agent/sessions/\` — one JSONL file per session, grouped
  by workspace folder (pi's \`SessionManager\`).
- **Pinned/renamed metadata:** \`~/.pi/agent/cowork-meta.json\`.
- **Settings:** \`~/.zosmaai/cowork/settings.json\` (model, persona, telemetry, …).
- This self-knowledge doc: \`~/.zosmaai/cowork/${ABOUT_DOC_FILENAME}\`.
`;

/**
 * Write the self-knowledge doc into `coworkDir` (e.g. `~/.zosmaai/cowork`),
 * creating the directory if needed. Idempotent: overwrites on every call so the
 * doc tracks the installed version. Returns the absolute path written.
 */
export function writeAboutDoc(coworkDir: string): string {
	if (!existsSync(coworkDir)) {
		mkdirSync(coworkDir, { recursive: true });
	}
	const path = join(coworkDir, ABOUT_DOC_FILENAME);
	writeFileSync(path, ABOUT_COWORK_MD, "utf-8");
	return path;
}

/**
 * The tiny system-prompt pointer (progressive disclosure). Kept to a few fixed
 * lines so it adds negligible cost to every turn.
 */
export function coworkSelfKnowledgePointer(aboutPath: string): string {
	return `About yourself: you are Zosma Cowork, a desktop AI coworker. Read ${aboutPath} only when the user asks about your capabilities, sessions, or where things are stored.`;
}
