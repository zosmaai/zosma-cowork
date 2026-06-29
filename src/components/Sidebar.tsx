import type { RoutinesStatus } from "@/hooks/useRoutinesExtension";
import type { CompletedTask, Task } from "@/types";
import { ListChecks, MessageSquare, Settings } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ConversationSearch, type DeepSearchMatch } from "./ConversationSearch";
import { TasksList } from "./TasksList";

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
	view: string;
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
	onChangeView: (view: string) => void;
	/** The user's home dir, used to collapse session paths to `~`. */
	homeDir?: string;

	// ── Tasks tab (#289) ──
	/** Scheduled tasks for the Tasks tab list. */
	tasks?: Task[];
	tasksLoading?: boolean;
	tasksError?: string | null;
	/** Currently selected task (drives the main-pane detail). */
	selectedTaskId?: string | null;
	onTaskSelect?: (id: string) => void;
	/** #300: Completed (non-recurring) tasks. */
	completedTasks?: CompletedTask[];
	completedTasksLoading?: boolean;
	/** pi-routines install/enable lifecycle for the Tasks tab. */
	routinesStatus?: RoutinesStatus;
	onRetryRoutines?: () => void;
}

const TABS = [
	{ id: "chats", label: "Cowork", Icon: MessageSquare },
	{ id: "tasks", label: "Tasks", Icon: ListChecks },
] as const;

// ease-out-expo
const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export function Sidebar({
	view,
	sessions,
	activeSessionId,
	onSessionSelect,
	onNewSession,
	onOpenSession,
	onDeleteSession,
	onRequestRename,
	onPinSession,
	onDeepSearch,
	onChangeView,
	homeDir,
	tasks = [],
	tasksLoading = false,
	tasksError = null,
	completedTasks = [],
	completedTasksLoading = false,
	selectedTaskId,
	onTaskSelect,
	routinesStatus = "ready",
	onRetryRoutines,
}: SidebarProps) {
	const reduced = useReducedMotion();
	const activeTab: "chats" | "tasks" = view === "tasks" ? "tasks" : "chats";

	return (
		<motion.div
			className="w-72 flex flex-col h-full bg-transparent"
			initial={reduced ? false : { x: -12, opacity: 0 }}
			animate={{ x: 0, opacity: 1 }}
			transition={{ duration: 0.32, ease: easeOutExpo }}
		>
			{/* ── Tab switcher ── */}
			<div className="px-3 pt-3 pb-0 shrink-0">
				<div
					className="relative flex items-center gap-px rounded-xl p-1"
					style={{ background: "hsl(var(--muted) / 0.5)" }}
				>
					{/* Sliding pill — always mounted, position driven by animate */}
					<motion.div
						className="absolute top-1 bottom-1 rounded-lg"
						animate={{
							left: activeTab === "chats" ? 4 : "50%",
							width: "calc(50% - 4px)",
						}}
						initial={false}
						transition={{ duration: reduced ? 0 : 0.22, ease: easeOutExpo }}
						style={{
							background: "hsl(var(--sidebar-background))",
							boxShadow: "0 1px 4px hsl(0 0% 0% / 0.12)",
						}}
					/>

					{TABS.map(({ id, label, Icon }) => (
						<button
							key={id}
							type="button"
							onClick={() => onChangeView(id)}
							className="relative z-10 flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
							style={{
								color:
									activeTab === id
										? "hsl(var(--sidebar-foreground))"
										: "hsl(var(--sidebar-foreground) / 0.45)",
							}}
						>
							<Icon className="w-3.5 h-3.5 shrink-0" />
							{label}
						</button>
					))}
				</div>
			</div>

			{/* ── Content area ── */}
			<div className="flex-1 min-h-0 relative overflow-hidden">
				<AnimatePresence mode="wait" initial={false}>
					{activeTab === "tasks" ? (
						<motion.div
							key="tasks"
							className="absolute inset-0"
							initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
							animate={{ opacity: 1, x: 0 }}
							exit={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
							transition={{ duration: 0.2, ease: easeOutExpo }}
						>
							<TasksPanel
								status={routinesStatus}
								onRetry={onRetryRoutines}
								tasks={tasks}
								loading={tasksLoading}
								error={tasksError}
								completedTasks={completedTasks}
								completedLoading={completedTasksLoading}
								selectedTaskId={selectedTaskId}
								onSelect={onTaskSelect ?? (() => {})}
							/>
						</motion.div>
					) : (
						<motion.div
							key="chats"
							className="absolute inset-0"
							initial={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
							animate={{ opacity: 1, x: 0 }}
							exit={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
							transition={{ duration: 0.2, ease: easeOutExpo }}
						>
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
								homeDir={homeDir}
							/>
						</motion.div>
					)}
				</AnimatePresence>
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

/**
 * TasksPanel — the Tasks tab content (#289, #300).
 *
 * pi-routines is vendored + bundled into the sidecar (inline factory), so it's
 * ready without any runtime install. The hook briefly reports `checking` before
 * the tab is active, during which we show a short "Checking Tasks…" state; once
 * `ready` we render the real `TasksList`. The `installing`/`error` branches are
 * defensive fallbacks that aren't reachable with the inline factory.
 */
function TasksPanel({
	status,
	onRetry,
	tasks,
	loading,
	error,
	completedTasks,
	completedLoading,
	selectedTaskId,
	onSelect,
}: {
	status: RoutinesStatus;
	onRetry?: () => void;
	tasks: Task[];
	loading: boolean;
	error: string | null;
	completedTasks?: CompletedTask[];
	completedLoading?: boolean;
	selectedTaskId?: string | null;
	onSelect: (id: string) => void;
}) {
	if (status === "checking" || status === "installing") {
		return <RoutinesSetup installing={status === "installing"} />;
	}
	if (status === "error") {
		return <RoutinesError onRetry={onRetry} />;
	}
	return (
		<TasksList
			tasks={tasks}
			loading={loading}
			error={error}
			completedTasks={completedTasks}
			completedLoading={completedLoading}
			selectedTaskId={selectedTaskId}
			onSelect={onSelect}
		/>
	);
}

/** Brief loading screen while the Tasks scheduler readiness is confirmed. */
function RoutinesSetup({ installing }: { installing: boolean }) {
	return (
		<div className="flex h-full flex-col items-center justify-center px-6 text-center">
			<div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
				<div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
			</div>
			<p className="text-sm font-medium text-sidebar-foreground">
				{installing ? "Setting up Tasks…" : "Checking Tasks…"}
			</p>
			<p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/50">
				{installing
					? "Installing the scheduler extension so the agent can run tasks on a schedule. This only happens once."
					: "Getting the Tasks scheduler ready."}
			</p>
		</div>
	);
}

/** Defensive fallback if the scheduler ever reports an error (unreachable with the inline factory). */
function RoutinesError({ onRetry }: { onRetry?: () => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center px-6 text-center">
			<div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
				<ListChecks className="h-5 w-5" />
			</div>
			<p className="text-sm font-medium text-sidebar-foreground">Couldn’t set up Tasks</p>
			<p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/50">
				The Tasks scheduler couldn’t be initialized. Try again, or restart the app if the problem
				persists.
			</p>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="mt-3 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50"
				>
					Try again
				</button>
			)}
		</div>
	);
}
