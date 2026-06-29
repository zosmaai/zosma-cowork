import { Tooltip } from "@/components/ui/tooltip";
import {
	Folder,
	FolderOpen,
	FolderPlus,
	MessagesSquare,
	Pencil,
	Pin,
	Search,
	Trash2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

interface Session {
	id: string;
	title: string;
	lastMessage: string;
	timestamp: number;
	active?: boolean;
	/** Workspace folder this session was opened in (shown VSCode-style). */
	folder?: string;
	/** Pinned sessions float to the top in a dedicated group. */
	pinned?: boolean;
	/** Whether the title was manually set (kept for parity with the header). */
	titleLocked?: boolean;
}

/** A deep-search hit: the matching session file + a contextual snippet. */
export interface DeepSearchMatch {
	file: string;
	snippet: string;
	matchCount: number;
}

/**
 * Render a session's folder the way editors show recent-project paths: home is
 * collapsed to `~`, paths under home become `~/sub/dir`, everything else is the
 * absolute path. Missing folder (legacy sessions) is treated as home.
 */
function displayPath(folder: string | undefined, homeDir: string | undefined): string {
	if (!folder) return "~";
	if (!homeDir) return folder;
	const home = homeDir.replace(/[/\\]+$/, "");
	if (folder === home) return "~";
	if (folder.startsWith(`${home}/`) || folder.startsWith(`${home}\\`)) {
		return `~/${folder.slice(home.length + 1).replace(/\\/g, "/")}`;
	}
	return folder;
}

interface ConversationSearchProps {
	sessions: Session[];
	onSelect: (id: string) => void;
	/** Start a fresh session in the default ZosmaCowork folder (no prompt). */
	onNewSession: () => void;
	/** Pick a folder for the agent to work in, then start a session there. */
	onOpenSession: () => void;
	onDeleteSession: (id: string) => void;
	/** Open the rename popup for a session (mirrors the delete confirm flow). */
	onRequestRename?: (id: string) => void;
	/** Pin/unpin a session (sorts it to the top). */
	onPinSession?: (id: string, pinned: boolean) => void;
	/**
	 * Deep content search across message bodies. When provided, the search box
	 * matches real conversation text — not just the title placeholder.
	 */
	onDeepSearch?: (query: string) => Promise<DeepSearchMatch[]>;
	activeSessionId?: string;
	/** The user's home dir, used to collapse session paths to `~`. */
	homeDir?: string;
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const diff = now.getTime() - d.getTime();
	if (diff < 60_000) return "Just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const easeOutExpo = [0.16, 1, 0.3, 1] as const;

// Shared look for the hover-revealed action buttons: small circular "raised"
// pills with a subtle drop shadow so they float above the row.
const RAISED_BTN = "flex items-center justify-center w-7 h-7 rounded-full border border-border/60";
const RAISED_STYLE = {
	boxShadow: "0 2px 5px hsl(0 0% 0% / 0.16), 0 1px 1.5px hsl(0 0% 0% / 0.10)",
} as const;
const RAISED_HOVER_SHADOW = "0 5px 12px hsl(0 0% 0% / 0.22), 0 2px 4px hsl(0 0% 0% / 0.14)";

export function ConversationSearch({
	sessions,
	onSelect,
	onNewSession,
	onOpenSession,
	onDeleteSession,
	onRequestRename,
	onPinSession,
	onDeepSearch,
	activeSessionId,
	homeDir,
}: ConversationSearchProps) {
	const [query, setQuery] = useState("");
	const [focused, setFocused] = useState(false);
	const reduced = useReducedMotion();
	const inputRef = useRef<HTMLInputElement>(null);
	// Infinite-scroll pagination: render PAGE_SIZE rows, grow as a sentinel near
	// the bottom scrolls into view. Search/filtering still runs over ALL sessions
	// — this only caps how many of the matches are mounted at once.
	const PAGE_SIZE = 10;
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const scrollRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);

	// Deep search runs in the sidecar (greps message bodies). We debounce it and
	// merge its file hits into the local title/preview filter. `deepIds === null`
	// means "no deep search active" so we fall back to the synchronous filter.
	const [deepIds, setDeepIds] = useState<Set<string> | null>(null);
	const [deepSnippets, setDeepSnippets] = useState<Map<string, string>>(new Map());
	const [deepLoading, setDeepLoading] = useState(false);

	useEffect(() => {
		const q = query.trim();
		if (!onDeepSearch || q.length < 2) {
			setDeepIds(null);
			setDeepSnippets(new Map());
			setDeepLoading(false);
			return;
		}
		let cancelled = false;
		setDeepLoading(true);
		const handle = setTimeout(async () => {
			try {
				const matches = await onDeepSearch(q);
				if (cancelled) return;
				setDeepIds(new Set(matches.map((m) => m.file)));
				setDeepSnippets(new Map(matches.map((m) => [m.file, m.snippet])));
			} catch {
				if (!cancelled) {
					setDeepIds(null);
					setDeepSnippets(new Map());
				}
			} finally {
				if (!cancelled) setDeepLoading(false);
			}
		}, 180);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
	}, [query, onDeepSearch]);

	// Keyboard shortcut: Cmd/Ctrl+K focuses the list search (chat-client staple).
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return sessions;
		return sessions.filter((s) => {
			const local = s.title.toLowerCase().includes(q) || s.lastMessage.toLowerCase().includes(q);
			const deep = deepIds?.has(s.id) ?? false;
			return local || deep;
		});
	}, [sessions, query, deepIds]);

	// Reset paging to the top whenever the result set changes (new query / deep
	// search hits) so a fresh search always starts from the most relevant rows.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on result-set change
	useEffect(() => {
		setVisibleCount(PAGE_SIZE);
		scrollRef.current?.scrollTo?.({ top: 0 });
	}, [query, deepIds]);

	// Only the first `visibleCount` matches are mounted; the rest reveal on scroll.
	const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
	const hasMore = visibleCount < filtered.length;

	const pinned = useMemo(() => visible.filter((s) => s.pinned), [visible]);
	const unpinned = useMemo(() => visible.filter((s) => !s.pinned), [visible]);

	// Grow the page when the bottom sentinel enters the scroll viewport.
	useEffect(() => {
		if (!hasMore) return;
		const root = scrollRef.current;
		const sentinel = sentinelRef.current;
		if (!root || !sentinel) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					setVisibleCount((c) => c + PAGE_SIZE);
				}
			},
			{ root, rootMargin: "120px" },
		);
		io.observe(sentinel);
		return () => io.disconnect();
	}, [hasMore]);

	const renderRow = (session: Session, i: number) => (
		<SessionRow
			key={session.id}
			session={session}
			isActive={session.id === activeSessionId}
			index={i}
			reduced={!!reduced}
			homeDir={homeDir}
			snippet={deepSnippets.get(session.id)}
			onSelect={onSelect}
			onDelete={onDeleteSession}
			onRequestRename={onRequestRename}
			onPin={onPinSession}
		/>
	);

	return (
		<div className="flex flex-col h-full min-h-0">
			{/* ── Header ── */}
			<div className="flex items-center justify-between px-4 pt-3 pb-2">
				<span
					className="text-[10px] font-semibold uppercase tracking-widest"
					style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
				>
					Sessions
				</span>
				<div className="flex items-center gap-1.5">
					<motion.button
						type="button"
						onClick={onNewSession}
						aria-label="New session"
						title="New session in your ZosmaCowork folder"
						className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium"
						style={{ color: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.08)" }}
						whileHover={reduced ? {} : { scale: 1.04, background: "hsl(var(--primary) / 0.15)" }}
						whileTap={reduced ? {} : { scale: 0.96 }}
						transition={{ duration: 0.15, ease: easeOutExpo }}
					>
						<FolderPlus className="w-3.5 h-3.5" />
						New
					</motion.button>
					<motion.button
						type="button"
						onClick={onOpenSession}
						aria-label="Open folder as session"
						title="Open a folder for the agent to work in"
						className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground bg-muted hover:bg-muted/70 hover:text-foreground transition-colors"
						whileHover={reduced ? {} : { scale: 1.04 }}
						whileTap={reduced ? {} : { scale: 0.96 }}
						transition={{ duration: 0.15, ease: easeOutExpo }}
					>
						<FolderOpen className="w-3.5 h-3.5" />
						Open
					</motion.button>
				</div>
			</div>

			{/* ── Search ── */}
			<div className="px-3 pb-2">
				<motion.div
					className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 border"
					animate={
						reduced
							? {}
							: {
									borderColor: focused ? "hsl(var(--primary) / 0.5)" : "hsl(var(--border))",
									background: focused ? "hsl(var(--primary) / 0.04)" : "hsl(var(--muted) / 0.5)",
								}
					}
					transition={{ duration: 0.18, ease: easeOutExpo }}
					style={{
						borderColor: "hsl(var(--border))",
						background: "hsl(var(--muted) / 0.5)",
					}}
				>
					<Search
						className="w-3 h-3 shrink-0"
						style={{
							color: focused ? "hsl(var(--primary) / 0.7)" : "hsl(var(--muted-foreground) / 0.4)",
						}}
					/>
					<input
						ref={inputRef}
						type="text"
						placeholder="Search conversations..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						className="flex-1 bg-transparent text-xs text-foreground focus:outline-none"
					/>
					{/* Deep-search spinner — subtle, only while greping bodies */}
					<AnimatePresence>
						{deepLoading && (
							<motion.span
								key="spin"
								className="shrink-0 w-3 h-3 rounded-full border border-primary/30 border-t-primary"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1, rotate: 360 }}
								exit={{ opacity: 0 }}
								transition={{
									rotate: { duration: 0.7, repeat: Number.POSITIVE_INFINITY, ease: "linear" },
									opacity: { duration: 0.15 },
								}}
							/>
						)}
					</AnimatePresence>
					<AnimatePresence>
						{query && (
							<motion.button
								type="button"
								aria-label="Clear search"
								onClick={() => {
									setQuery("");
									inputRef.current?.focus();
								}}
								className="shrink-0 rounded text-[10px] px-1 py-px"
								style={{
									color: "hsl(var(--muted-foreground) / 0.5)",
									background: "hsl(var(--muted))",
								}}
								initial={{ opacity: 0, scale: 0.7 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.7 }}
								transition={{ duration: 0.12, ease: easeOutExpo }}
							>
								✕
							</motion.button>
						)}
					</AnimatePresence>
				</motion.div>
			</div>

			{/* ── Session list ── */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-2 pb-2 space-y-px">
				{/* Empty state — AnimatePresence only here so it fades in/out */}
				<AnimatePresence>
					{filtered.length === 0 && (
						<motion.div
							key="empty"
							className="flex flex-col items-center justify-center py-12 gap-3"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.2 }}
						>
							<motion.div
								animate={reduced ? {} : { scale: [1, 1.06, 1] }}
								transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
							>
								<MessagesSquare
									className="w-7 h-7"
									style={{ color: "hsl(var(--muted-foreground) / 0.2)" }}
								/>
							</motion.div>
							<p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
								{query.trim() ? "No results" : "No sessions yet"}
							</p>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Pinned group — only when at least one pinned session is visible */}
				{pinned.length > 0 && (
					<>
						<div
							className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[9px] font-semibold uppercase tracking-widest"
							style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}
						>
							<Pin className="w-2.5 h-2.5" fill="currentColor" />
							Pinned
						</div>
						{pinned.map((session, i) => renderRow(session, i))}
						{unpinned.length > 0 && (
							<div
								className="px-2 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-widest"
								style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}
							>
								Recent
							</div>
						)}
					</>
				)}

				{/* Rows — no AnimatePresence wrapper so filtered-out rows leave DOM
				    immediately; this keeps test assertions reliable */}
				{unpinned.map((session, i) => renderRow(session, i))}

				{/* Infinite-scroll sentinel — grows the page as it nears the viewport */}
				{hasMore && (
					<div ref={sentinelRef} className="flex items-center justify-center py-3" aria-hidden>
						<motion.span
							className="w-4 h-4 rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/50"
							animate={reduced ? {} : { rotate: 360 }}
							transition={{ duration: 0.8, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────
// SessionRow — isolated component so layoutId scopes cleanly
// ─────────────────────────────────────────────────────────────────
interface SessionRowProps {
	session: Session;
	isActive: boolean;
	index: number;
	reduced: boolean;
	homeDir?: string;
	/** Deep-search snippet shown in place of the preview when searching. */
	snippet?: string;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
	/** Open the rename popup for this session. */
	onRequestRename?: (id: string) => void;
	onPin?: (id: string, pinned: boolean) => void;
}

function SessionRow({
	session,
	isActive,
	index,
	reduced,
	homeDir,
	snippet,
	onSelect,
	onDelete,
	onRequestRename,
	onPin,
}: SessionRowProps) {
	const [hovered, setHovered] = useState(false);
	const [focusWithin, setFocusWithin] = useState(false);
	const path = displayPath(session.folder, homeDir);

	// Actions are OVERLAID on the right edge (not stacked below) so the row keeps
	// a constant height — no resize/jump when you hover. They reveal on hover or
	// keyboard focus; buttons stay mounted so the list is keyboard-reachable and
	// predictable for tests.
	const showActions = hovered || focusWithin;

	return (
		<motion.div
			// `layout="position"` (not bare `layout`) animates only position changes
			// — e.g. rows sliding when a session is pinned. Bare `layout` would also
			// animate SIZE by scaling, which squished/distorted the row when toggling
			// into the inline rename field. Position-only keeps reorder smooth while
			// the rename swap happens instantly with no jank.
			layout="position"
			className="relative rounded-lg transition-colors"
			initial={reduced ? false : { opacity: 0, x: -8 }}
			animate={{ opacity: 1, x: 0 }}
			transition={{
				duration: 0.22,
				ease: [0.16, 1, 0.3, 1],
				delay: reduced ? 0 : Math.min(index * 0.035, 0.28),
			}}
			onHoverStart={() => setHovered(true)}
			onHoverEnd={() => setHovered(false)}
			onFocus={() => setFocusWithin(true)}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusWithin(false);
			}}
			// Single background lives on the container so the content row and the
			// action row read as ONE surface (no double-tint seam on hover).
			style={{
				background: isActive
					? "hsl(var(--sidebar-accent))"
					: hovered
						? "hsl(var(--accent) / 0.5)"
						: undefined,
			}}
		>
			{/* Active accent bar */}
			<AnimatePresence>
				{isActive && (
					<motion.div
						layoutId="active-bar"
						className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-primary"
						initial={{ scaleY: 0, opacity: 0 }}
						animate={{ scaleY: 1, opacity: 1 }}
						exit={{ scaleY: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
					/>
				)}
			</AnimatePresence>

			<>
				{/* Row button — bg-sidebar-accent class on active for test compat.
					    Double-click opens the rename popup (same as the edit button). */}
				<motion.button
					type="button"
					onClick={() => onSelect(session.id)}
					onDoubleClick={() => onRequestRename?.(session.id)}
					className={`w-full text-left pl-4 pr-3 pt-2.5 pb-1.5 rounded-t-lg ${
						isActive ? "bg-sidebar-accent" : ""
					}`}
					whileTap={reduced ? {} : { scale: 0.985 }}
					transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
				>
					{/* Title */}
					<span
						className={`flex items-center gap-1 text-[12px] truncate leading-snug ${
							isActive ? "font-semibold" : "font-medium"
						}`}
						style={{
							color: isActive ? "hsl(var(--foreground))" : "hsl(var(--foreground) / 0.8)",
						}}
					>
						{session.pinned && (
							<Pin
								className="w-2.5 h-2.5 shrink-0"
								fill="currentColor"
								style={{ color: "hsl(var(--primary) / 0.7)" }}
							/>
						)}
						<span className="truncate">{session.title}</span>
					</span>

					{/* Folder path — where this session was opened (VSCode-style) */}
					<span
						className="flex items-center gap-1 mt-0.5 text-[10px] truncate"
						style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
						title={session.folder || path}
					>
						<Folder className="w-2.5 h-2.5 shrink-0" />
						<span className="truncate">{path}</span>
					</span>

					{/* Last message / search snippet + timestamp */}
					<span className="flex items-center gap-1.5 mt-0.5">
						<span
							className="text-[11px] truncate flex-1"
							style={{ color: "hsl(var(--muted-foreground) / 0.55)" }}
						>
							{snippet || session.lastMessage}
						</span>
						<span
							className="text-[10px] shrink-0 tabular-nums"
							style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}
						>
							{formatTime(session.timestamp)}
						</span>
					</span>
				</motion.button>

				{/* Action row — sits BELOW the description in normal flow and ALWAYS
					    reserves its height, so the row never resizes. We only toggle its
					    visibility (opacity) on hover / focus; buttons stay mounted. */}
				<motion.div
					className="flex items-center justify-end gap-1.5 px-2 pb-1.5"
					initial={false}
					animate={{ opacity: showActions ? 1 : 0 }}
					transition={{ duration: reduced ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
					style={{ pointerEvents: showActions ? "auto" : "none" }}
				>
					{onPin && (
						<Tooltip content={session.pinned ? "Unpin chat" : "Pin chat"}>
							<motion.button
								type="button"
								aria-label={`${session.pinned ? "Unpin" : "Pin"} session ${session.title}`}
								onClick={(e) => {
									e.stopPropagation();
									onPin(session.id, !session.pinned);
								}}
								className={`${RAISED_BTN} ${
									session.pinned
										? "bg-primary/15 text-primary"
										: "bg-background text-muted-foreground"
								}`}
								style={RAISED_STYLE}
								tabIndex={showActions ? 0 : -1}
								whileHover={reduced ? {} : { scale: 1.14, y: -1, boxShadow: RAISED_HOVER_SHADOW }}
								whileTap={reduced ? {} : { scale: 0.9 }}
								transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
							>
								<Pin className="w-3 h-3" fill={session.pinned ? "currentColor" : "none"} />
							</motion.button>
						</Tooltip>
					)}
					{onRequestRename && (
						<Tooltip content="Rename chat">
							<motion.button
								type="button"
								aria-label={`Rename session ${session.title}`}
								onClick={(e) => {
									e.stopPropagation();
									onRequestRename(session.id);
								}}
								className={`${RAISED_BTN} bg-background text-muted-foreground`}
								style={RAISED_STYLE}
								tabIndex={showActions ? 0 : -1}
								whileHover={reduced ? {} : { scale: 1.14, y: -1, boxShadow: RAISED_HOVER_SHADOW }}
								whileTap={reduced ? {} : { scale: 0.9 }}
								transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
							>
								<Pencil className="w-3 h-3" />
							</motion.button>
						</Tooltip>
					)}
					<Tooltip content="Delete chat">
						<motion.button
							type="button"
							aria-label={`Delete session ${session.title}`}
							onClick={(e) => {
								e.stopPropagation();
								onDelete(session.id);
							}}
							className={`${RAISED_BTN} bg-background text-destructive`}
							style={RAISED_STYLE}
							tabIndex={showActions ? 0 : -1}
							whileHover={reduced ? {} : { scale: 1.14, y: -1, boxShadow: RAISED_HOVER_SHADOW }}
							whileTap={reduced ? {} : { scale: 0.9 }}
							transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
						>
							<Trash2 className="w-3 h-3" />
						</motion.button>
					</Tooltip>
				</motion.div>
			</>
		</motion.div>
	);
}
