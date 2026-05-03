import { CheckSquare, MessageSquare, Settings, Terminal } from "lucide-react";

export type NavView = "chat" | "tasks" | "settings" | "commands";

interface NavIconsProps {
	activeView: NavView;
	onNavigate: (view: NavView) => void;
}

const ITEMS: { view: NavView; icon: typeof MessageSquare; label: string }[] = [
	{ view: "chat", icon: MessageSquare, label: "Chat" },
	{ view: "commands", icon: Terminal, label: "Commands" },
	{ view: "tasks", icon: CheckSquare, label: "Tasks" },
	{ view: "settings", icon: Settings, label: "Settings" },
];

export function NavIcons({ activeView, onNavigate }: NavIconsProps) {
	return (
		<div className="flex justify-around">
			{ITEMS.map(({ view, icon: Icon, label }) => (
				<button
					key={view}
					type="button"
					onClick={() => onNavigate(view)}
					aria-label={label}
					className={`p-2 rounded-lg transition-colors ${
						activeView === view
							? "bg-sidebar-accent text-sidebar-accent-foreground"
							: "text-muted-foreground hover:text-sidebar-foreground"
					}`}
				>
					<Icon className="w-5 h-5" />
				</button>
			))}
		</div>
	);
}
