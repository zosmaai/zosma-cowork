import { trackEvent } from "@/lib/telemetry";
import { BarChart3, Code2, FileSearch, FileText, Languages } from "lucide-react";

interface Suggestion {
	icon: React.ReactNode;
	title: string;
	description: string;
	prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
	{
		icon: <FileText size={20} />,
		title: "Write a document",
		description: "Draft a report, proposal, or article",
		prompt:
			"Write a document for me. It should be well-structured with clear sections and professional formatting.",
	},
	{
		icon: <FileSearch size={20} />,
		title: "Summarize a file",
		description: "Extract key points from a long document",
		prompt:
			"Please summarize the file I'll attach. Extract the key points and main takeaways in a concise format.",
	},
	{
		icon: <BarChart3 size={20} />,
		title: "Analyze data",
		description: "Review datasets and find insights",
		prompt:
			"Analyze the data and provide insights, trends, and patterns you can identify. Include relevant statistics.",
	},
	{
		icon: <Languages size={20} />,
		title: "Translate text",
		description: "Convert between languages",
		prompt:
			"Translate the following text. Keep the original meaning and tone while making it sound natural in the target language.",
	},
	{
		icon: <Code2 size={20} />,
		title: "Write code",
		description: "Build a script, component, or automation",
		prompt:
			"Write code for the following task. Include proper error handling, comments, and follow best practices.",
	},
];

interface SuggestedActionsProps {
	onSend: (text: string) => void;
}

export function SuggestedActions({ onSend }: SuggestedActionsProps) {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-6 px-6">
			<div className="text-center max-w-sm">
				<h1 className="text-lg font-semibold text-foreground">What are you working on?</h1>
				<p className="text-sm mt-1 text-muted-foreground">Choose a starting point or type below</p>
			</div>

			<div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-w-lg w-full">
				{SUGGESTIONS.map((suggestion) => (
					<button
						key={suggestion.title}
						type="button"
						onClick={() => {
							trackEvent("suggested_action", { action: suggestion.title });
							onSend(suggestion.prompt);
						}}
						className="flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all hover:shadow-sm hover:-translate-y-0.5 bg-card border-border"
					>
						<div style={{ color: "hsl(var(--primary))" }}>{suggestion.icon}</div>
						<span className="text-sm font-medium text-foreground">{suggestion.title}</span>
						<span className="text-xs leading-tight text-muted-foreground">
							{suggestion.description}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}
