/**
 * PromptTemplates — reusable prompt template definitions
 *
 * Hard-coded initial set of templates for common tasks.
 * Non-tech users can click these to quickly start conversations.
 */

export interface PromptTemplate {
	id: string;
	title: string;
	description: string;
	category: "writing" | "data" | "code" | "general";
	icon: string;
	prompt: string;
}

export const TEMPLATES: PromptTemplate[] = [
	// ── Writing ──
	{
		id: "write-document",
		title: "Write a Document",
		description: "Draft a professional document with structure",
		category: "writing",
		icon: "FileText",
		prompt:
			"Write a professional document about [topic]. Include an introduction, key points, and a conclusion. Use a formal tone and clear section headings.",
	},
	{
		id: "write-email",
		title: "Write an Email",
		description: "Draft a professional email",
		category: "writing",
		icon: "Mail",
		prompt:
			"Help me draft a professional email about [topic]. The recipient is [recipient] and the tone should be [formal/casual]. Include a clear subject line and call to action.",
	},
	{
		id: "proofread",
		title: "Proofread & Edit",
		description: "Review text for grammar and clarity",
		category: "writing",
		icon: "SearchCheck",
		prompt:
			"Please review the following text for grammar, clarity, and style. Suggest improvements while preserving the original meaning. Format suggestions as a bullet list:\n\n[paste text here]",
	},

	// ── Data ──
	{
		id: "summarize-file",
		title: "Summarize a File",
		description: "Get a concise summary of a document",
		category: "data",
		icon: "FileSearch",
		prompt:
			"Read the file at [path] and provide a concise summary covering the main points, key data, and conclusions. Use bullet points for clarity.",
	},
	{
		id: "analyze-data",
		title: "Analyze Data",
		description: "Find patterns and insights in data",
		category: "data",
		icon: "BarChart3",
		prompt:
			"Analyze the following data and identify patterns, trends, and outliers. Provide actionable insights and recommendations:\n\n[paste data here]",
	},
	{
		id: "translate",
		title: "Translate Text",
		description: "Translate between languages",
		category: "data",
		icon: "Languages",
		prompt:
			"Translate the following text from [source language] to [target language]. Preserve the original tone, nuance, and formatting:\n\n[paste text here]",
	},

	// ── Code ──
	{
		id: "write-code",
		title: "Write Code",
		description: "Generate code for a specific task",
		category: "code",
		icon: "Code2",
		prompt:
			"Write a [programming language] program that [describe what it should do]. Include comments explaining the logic. Handle edge cases and errors gracefully.",
	},
	{
		id: "explain-code",
		title: "Explain Code",
		description: "Understand code in simple terms",
		category: "code",
		icon: "BookOpen",
		prompt:
			"Explain the following code in simple terms: what it does, how it works, potential issues, and how to improve it:\n\n[paste code here]",
	},

	// ── General ──
	{
		id: "brainstorm",
		title: "Brainstorm Ideas",
		description: "Generate creative ideas on any topic",
		category: "general",
		icon: "Lightbulb",
		prompt:
			"I need ideas for [topic]. Please help me brainstorm creative approaches. For each idea, include pros, cons, and feasibility. Then suggest the top 3 approaches to pursue.",
	},
	{
		id: "plan-project",
		title: "Plan a Project",
		description: "Create a structured project plan",
		category: "general",
		icon: "ClipboardList",
		prompt:
			"Help me create a plan for [project]. Include:\n- Goals and deliverables\n- Key milestones with timeline\n- Resources needed\n- Potential risks and mitigations\n- Success criteria",
	},
];

/** Categories with display info */
export const CATEGORIES: Record<PromptTemplate["category"], { label: string; icon: string }> = {
	writing: { label: "Writing", icon: "FileText" },
	data: { label: "Data & Analysis", icon: "BarChart3" },
	code: { label: "Code", icon: "Code2" },
	general: { label: "General", icon: "Lightbulb" },
};
