import { Clock, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

interface Session {
	id: string;
	title: string;
	lastMessage: string;
	timestamp: number;
}

interface ConversationSearchProps {
	sessions: Session[];
	onSelect: (id: string) => void;
	onNewSession: () => void;
	onDeleteSession: (id: string) => void;
	activeSessionId?: string;
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const diff = now.getTime() - d.getTime();
	if (diff < 60000) return "Just now";
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationSearch({
	sessions,
	onSelect,
	onNewSession,
	onDeleteSession,
	activeSessionId,
}: ConversationSearchProps) {
	const [query, setQuery] = useState("");

	const filtered = useMemo(() => {
		if (!query.trim()) return sessions;
		const q = query.toLowerCase();
		return sessions.filter(
			(s) => s.title.toLowerCase().includes(q) || s.lastMessage.toLowerCase().includes(q),
		);
	}, [sessions, query]);

	return (
		<div className="flex flex-col h-full">
			{/* Header with search and new button */}
			<div className="px-3 py-2 space-y-2">
				<div className="flex items-center justify-between">
					<span className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
						Sessions
					</span>
					<button
						type="button"
						onClick={onNewSession}
						aria-label="New session"
						className="p-1 rounded text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
					>
						<Plus className="w-4 h-4" />
					</button>
				</div>
				<div className="relative">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sidebar-foreground/30" />
					<input
						type="text"
						placeholder="Search conversations..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="w-full pl-7 pr-2 py-1.5 text-xs bg-sidebar-background border border-sidebar-border rounded text-sidebar-foreground placeholder:text-sidebar-foreground/30 focus:outline-none focus:border-sidebar-accent"
					/>
				</div>
			</div>

			{/* Sessions list */}
			<div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
				{filtered.length === 0 ? (
					<div className="px-2 py-8 text-center">
						<p className="text-xs text-sidebar-foreground/50">
							{query.trim() ? "No results" : "No sessions yet"}
						</p>
					</div>
				) : (
					filtered.map((session) => (
						<div key={session.id} className="relative group">
							<button
								type="button"
								onClick={() => onSelect(session.id)}
								className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
									activeSessionId === session.id
										? "bg-sidebar-accent text-sidebar-accent-foreground"
										: "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
								}`}
							>
								<div className="flex items-start gap-2">
									<MessageSquare className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />
									<div className="flex-1 min-w-0">
										<span className="text-sm font-medium truncate block">{session.title}</span>
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
							</button>
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
						</div>
					))
				)}
			</div>
		</div>
	);
}
