import { cn } from "@/lib/utils";

import { MessageSquare, NotebookPen, Settings } from "lucide-react";
import { ConversationSearch } from "./ConversationSearch";
import { PromptTemplates } from "./PromptTemplates";

interface Session {
	id: string;
	title: string;
	lastMessage: string;
	timestamp: number;
	active?: boolean;
}

interface SidebarProps {
	view: string;
	sessions: Session[];
	activeSessionId?: string;
	onSessionSelect: (id: string) => void;
	onNewSession: () => void;
	onDeleteSession: (id: string) => void;
	onChangeView: (view: string) => void;
	onSend?: (prompt: string) => void;
}

export function Sidebar({
	view,
	sessions,
	activeSessionId,
	onSessionSelect,
	onNewSession,
	onDeleteSession,
	onChangeView,
	onSend,
}: SidebarProps) {
	const isSettings = view === "settings";
	const isTemplates = view === "templates";

	return (
		<div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
			{/* Content area */}
			{isTemplates && onSend ? (
				<PromptTemplates onSend={onSend} />
			) : (
				<ConversationSearch
					sessions={sessions}
					activeSessionId={activeSessionId}
					onSelect={onSessionSelect}
					onNewSession={onNewSession}
					onDeleteSession={onDeleteSession}
				/>
			)}

			{/* Bottom tab bar */}
			<div className="shrink-0 border-t border-sidebar-border flex items-center justify-around px-2 py-1.5">
				<TabButton
					icon={MessageSquare}
					label="Chats"
					active={view === "chats"}
					onClick={() => onChangeView("chats")}
				/>
				<TabButton
					icon={NotebookPen}
					label="Templates"
					active={isTemplates}
					onClick={() => onChangeView("templates")}
				/>
				<TabButton
					icon={Settings}
					label="Settings"
					active={isSettings}
					onClick={() => onChangeView("settings")}
				/>
			</div>
		</div>
	);
}

// ─── Tab Button ─────────────────────────────────────────────────────

function TabButton({
	icon: Icon,
	label,
	active,
	onClick,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors text-[10px]",
				active
					? "text-sidebar-foreground bg-sidebar-accent/50"
					: "text-sidebar-foreground/40 hover:text-sidebar-foreground/70",
			)}
		>
			<Icon className="w-4 h-4" />
			{label}
		</button>
	);
}
