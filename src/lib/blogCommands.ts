/**
 * Zosma Blog slash commands for Cowork.
 *
 * Each command sends a self-contained prompt to the Pi agent. Prompts start
 * with /write-blog or /blog- so the @zosmaai/pi-blog extension's
 * before_agent_start hook injects the blog system context automatically.
 *
 * The agent has direct access to all blog tools registered by the extension:
 *   blog_status · load_topic_history · save_topics · load_topics
 *   log_topic_status · save_draft
 */

import type { Command } from "@/types/commands";
import type { CommandContext } from "./builtinCommands";

export interface BlogCommand extends Command {
	run: (ctx: CommandContext, args: string) => void;
}

// ── Prompt templates ──────────────────────────────────────────────────────────

export const EXPLORE_PROMPT = (note?: string) => `/write-blog — Explore Topics
${note ? `\nContext from user: ${note}\n` : ""}
⚠️ CRITICAL: Complete ALL steps (1–5) in ONE turn before any user-facing output.
Do NOT narrate what you are about to do and stop. Do NOT summarize state and stop.
The ONLY permitted response is after save_topics has returned successfully.

**Step 1** — Call \`blog_status\` then \`load_topic_history\`.
Note every title with status "written" or "selected" — never re-suggest these.
Read config.context and config.audience — use them to shape every search query.

**Step 2** — Derive 5 search queries from config.context${note ? " and the user context above" : ""}.
Formula: "<core topic from context> <specific angle> 2026"
Never use hardcoded queries. Always derive from config + session note.

**Step 3** — Run all 5 searches.
Priority: (A) agent-browser if \`which agent-browser\` returns AVAILABLE,
(B) WebSearch tool — platform-safe, no bash needed,
(C) skip to next query if both fail — do NOT stop the workflow.
🚫 Never use bash curl/wget/urllib to fetch URLs.

**Step 4** — Pick 3–5 fresh topics not in the history ledger.
For each: title (max 60 chars), angle (editorial hook), category, source_url.

**Step 5** — Call \`save_topics\` with the array. Then report: count, titles, categories.
Tell the user: pick a topic with /blog-select, then /blog-write to draft it.`;

export const WRITE_PROMPT = (topic?: string, note?: string) => `/blog-write — Write Blog Post
${topic ? `\nTopic: ${topic}` : ""}${note ? `\nContext from user: ${note}` : ""}

⚠️ CRITICAL — SINGLE-TURN WORKFLOW: You MUST complete ALL steps (0–6) in this
single turn before emitting any response to the user. Do NOT say "Now let me
write…", "Let me draft…", "Next I will…" or any forward-looking text and stop.
That terminates the session before the post is written.
🚫 NEVER run bash commands to fetch URLs (no curl, wget, python urllib). They hang
and abort the session. Use WebSearch tool for research only.
🚫 NEVER convert to PDF, HTML, or any other format. NEVER run pandoc, Chrome,
wkhtmltopdf, or any document converter. Your ONLY output artifact is the
Markdown .md file saved by save_draft. Nothing else.
The ONLY permitted user-facing output is the ✅ summary after save_draft succeeds.

**Step 0 — Load state**
Call \`blog_status\`. Read state.currentTopic${topic ? ` (if empty, use: "${topic}")` : ""}.
If currentTopic is missing and no topic was supplied: stop with "No topic selected.
Run /blog-select first." Otherwise, proceed immediately to Step 1.

**Step 1 — Choose template**
Pick the best-fit template for the topic angle:
how-to-guide · comparison · listicle · data-research · case-study · faq-knowledge
news-analysis · roundup · tutorial · thought-leadership · pillar-page · product-review

**Step 2 — Research (WebSearch only)**
Run 2-3 WebSearch queries to collect supporting facts, stats, and sources.
Queries: "<topic> statistics 2025", "<topic> India 2026", "<key claim> source".
If a query fails or returns nothing, skip it and continue. Never stop on a failed search.

**Step 3 — Write the full post**
Required frontmatter (save_draft will reject missing keys):
\`\`\`yaml
---
title: "max 60 chars — identical to H1"
description: "150-160 chars"
date: "YYYY-MM-DD"
category: "Indian Finance | AI Agents | Privacy | Open Source | MSME"
tags: ["tag1", "tag2", "tag3"]
author: "Zosma AI"
---
\`\`\`
Post structure: H1 → TL;DR blockquote → 3-6 H2 sections (answer-first 40-60 word
openers) → FAQ (3-5 × ### Q? + prose) → closing call to action.
Voice: direct, no fluff, Indian enterprise context, named sources, concrete numbers.
${note ? `User override (apply throughout): ${note}\n` : ""}Word count: 1,200–1,500 explainer · 2,000–2,500 deep dive.

**Step 4 — Quality gate**
Verify: title matches H1 exactly · all stats named with source inline · no fabricated
numbers · frontmatter complete · body > 800 words · FAQ section present.
Fix any failures before calling save_draft.

**Step 5 — Save**
Derive slug (lowercase, alphanumerics + hyphens only). Call:
\`\`\`
save_draft(slug="kebab-slug", markdown="full post starting with ---")
\`\`\`
If save_draft returns isError, read the reason, fix it, and retry. Never give up.

**Step 6 — Report (final output only)**
After save_draft succeeds output EXACTLY this block and nothing else:
✅ Draft saved: <path>
Word count: ~<N> words
Topic marked: written`;

