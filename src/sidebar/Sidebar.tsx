import { ThemeToggle } from "@/components/ThemeToggle";
import type { SessionMeta } from "@/lib/session-store";
import type { PiStatus } from "@/types";
import { Plus } from "lucide-react";
import { NavIcons, type NavView } from "./NavIcons";
import { SessionList } from "./SessionList";

interface SidebarProps {
	sessions: SessionMeta[];
	activeSessionId: string | null;
	sessionsLoading: boolean;
	status: PiStatus | null;
	activeView: NavView;
	onNewSession: () => void;
	onSelectSession: (id: string) => void;
	onDeleteSession: (id: string) => void;
	onNavigate: (view: NavView) => void;
}

export function Sidebar({
	sessions,
	activeSessionId,
	sessionsLoading,
	status,
	activeView,
	onNewSession,
	onSelectSession,
	onDeleteSession,
	onNavigate,
}: SidebarProps) {
	return (
		<aside className="w-[240px] flex flex-col border-r bg-sidebar shrink-0">
			<div className="p-3 border-b border-sidebar-border">
				<button
					type="button"
					onClick={onNewSession}
					className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
				>
					<Plus className="w-4 h-4" />
					New session
				</button>
			</div>

			<SessionList
				sessions={sessions}
				activeSessionId={activeSessionId}
				loading={sessionsLoading}
				onSelect={onSelectSession}
				onDelete={onDeleteSession}
			/>

			<div className="mt-auto border-t border-sidebar-border p-2">
				<NavIcons activeView={activeView} onNavigate={onNavigate} />
			</div>

			<div className="p-3 border-t border-sidebar-border">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
							Z
						</div>
						<div className="leading-tight">
							<div className="text-xs font-medium text-sidebar-foreground">Zosma Cowork</div>
							<div className="text-[10px] text-muted-foreground">{status?.version || "Ready"}</div>
						</div>
					</div>
					<ThemeToggle />
				</div>
			</div>
		</aside>
	);
}
