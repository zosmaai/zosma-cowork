/**
 * statusLabels — maps raw tool names to friendly, non-technical phrases and
 * clubs consecutive same-phrase tool calls into a single activity line.
 *
 * Used by the "Perplexity-style" activity view (issue #173) so non-technical
 * users see "Creating a document…" instead of `write ~/foo.md (42 lines · 1.2KB)`.
 */

import type { ToolCallInfo } from "@/types";

/**
 * Friendly present-tense phrase for a tool, shown while it runs.
 * Hardcoded by design (v1) — never surface raw tool names/paths/commands.
 */
export function friendlyToolPhrase(toolName: string): string {
	// Normalize provider-namespaced tools (e.g. "google_docs_create")
	const name = toolName.toLowerCase();

	if (name.startsWith("google_docs")) return "Working on your document";
	if (name.startsWith("google_sheets")) return "Working on your spreadsheet";
	if (name.startsWith("google_slides")) return "Working on your slides";
	if (name.startsWith("google_drive")) return "Organizing your files";
	if (name === "gmail") return "Checking email";

	// Knowledge / memory tools (memex, llm-wiki, context-mode search)
	if (name.startsWith("memex") || name.startsWith("wiki") || name.startsWith("ctx_search"))
		return "Gathering knowledge";

	// Planning / orchestration
	if (name.includes("todo") || name.includes("plan_tracker")) return "Planning the steps";
	if (name === "subagent") return "Delegating a task";
	if (name === "ask_user") return "Asking you a question";
	if (name.startsWith("schedule")) return "Setting a reminder";
	if (
		name.startsWith("web_search") ||
		name.startsWith("web_answer") ||
		name.startsWith("web_research")
	) {
		return "Searching the web";
	}
	if (name.startsWith("web_fetch") || name.startsWith("web_find_similar")) {
		return "Reading a web page";
	}

	switch (name) {
		case "write":
			return "Creating a document";
		case "edit":
			return "Updating a document";
		case "read":
			return "Reading your files";
		case "ls":
		case "find":
		case "grep":
			return "Looking through files";
		case "bash":
			return "Working in your workspace";
		case "web_search":
			return "Searching the web";
		case "code_search":
			return "Looking up references";
		case "fetch_content":
			return "Reading a web page";
		default:
			return "Working on it";
	}
}

export type ActivityStatus = "running" | "completed" | "error";

export interface Activity {
	/** Friendly phrase, e.g. "Reading your files" */
	phrase: string;
	/** How many consecutive tool calls were clubbed into this activity */
	count: number;
	/** Aggregate status: error if any errored, running if any running, else completed */
	status: ActivityStatus;
	/** Stable key for React lists */
	key: string;
}

/**
 * Merge consecutive tool calls that map to the same friendly phrase into a
 * single activity, preserving order. A run's status is "error" if any call in
 * it errored, "running" if any is still running, otherwise "completed".
 */
export function clubActivities(toolCalls: ToolCallInfo[]): Activity[] {
	const activities: Activity[] = [];

	for (const tc of toolCalls) {
		const phrase = friendlyToolPhrase(tc.name);
		const last = activities[activities.length - 1];

		if (last && last.phrase === phrase) {
			last.count += 1;
			last.status = mergeStatus(last.status, tc.status);
			continue;
		}

		activities.push({
			phrase,
			count: 1,
			status: tc.status,
			key: `${phrase}-${activities.length}`,
		});
	}

	return activities;
}

/** error wins over running wins over completed. */
function mergeStatus(a: ActivityStatus, b: ActivityStatus): ActivityStatus {
	if (a === "error" || b === "error") return "error";
	if (a === "running" || b === "running") return "running";
	return "completed";
}

/**
 * Headline phrase for the activity block: the currently-running activity if
 * any, otherwise the most recent one. Returns null when there are no tools.
 */
export function headlineActivity(toolCalls: ToolCallInfo[]): Activity | null {
	const activities = clubActivities(toolCalls);
	if (activities.length === 0) return null;
	const running = activities.find((a) => a.status === "running");
	return running ?? activities[activities.length - 1];
}
