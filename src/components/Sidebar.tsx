import {
	ChevronLeft,
	ChevronRight,
	FolderOpen,
	FolderPlus,
	Settings,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { SessionMode } from "@/types/session-runtime";
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
	/** Live runtime state — independent from `active` (selected row). */
	runtimeStatus?: "idle" | "running" | "error";
	runtimeError?: string;
	/** Durable Chat/Work product mode. */
	mode?: SessionMode;
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
	/** Manual rail collapse (Phase 2 — default remains expanded). */
	collapsed?: boolean;
	onCollapsedChange?: (collapsed: boolean) => void;
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
	collapsed = false,
	onCollapsedChange,
}: SidebarProps) {
	const reduced = useReducedMotion();
	const runningCount = sessions.filter((s) => s.runtimeStatus === "running").length;

	// Collapsed: a narrow icon rail — expand, new, open, running count,
	// settings. No session list, no search.
	if (collapsed) {
		return (
			<motion.div
				className="w-14 flex flex-col items-center gap-2 py-3 h-full bg-transparent"
				initial={reduced ? false : { x: -12, opacity: 0 }}
				animate={{ x: 0, opacity: 1 }}
				transition={{ duration: 0.32, ease: easeOutExpo }}
			>
				<motion.button
					type="button"
					onClick={() => onCollapsedChange?.(false)}
					aria-label="Expand sidebar"
					title="Expand sidebar"
					className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-accent transition-colors"
					whileHover={reduced ? {} : { scale: 1.05 }}
					whileTap={reduced ? {} : { scale: 0.95 }}
					transition={{ duration: 0.15, ease: easeOutExpo }}
				>
					<ChevronRight className="w-4 h-4" />
				</motion.button>

				<motion.button
					type="button"
					onClick={onNewSession}
					aria-label="New session"
					title="New session in your Zosma Cowork folder"
					className="flex items-center justify-center w-8 h-8 rounded-lg text-primary"
					whileHover={reduced ? {} : { scale: 1.05 }}
					whileTap={reduced ? {} : { scale: 0.95 }}
					transition={{ duration: 0.15, ease: easeOutExpo }}
				>
					<FolderPlus className="w-4 h-4" />
				</motion.button>

				<motion.button
					type="button"
					onClick={onOpenSession}
					aria-label="Open folder as session"
					title="Open a folder for the agent to work in"
					className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-accent transition-colors"
					whileHover={reduced ? {} : { scale: 1.05 }}
					whileTap={reduced ? {} : { scale: 0.95 }}
					transition={{ duration: 0.15, ease: easeOutExpo }}
				>
					<FolderOpen className="w-4 h-4" />
				</motion.button>

				{runningCount > 0 && (
					<span
						className="min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center"
						aria-label={`${runningCount} running ${runningCount === 1 ? "session" : "sessions"}`}
					>
						{runningCount}
					</span>
				)}

				<div className="flex-1" />

				<motion.button
					type="button"
					onClick={() => onChangeView("settings")}
					aria-label="Settings"
					title="Settings"
					className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-accent transition-colors"
					whileHover={reduced ? {} : { scale: 1.05 }}
					whileTap={reduced ? {} : { scale: 0.95 }}
					transition={{ duration: 0.15, ease: easeOutExpo }}
				>
					<Settings className="w-4 h-4" />
				</motion.button>
			</motion.div>
		);
	}

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

			{/* ── Collapse + Settings footer ── */}
			<div
				className="shrink-0 px-3 py-2 flex items-center gap-1"
				style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}
			>
				<motion.button
					type="button"
					onClick={() => onCollapsedChange?.(true)}
					aria-label="Collapse sidebar"
					title="Collapse sidebar"
					className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-sidebar-accent transition-colors"
					whileHover={reduced ? {} : { scale: 1.05 }}
					whileTap={reduced ? {} : { scale: 0.95 }}
					transition={{ duration: 0.15, ease: easeOutExpo }}
				>
					<ChevronLeft className="w-4 h-4" />
				</motion.button>
				<motion.button
					type="button"
					onClick={() => onChangeView("settings")}
					className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors"
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