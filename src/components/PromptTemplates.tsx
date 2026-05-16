/**
 * PromptTemplates — sidebar panel with reusable prompt templates
 *
 * Shows templates grouped by category. Clicking a template card
 * sends its prompt via the onSend callback.
 */

import { ScrollArea } from "@/components/ui/scroll-area";
import { CATEGORIES, type PromptTemplate, TEMPLATES } from "@/data/templates";
import {
	BarChart3,
	BookOpen,
	ClipboardList,
	Code2,
	FileSearch,
	FileText,
	Languages,
	Lightbulb,
	Mail,
	SearchCheck,
} from "lucide-react";
import type { ComponentType } from "react";

interface PromptTemplatesProps {
	onSend: (prompt: string) => void;
}

/** Map icon string → lucide component */
const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
	FileText,
	Mail,
	SearchCheck,
	FileSearch,
	BarChart3,
	Languages,
	Code2,
	BookOpen,
	Lightbulb,
	ClipboardList,
};

function getIcon(iconName: string) {
	const Icon = ICON_MAP[iconName];
	return Icon ? <Icon className="w-3.5 h-3.5" /> : null;
}

export function PromptTemplates({ onSend }: PromptTemplatesProps) {
	// Group templates by category
	const grouped = TEMPLATES.reduce(
		(acc, tpl) => {
			if (!acc[tpl.category]) acc[tpl.category] = [];
			acc[tpl.category].push(tpl);
			return acc;
		},
		{} as Record<string, PromptTemplate[]>,
	);

	const categoryOrder = ["writing", "data", "code", "general"] as const;

	return (
		<>
			<div className="flex items-center px-3 py-2">
				<span className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
					Templates
				</span>
			</div>
			<ScrollArea className="flex-1 px-2">
				{categoryOrder.map((catKey) => {
					const templates = grouped[catKey];
					if (!templates || templates.length === 0) return null;
					const catInfo = CATEGORIES[catKey];
					return (
						<div key={catKey} className="mb-3">
							<div className="flex items-center gap-1.5 px-1 py-1.5">
								<span className="text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
									{catInfo.label}
								</span>
							</div>
							<div className="space-y-1">
								{templates.map((tpl) => (
									<TemplateCard key={tpl.id} template={tpl} onSend={onSend} />
								))}
							</div>
						</div>
					);
				})}
			</ScrollArea>
		</>
	);
}

function TemplateCard({
	template,
	onSend,
}: {
	template: PromptTemplate;
	onSend: (prompt: string) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onSend(template.prompt)}
			className="w-full text-left px-2.5 py-2 rounded-md transition-colors hover:bg-sidebar-accent/50 group"
			style={{ color: "hsl(var(--sidebar-foreground))" }}
		>
			<div className="flex items-start gap-2">
				<div
					className="w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5"
					style={{
						background: "hsl(var(--primary) / 0.12)",
						color: "hsl(var(--primary))",
					}}
				>
					{getIcon(template.icon)}
				</div>
				<div className="flex-1 min-w-0">
					<span className="text-sm font-medium truncate block">{template.title}</span>
					<p className="text-[10px] text-sidebar-foreground/50 mt-0.5 line-clamp-2">
						{template.description}
					</p>
				</div>
			</div>
		</button>
	);
}
