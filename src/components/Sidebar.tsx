import { Settings } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ConversationSearch, type DeepSearchMatch } from "./ConversationSearch";

interface Session {
	id: string;
	title: string;
	lastMessage: string;
	timestamp: number;
	active?: boolean;
	/** Workspace folder this session ran in (drives folder grouping). */
	folder?: string;
	/** Pinned sessions float to the top of the list. */
	pinned?: boolean;
	/** Whether the title was manually set. */
	titleLocked?: boolean;
}

interface SidebarProps {
	sessions: Session[];
	activeSessionId?: string;
	onSessionSelect: (id: string) => void;
	onNewSession: () => void;
	/** Open an existing folder as a new session (folder picker). */
	onOpenSession: () => void;
	onDeleteSession: (id: string) => void;
	/** Open the rename popup for a session. */
	onRequestRename?: (id: string) => void;
	/** Pin/unpin a session. */
	onPinSession?: (id: string, pinned: boolean) => void;
	/** Deep content search across message bodies. */
	onDeepSearch?: (query: string) => Promise<DeepSearchMatch[]>;
	/** Show sessions from every folder instead of just the active one. */
	allFolders?: boolean;
	onToggleAllFolders?: () => void;
	onChangeView: (view: string) => void;
	/** The user's home dir, used to collapse session paths to `~`. */
	homeDir?: string;
}

// ease-out-expo
const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export function Sidebar({
	sessions,
	activeSessionId,
	onSessionSelect,
	onNewSession,
	onOpenSession,
	onDeleteSession,
	onRequestRename,
	onPinSession,
	onDeepSearch,
	allFolders,
	onToggleAllFolders,
	onChangeView,
	homeDir,
}: SidebarProps) {
	const reduced = useReducedMotion();

	return (
		<motion.div
			className="w-72 flex flex-col h-full bg-transparent"
			initial={reduced ? false : { x: -12, opacity: 0 }}
			animate={{ x: 0, opacity: 1 }}
			transition={{ duration: 0.32, ease: easeOutExpo }}
		>
			{/* ── Sessions ── */}
			<div className="flex-1 min-h-0 relative overflow-hidden">
				<ConversationSearch
					sessions={sessions}
					activeSessionId={activeSessionId}
					onSelect={onSessionSelect}
					onNewSession={onNewSession}
					onOpenSession={onOpenSession}
					onDeleteSession={onDeleteSession}
					onRequestRename={onRequestRename}
					onPinSession={onPinSession}
					onDeepSearch={onDeepSearch}
					allFolders={allFolders}
					onToggleAllFolders={onToggleAllFolders}
					homeDir={homeDir}
				/>
			</div>

			{/* ── Settings footer ── */}
			<div
				className="shrink-0 px-3 py-2"
				style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}
			>
				<motion.button
					type="button"
					onClick={() => onChangeView("settings")}
					className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors"
					style={{ color: "hsl(var(--sidebar-foreground) / 0.45)" }}
					whileHover={
						reduced
							? {}
							: {
									color: "hsl(var(--sidebar-foreground))",
									background: "hsl(var(--sidebar-accent) / 0.5)",
								}
					}
					whileTap={reduced ? {} : { scale: 0.97 }}
					transition={{ duration: 0.15, ease: easeOutExpo }}
				>
					<Settings className="w-3.5 h-3.5 shrink-0" />
					Settings
				</motion.button>
			</div>
		</motion.div>
	);
}
