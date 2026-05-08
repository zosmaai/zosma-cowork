import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { Clock, MessageSquare, Plus, Trash2 } from "lucide-react";

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
}

export function Sidebar({
	view,
	sessions,
	activeSessionId,
	onSessionSelect,
	onNewSession,
	onDeleteSession,
}: SidebarProps) {
	if (view === "files") {
		return (
			<div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
				<div className="flex items-center justify-between px-3 py-2">
					<span className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
						Explorer
					</span>
				</div>
				<ScrollArea className="flex-1 px-2">
					<div className="py-1 text-sm text-muted-foreground px-2">No folder open</div>
				</ScrollArea>
			</div>
		);
	}

	if (view === "settings") {
		return (
			<div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
				<div className="flex items-center justify-between px-3 py-2">
					<span className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
						Settings
					</span>
				</div>
				<ScrollArea className="flex-1 px-3 py-2">
					<div className="space-y-4">
						<div>
							<span className="text-xs text-muted-foreground mb-1.5 block">Theme</span>
							<div className="flex gap-2">
								<Button variant="secondary" size="sm" className="w-full">
									Dark
								</Button>
							</div>
						</div>
						<div>
							<span className="text-xs text-muted-foreground mb-1.5 block">Model Provider</span>
							<div className="text-sm text-foreground">GitHub Copilot</div>
						</div>
					</div>
				</ScrollArea>
			</div>
		);
	}

	if (view === "prompts" || view === "commands") {
		return (
			<div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
				<div className="flex items-center justify-between px-3 py-2">
					<span className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
						{view === "prompts" ? "Prompts" : "Commands"}
					</span>
				</div>
				<ScrollArea className="flex-1 px-2">
					<div className="py-1 text-sm text-muted-foreground px-2">Coming soon</div>
				</ScrollArea>
			</div>
		);
	}

	// Default: Chat sessions
	return (
		<div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
			<div className="flex items-center justify-between px-3 py-2">
				<span className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
					Sessions
				</span>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onNewSession}
					aria-label="New session"
					className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
				>
					<Plus className="w-4 h-4" />
				</Button>
			</div>
			<ScrollArea className="flex-1 px-2">
				<div className="space-y-0.5 py-1">
					{sessions.length === 0 ? (
						<div className="px-2 py-4 text-center">
							<div className="w-10 h-10 rounded-full bg-sidebar-accent mx-auto mb-2 flex items-center justify-center">
								<MessageSquare className="w-5 h-5 text-sidebar-foreground/50" />
							</div>
							<p className="text-xs text-sidebar-foreground/50">No sessions yet</p>
							<Button variant="ghost" size="sm" onClick={onNewSession} className="mt-2 text-xs">
								Start a session
							</Button>
						</div>
					) : (
						sessions.map((session) => (
							<button
								key={session.id}
								type="button"
								onClick={() => onSessionSelect(session.id)}
								className={cn(
									"w-full text-left px-2.5 py-2 rounded-md group transition-colors relative",
									activeSessionId === session.id
										? "bg-sidebar-accent text-sidebar-accent-foreground"
										: "hover:bg-sidebar-accent/50 text-sidebar-foreground/80",
								)}
							>
								<div className="flex items-start gap-2">
									<MessageSquare className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-1.5">
											<span className="text-sm font-medium truncate">{session.title}</span>
											{activeSessionId === session.id && (
												<Badge
													variant="outline"
													className="text-[10px] px-1 py-0 h-4 shrink-0 border-primary/30 text-primary"
												>
													Active
												</Badge>
											)}
										</div>
										<p className="text-xs text-sidebar-foreground/50 truncate mt-0.5">
											{session.lastMessage}
										</p>
										<div className="flex items-center gap-1 mt-1">
											<Clock className="w-3 h-3 text-sidebar-foreground/30" />
											<span className="text-[10px] text-sidebar-foreground/40">
												{formatTime(session.timestamp)}
											</span>
										</div>
									</div>
								</div>
								<button
									type="button"
									aria-label={`Delete session ${session.title}`}
									onClick={(e) => {
										e.stopPropagation();
										onDeleteSession(session.id);
									}}
									className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-sidebar-accent/80 transition-opacity"
								>
									<Trash2 className="w-3 h-3 text-sidebar-foreground/50 hover:text-destructive" />
								</button>
							</button>
						))
					)}
				</div>
			</ScrollArea>
		</div>
	);
}

function formatTime(ts: number): string {
	const now = Date.now();
	const diff = now - ts;
	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return new Date(ts).toLocaleDateString();
}
