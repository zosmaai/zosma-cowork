import { cn } from "@/lib/utils";
import { MessageSquare, Settings } from "lucide-react";

interface MobileBottomNavProps {
	view: string;
	onChangeView: (view: string) => void;
}

export function MobileBottomNav({ view, onChangeView }: MobileBottomNavProps) {
	return (
		<nav className="md:hidden shrink-0 border-t border-border bg-background flex items-center justify-around px-2 py-1 safe-area-bottom">
			<TabButton
				icon={MessageSquare}
				label="Cowork"
				active={view === "chats"}
				onClick={() => onChangeView("chats")}
			/>
			<TabButton
				icon={Settings}
				label="Settings"
				active={view === "settings"}
				onClick={() => onChangeView("settings")}
			/>
		</nav>
	);
}

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
				"flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors text-[10px]",
				active
					? "text-foreground bg-muted/50"
					: "text-muted-foreground/40 hover:text-muted-foreground/70",
			)}
			style={{ minWidth: 56, minHeight: 44 }}
		>
			<Icon className="w-5 h-5" />
			{label}
		</button>
	);
}
