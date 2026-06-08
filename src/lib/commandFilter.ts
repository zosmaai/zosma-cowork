/**
 * Tiny dependency-free fuzzy matcher for the slash-command palette (#181).
 *
 * Scoring (higher = better), evaluated against name + aliases, then
 * description as a fallback:
 *   - exact name/alias match
 *   - name/alias prefix match
 *   - name/alias subsequence match
 *   - description substring match
 * Stable sort preserves the caller's order within an equal score band.
 */

import type { Command } from "@/types/commands";

const SCORE_EXACT = 100;
const SCORE_PREFIX = 75;
const SCORE_SUBSEQUENCE = 50;
const SCORE_DESCRIPTION = 20;

/** True if `q` appears in `text` as an ordered subsequence. */
function isSubsequence(q: string, text: string): boolean {
	let i = 0;
	for (let j = 0; j < text.length && i < q.length; j++) {
		if (text[j] === q[i]) i++;
	}
	return i === q.length;
}

function scoreOne(cmd: Command, q: string): number {
	const names = [cmd.name, ...(cmd.aliases ?? [])].map((n) => n.toLowerCase());
	let best = 0;
	for (const name of names) {
		if (name === q) best = Math.max(best, SCORE_EXACT);
		else if (name.startsWith(q)) best = Math.max(best, SCORE_PREFIX);
		else if (isSubsequence(q, name)) best = Math.max(best, SCORE_SUBSEQUENCE);
	}
	if (best === 0 && cmd.description.toLowerCase().includes(q)) {
		best = SCORE_DESCRIPTION;
	}
	return best;
}

/**
 * Filter + rank commands for a query (the text after the leading `/`,
 * excluding any arguments). Empty query returns the input order unchanged.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
	const q = query.trim().toLowerCase();
	if (!q) return commands;

	return commands
		.map((cmd, index) => ({ cmd, index, score: scoreOne(cmd, q) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((entry) => entry.cmd);
}