export const SELECT_PROMPT = `/blog-topics — Select Topic

Call \`load_topics\` to read the most recent topic batch.

Present topics as a numbered list with title and one-line angle. Ask the user which one to write about.

When the user picks one:
1. Call \`log_topic_status(title="...", status="selected")\`
2. Confirm: "Selected: [title]. Run /blog-write to start writing."`;

export const STATUS_PROMPT = `/blog-status

Call \`blog_status\` and present the results clearly:

- **Phase:** current pipeline phase
- **Current topic:** title + category (if any is selected)
- **History:** X posts written · Y topics explored · Z abandoned
- **Drafts folder:** path where .md files are saved
- **Last batch:** date of most recent topic exploration run`;

// ── Command registry ──────────────────────────────────────────────────────────

export const BLOG_COMMANDS: BlogCommand[] = [
	{
		id: "blog.write-blog",
		name: "write-blog",
		aliases: ["blog"],
		description: 'Full pipeline: explore → select → write · add "note" to focus research',
		category: "extensions",
		icon: "BookOpen",
		argHint: '"note" or --topic "Title"',
		run: (ctx, args) => {
			const trimmed = args.trim();

			// Parse --topic flag
			const topicMatch = trimmed.match(/--topic\s+"([^"]+)"|--topic\s+(\S+)/);
			const topic = topicMatch?.[1] ?? topicMatch?.[2];

			if (topic) {
				// Strip the --topic flag and any other recognized flags to get the note
				const note = trimmed
					.replace(/--topic\s+"[^"]*"|--topic\s+\S+/g, "")
					.replace(/--category\s+"[^"]*"|--category\s+\S+/g, "")
					.replace(/--angle\s+"[^"]*"|--angle\s+\S+/g, "")
					.replace(/^"|"$/g, "")
					.trim();
				const prompt = WRITE_PROMPT(topic, note || undefined);
				ctx.runAgent(prompt.split("\n")[0], prompt);
			} else {
				// Freeform text is the session note for topic exploration
				const note = trimmed.replace(/^"|"$/g, "") || undefined;
				const prompt = EXPLORE_PROMPT(note);
				ctx.runAgent(prompt.split("\n")[0], prompt);
			}
		},
	},
	{
		id: "blog.topics",
		name: "blog-topics",
		aliases: ["topics", "explore-topics"],
		description: 'Research and save 3-5 fresh topics · add "note" to focus the search',
		category: "extensions",
		icon: "BookOpen",
		argHint: '"note" (optional)',
		run: (ctx, args) => {
			const note = args.trim().replace(/^"|"$/g, "") || undefined;
			const prompt = EXPLORE_PROMPT(note);
			ctx.runAgent(prompt.split("\n")[0], prompt);
		},
	},
	{
		id: "blog.select",
		name: "blog-select",
		aliases: ["select-topic"],
		description: "Pick a topic from the last saved batch",
		category: "extensions",
		icon: "BookOpen",
		run: (ctx, _args) => {
			ctx.runAgent(SELECT_PROMPT.split("\n")[0], SELECT_PROMPT);
		},
	},
	{
		id: "blog.write",
		name: "blog-write",
		aliases: ["write"],
		description: "Write a post for the currently selected topic",
		category: "extensions",
		icon: "BookOpen",
		argHint: '"Title" or "note" (optional)',
		run: (ctx, args) => {
			const trimmed = args.trim().replace(/^"|"$/g, "");
			// If it looks like a title (short, no directive words), treat as topic
			const looksLikeTopic =
				trimmed.length < 80 &&
				!trimmed.includes("keep") &&
				!trimmed.includes("focus") &&
				!trimmed.includes("avoid");
			const prompt =
				trimmed && looksLikeTopic
					? WRITE_PROMPT(trimmed)
					: WRITE_PROMPT(undefined, trimmed || undefined);
			ctx.runAgent(prompt.split("\n")[0], prompt);
		},
	},
	{
		id: "blog.status",
		name: "blog-status",
		aliases: ["blog-state", "blog-info"],
		description: "Show pipeline phase, history stats, and drafts path",
		category: "extensions",
		icon: "BookOpen",
		run: (ctx, _args) => {
			ctx.runAgent(STATUS_PROMPT.split("\n")[0], STATUS_PROMPT);
		},
	},
];

/** Resolve a blog command by primary name or alias (case-insensitive). */
export function findBlogCommand(nameOrAlias: string): BlogCommand | undefined {
	const needle = nameOrAlias.trim().toLowerCase();
	return BLOG_COMMANDS.find(
		(cmd) =>
			cmd.name.toLowerCase() === needle ||
			(cmd.aliases ?? []).some((a) => a.toLowerCase() === needle),
	);
}

/** Dispatch a blog command. */
export function runBlogCommand(ctx: CommandContext, cmd: BlogCommand, args: string): void {
	cmd.run(ctx, args);
}
