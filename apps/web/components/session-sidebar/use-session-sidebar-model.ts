"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import {
	getProjectActivity,
	getRecentProjects,
	sessionsForProject,
} from "@/lib/project-groups";
import type { SessionInfo } from "@/lib/types";
import {
	searchWorkspaces,
	transientWorkspace,
	type ValidatedCwd,
	type WorkspaceBrowserRow,
	workspaceActivationCwd,
} from "@/lib/workspace-browser";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { agentService } from "@/services/agent.service";
import { sessionsService } from "@/services/sessions.service";
import { TAGS } from "@/services/tags";
import type { FileExplorerHandle } from "../FileExplorer";
import type { WorktreeEntry } from "./utils";
import { saveUnreadSessionIds } from "./utils";

type FileExplorerOpenHandler = (
	filePath: string,
	fileName: string,
	options?: { sourceSessionId?: string | null; modeHint?: "diff" },
) => void;

export type { FileExplorerOpenHandler, WorktreeEntry };

export interface SessionSidebarModelProps {
	selectedSessionId: string | null;
	onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
	onNewSession?: (sessionId: string, cwd: string) => void;
	initialSessionId?: string | null;
	skipInitialProjectSelection?: boolean;
	onInitialRestoreDone?: () => void;
	refreshKey?: number;
	onSessionDeleted?: (sessionId: string) => void;
	selectedCwd?: string | null;
	onCwdChange?: (
		cwd: string | null,
		projectRoot?: string | null,
		projectKey?: string | null,
	) => void;
	onOpenFile?: FileExplorerOpenHandler;
	explorerRefreshKey?: number;
	onExplorerRefresh?: () => void;
	onAtMention?: (relativePath: string, isDir: boolean) => void;
	onAtMentions?: (relativePaths: string[]) => void;
	onBackgroundTaskDone?: () => void;
	onRunningSessionIdsChange?: (ids: Set<string>) => void;
	onAddFolder?: () => void;
	onSelectFolder?: (path: string) => void;
	validatedProject?: ValidatedCwd | null;
	rail?: boolean;
}

export interface ProjectSelection {
	root: string;
	key: string;
}

export interface WorktreeState {
	forCwd: string;
	projectRoot: string;
	projectKey: string;
	isGit: boolean;
	isTopLevel: boolean;
	currentWorktreePath: string | null;
	worktrees: WorktreeEntry[];
}

/**
 * All state, side effects, event handlers, and derived values for the
 * session sidebar. Rendering stays a pure function of this returned object.
 */
export function useSessionSidebarModel(props: SessionSidebarModelProps) {
	const {
		selectedSessionId,
		onSelectSession,
		onNewSession,
		initialSessionId,
		skipInitialProjectSelection,
		onInitialRestoreDone,
		refreshKey,
		onSessionDeleted,
		selectedCwd: selectedCwdProp,
		onCwdChange,
		onOpenFile,
		explorerRefreshKey,
		onExplorerRefresh,
		onAtMention,
		onAtMentions,
		onBackgroundTaskDone,
		onRunningSessionIdsChange,
		onAddFolder,
		onSelectFolder,
		validatedProject,
	} = props;

	const { t } = useI18n();

	const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
	const [homeDir, setHomeDir] = useState<string>("");
	const [wtFilter, setWtFilter] = useState("");
	const [workspaceQuery, setWorkspaceQuery] = useState("");
	const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
	const [expandedWorkspaceKeys, setExpandedWorkspaceKeys] = useState<
		Set<string>
	>(() => new Set());
	const folderPopoverRef = useRef<HTMLDivElement>(null);
	const folderTriggerRef = useRef<HTMLButtonElement>(null);

	// Worktree switcher state
	const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(
		null,
	);
	const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
	const [wtNewOpen, setWtNewOpen] = useState(false);
	const [wtNewBranch, setWtNewBranch] = useState("");
	const [wtError, setWtError] = useState<string | null>(null);
	const [wtBusy, setWtBusy] = useState(false);
	const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
	const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(
		null,
	);
	const wtDropdownRef = useRef<HTMLDivElement>(null);
	const wtNewInputRef = useRef<HTMLInputElement>(null);
	const [wtRefreshKey, setWtRefreshKey] = useState(0);

	const [explorerOpen, setExplorerOpen] = useState(true);
	const [explorerKey, setExplorerKey] = useState(0);
	const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
	const [changesCount, setChangesCount] = useState(0);
	const [changesCollapsed, setChangesCollapsed] = useState(true);
	const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
	const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
	const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
	const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const fileExplorerRef = useRef<FileExplorerHandle>(null);

	const queryClient = useQueryClient();
	const sessionsQuery = useQuery(sessionsService.listQueryOptions());
	const runningQuery = useQuery(agentService.runningQueryOptions());

	const loadSessions = useCallback(
	async (showLoading = false, force = false) => {
		// Session list is a TanStack Query now: invalidation marks it stale and
		// the mounted sidebar refetches (deduped — concurrent callers share one
		// request). `force` (a full disk re-scan) is intentionally dead: the
		// daemon registers new sessions in-memory at spawn (supplemental entry
		// + path cache), so nothing client-side needs to pay for a scan.
		void force;
		await queryClient.invalidateQueries({ queryKey: TAGS.sessions.all });
		if (!showLoading) {
			setSessionRefreshDone(true);
			if (sessionRefreshTimerRef.current)
				clearTimeout(sessionRefreshTimerRef.current);
			sessionRefreshTimerRef.current = setTimeout(
				() => setSessionRefreshDone(false),
				2000,
			);
		}
	}, [queryClient]);

	// refreshKey churn (session created / agent ended) = mark the cached reads
	// stale instead of fetching immediately; the queries refetch once.
	useEffect(() => {
		queryClient.invalidateQueries({ queryKey: TAGS.sessions.all });
		queryClient.invalidateQueries({ queryKey: TAGS.agent.running });
	}, [queryClient, refreshKey]);

	// Derived from queries; running ids stay identity-stable so AppShell /
	// ChatWindow don't re-render on every poll tick.
	const allSessions: SessionInfo[] = useMemo(
		() => sessionsQuery.data?.sessions ?? [],
		[sessionsQuery.data],
	);
	const loading = sessionsQuery.isPending;
	const error =
		sessionsQuery.error instanceof Error ? sessionsQuery.error.message : null;

	useEffect(() => {
		setRunningSessionIds((prev) => {
			const next = new Set(runningQuery.data ?? []);
			if (prev.size === next.size && [...prev].every((id) => next.has(id)))
				return prev;
			return next;
		});
	}, [runningQuery.data]);

	// Restore explorer-open preference after hydration so a collapsed explorer
	// stays collapsed on reload (browser storage unavailable during SSR).
	useEffect(() => {
		setExplorerOpen(loadExplorerOpen());
	}, []);

	// Persist unread markers so they survive a browser refresh before the user
	// has actually opened the completed session.
	useEffect(() => {
		saveUnreadSessionIds(unreadSessionIds);
	}, [unreadSessionIds]);

	useEffect(() => {
		onRunningSessionIdsChange?.(runningSessionIds);
	}, [onRunningSessionIdsChange, runningSessionIds]);

	useEffect(() => {
		const previous = previousRunningSessionIdsRef.current;
		const completedInBackground = [...previous].filter(
			(id) => !runningSessionIds.has(id) && id !== selectedSessionId,
		);
		const newlyRunning = [...runningSessionIds].filter(
			(id) => !previous.has(id),
		);

		if (completedInBackground.length > 0 || newlyRunning.length > 0) {
			setUnreadSessionIds((prev) => {
				const next = new Set(prev);
				runningSessionIds.forEach((id) => next.delete(id));
				completedInBackground.forEach((id) => next.add(id));
				return next;
			});
		}
		// No forced re-scan here (old code: loadSessions(false, true) when a run
		// appeared/finished — a multi-second disk scan exactly at turn end). The
		// daemon registers new sessions in-memory at spawn (supplemental entry +
		// path cache), so the cached list + running poll cover visibility.
		if (completedInBackground.length > 0) {
			onBackgroundTaskDone?.();
		}

		previousRunningSessionIdsRef.current = runningSessionIds;
	}, [runningSessionIds, selectedSessionId, onBackgroundTaskDone]);

	useEffect(() => {
		if (!selectedSessionId) return;
		setUnreadSessionIds((prev) => {
			if (!prev.has(selectedSessionId)) return prev;
			const next = new Set(prev);
			next.delete(selectedSessionId);
			return next;
		});
	}, [selectedSessionId]);

	useEffect(() => {
		if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
	}, [explorerRefreshKey]);

	useEffect(() => {
		fetch("/api/home")
			.then((r) => r.json())
			.then((d: { home?: string }) => {
				if (d.home) setHomeDir(d.home);
			})
			.catch(() => {});
	}, []);

	const restoredRef = useRef(false);

	const projectSelection = useCallback(
		(root: string, key: string): ProjectSelection => ({ root, key }),
		[],
	);

	/** Resolve both display root and stable identity from server-provided data. */
	const projectFor = useCallback(
		(cwd: string | null): ProjectSelection | null => {
			if (!cwd) return null;
			if (validatedProject?.cwd === cwd) {
				return projectSelection(validatedProject.root, validatedProject.key);
			}
			if (worktreeState && worktreeState.forCwd === cwd) {
				return projectSelection(
					worktreeState.projectRoot,
					worktreeState.projectKey,
				);
			}
			if (worktreeState?.worktrees.some((w) => w.path === cwd)) {
				return projectSelection(
					worktreeState.projectRoot,
					worktreeState.projectKey,
				);
			}
			const match = allSessions.find(
				(session) =>
					session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd,
			);
			return match
				? projectSelection(
						match.projectRoot ?? match.cwd,
						workspaceKeyOf(match),
					)
				: projectSelection(cwd, cwd);
		},
		[validatedProject, worktreeState, allSessions, projectSelection],
	);

	const lastNotifiedProjectRef = useRef<{
		cwd: string | null;
		key: string | null;
	} | null>(null);
	useEffect(() => {
		const project = projectFor(selectedCwd);
		const previous = lastNotifiedProjectRef.current;
		if (
			previous?.cwd === selectedCwd &&
			previous.key === (project?.key ?? null)
		)
			return;
		lastNotifiedProjectRef.current = {
			cwd: selectedCwd,
			key: project?.key ?? null,
		};
		onCwdChange?.(selectedCwd, project?.root ?? null, project?.key ?? null);
	}, [selectedCwd, onCwdChange, projectFor]);

	const lastSyncedCwdPropRef = useRef<string | null>(null);
	useEffect(() => {
		if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
			lastSyncedCwdPropRef.current = selectedCwdProp;
			setSelectedCwd(selectedCwdProp);
		}
	}, [selectedCwdProp]);

	// Load worktrees for the current effective cwd
	useLayoutEffect(() => {
		if (!selectedCwd) {
			setWorktreeState(null);
			setWorktreeLoadingCwd(null);
			return;
		}
		let cancelled = false;
		setWorktreeLoadingCwd(selectedCwd);
		fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
			.then((r) => r.json())
			.then(
				(d: {
					projectRoot?: string;
					projectKey?: string;
					isGit?: boolean;
					isTopLevel?: boolean;
					currentWorktreePath?: string | null;
					worktrees?: WorktreeEntry[];
					error?: string;
				}) => {
					if (cancelled) return;
					setWorktreeLoadingCwd(null);
					if (d.error || !d.projectRoot) {
						setWorktreeState(null);
						return;
					}
					setWorktreeState({
						forCwd: selectedCwd,
						projectRoot: d.projectRoot,
						projectKey: d.projectKey ?? d.projectRoot,
						isGit: d.isGit ?? false,
						isTopLevel: d.isTopLevel ?? false,
						currentWorktreePath: d.currentWorktreePath ?? null,
						worktrees: d.worktrees ?? [],
					});
				},
			)
			.catch(() => {
				if (!cancelled) {
					setWorktreeLoadingCwd(null);
					setWorktreeState(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [selectedCwd, wtRefreshKey, refreshKey]);

	// Auto-select cwd and restore session from URL on first load
	useEffect(() => {
		if (allSessions.length === 0 || skipInitialProjectSelection) return;

		if (selectedCwd === null) {
			if (initialSessionId && !restoredRef.current) {
				restoredRef.current = true;
				const target = allSessions.find((s) => s.id === initialSessionId);
				if (target) {
					setSelectedCwd(target.cwd);
					onSelectSession(target, true);
					return;
				}
				onInitialRestoreDone?.();
			}
			const projects = getRecentProjects(allSessions);
			if (projects.length > 0) setSelectedCwd(projects[0].root);
		}
	}, [
		allSessions,
		selectedCwd,
		initialSessionId,
		skipInitialProjectSelection,
		onSelectSession,
		onInitialRestoreDone,
	]);

	const currentWorktree = worktreeState
		? (worktreeState.worktrees.find(
				(worktree) => worktree.path === selectedCwd,
			) ??
			(worktreeState.forCwd === selectedCwd && worktreeState.currentWorktreePath
				? worktreeState.worktrees.find(
						(worktree) => worktree.path === worktreeState.currentWorktreePath,
					)
				: undefined) ??
			worktreeState.worktrees.find((worktree) => worktree.isMain))
		: undefined;
	const currentWorktreePath = currentWorktree?.path ?? null;

	const handleSelectDefaultCwd = useCallback(async () => {
		setFolderPopoverOpen(false);
		try {
			const res = await fetch("/api/default-cwd", { method: "POST" });
			const data = (await res.json()) as { cwd?: string; error?: string };
			if (data.cwd) onSelectFolder?.(data.cwd);
		} catch {
			// ignore
		}
	}, [onSelectFolder]);

	const handleCreateWorktree = useCallback(async () => {
		const branch = wtNewBranch.trim();
		if (!branch || wtBusy || !worktreeState) return;
		setWtBusy(true);
		setWtError(null);
		try {
			const res = await fetch("/api/worktrees", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
			});
			const data = (await res.json().catch(() => ({}))) as {
				path?: string;
				error?: string;
			};
			if (!res.ok || data.error || !data.path) {
				setWtError(data.error ?? `HTTP ${res.status}`);
				return;
			}
			setWtNewOpen(false);
			setWtNewBranch("");
			setWtDropdownOpen(false);
			setWorktreeState((prev) =>
				prev
					? {
							...prev,
							forCwd: data.path!,
							currentWorktreePath: data.path!,
							worktrees: [
								...prev.worktrees,
								{ path: data.path!, branch, isMain: false },
							],
						}
					: prev,
			);
			setSelectedCwd(data.path);
			setWtRefreshKey((k) => k + 1);
		} catch (e) {
			setWtError(e instanceof Error ? e.message : String(e));
		} finally {
			setWtBusy(false);
		}
	}, [wtNewBranch, wtBusy, worktreeState]);

	const handleRemoveWorktree = useCallback(
		async (path: string, force: boolean) => {
			if (!worktreeState || wtBusy) return;
			setWtBusy(true);
			setWtError(null);
			try {
				const res = await fetch("/api/worktrees", {
					method: "DELETE",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
				});
				const data = (await res.json().catch(() => ({}))) as {
					error?: string;
					dirty?: boolean;
				};
				if (!res.ok) {
					if (data.dirty && !force) {
						setWtConfirmRemove(path);
						return;
					}
					setWtError(data.error ?? `HTTP ${res.status}`);
					return;
				}
				setWtConfirmRemove(null);
				if (currentWorktreePath === path)
					setSelectedCwd(worktreeState.projectRoot);
				setWtRefreshKey((k) => k + 1);
			} catch (e) {
				setWtError(e instanceof Error ? e.message : String(e));
			} finally {
				setWtBusy(false);
			}
		},
		[worktreeState, wtBusy, currentWorktreePath],
	);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (
				folderPopoverRef.current &&
				!folderPopoverRef.current.contains(e.target as Node)
			) {
				setFolderPopoverOpen(false);
			}
			if (
				wtDropdownRef.current &&
				!wtDropdownRef.current.contains(e.target as Node)
			) {
				setWtDropdownOpen(false);
				setWtNewOpen(false);
				setWtNewBranch("");
				setWtError(null);
				setWtConfirmRemove(null);
				setWtFilter("");
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	const handleSelectSessionFromList = useCallback(
		(s: SessionInfo) => {
			if (s.cwd) setSelectedCwd(s.cwd);
			onSelectSession(s);
		},
		[onSelectSession],
	);

	const handleNewSession = useCallback(() => {
		if (!selectedCwd) return;
		const tempId =
			typeof crypto.randomUUID === "function"
				? crypto.randomUUID()
				: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
		onNewSession?.(tempId, selectedCwd);
	}, [selectedCwd, onNewSession]);

	const handleFolderTriggerClick = useCallback(() => {
		setFolderPopoverOpen((open) => !open);
	}, []);

	const handleAddFolderFromPopover = useCallback(() => {
		setFolderPopoverOpen(false);
		onAddFolder?.();
	}, [onAddFolder]);

	const toggleWorkspaceExpansion = useCallback((key: string) => {
		setExpandedWorkspaceKeys((keys) => {
			const next = new Set(keys);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	const explorerCwd =
		selectedCwd ?? selectedCwdProp ?? validatedProject?.cwd ?? null;
	const explorerProject = useMemo(
		() => projectFor(explorerCwd),
		[explorerCwd, projectFor],
	);
	const handleWorkspaceSelect = useCallback(
		(row: WorkspaceBrowserRow) => {
			setWorkspaceQuery("");
			if (row.key === explorerProject?.key) {
				setExpandedWorkspaceKeys((keys) =>
					keys.has(row.key) ? keys : new Set(keys).add(row.key),
				);
				return;
			}
			setSelectedCwd(
				workspaceActivationCwd(row, explorerProject?.key ?? null, selectedCwd),
			);
			setExpandedWorkspaceKeys((keys) => new Set(keys).add(row.key));
		},
		[selectedCwd, explorerProject],
	);

	const recentProjects = getRecentProjects(allSessions);
	const pending = transientWorkspace(validatedProject ?? null, recentProjects);
	const workspaceInputs = [
		...recentProjects.map((project) => ({
			key: project.key,
			root: project.root,
			cwd: project.root,
			sessions: sessionsForProject(allSessions, project.key),
		})),
		...(pending ? [{ ...pending, sessions: [] }] : []),
	];

	const projectActivity = useMemo(
		() => getProjectActivity(allSessions, runningSessionIds, unreadSessionIds),
		[allSessions, runningSessionIds, unreadSessionIds],
	);

	const searching = workspaceQuery.trim() !== "";
	const visibleWorkspaces = searchWorkspaces(workspaceInputs, workspaceQuery, {
		selectedWorkspaceKey: projectFor(explorerCwd)?.key,
		selectedSessionId,
		runningSessionIds,
		unreadSessionIds,
	});
	const hasQueryMatches = visibleWorkspaces.some((row) => row.hasQueryMatch);

	const selectedWorkspaceKey = projectFor(explorerCwd)?.key ?? null;
	const selectedRow = visibleWorkspaces.find(
		(row) => row.key === selectedWorkspaceKey,
	);
	const selectedRowVisible = selectedRow
		? searching
			? selectedRow.hasQueryMatch || expandedWorkspaceKeys.has(selectedRow.key)
			: expandedWorkspaceKeys.has(selectedRow.key)
		: false;

	useEffect(() => {
		if (!selectedWorkspaceKey) return;
		setExpandedWorkspaceKeys((keys) =>
			keys.has(selectedWorkspaceKey)
				? keys
				: new Set(keys).add(selectedWorkspaceKey),
		);
	}, [selectedWorkspaceKey]);

	useEffect(() => {
		if (selectedWorkspaceKey && !selectedRowVisible) {
			setWtDropdownOpen(false);
			setWtNewOpen(false);
		}
	}, [selectedWorkspaceKey, selectedRowVisible]);

	const showWorktreeSwitcher = Boolean(
		worktreeState?.isGit &&
			worktreeState.isTopLevel &&
			selectedCwd &&
			projectFor(explorerCwd)?.key === worktreeState.projectKey,
	);
	const worktreeGuide =
		selectedCwd &&
		worktreeState &&
		projectFor(explorerCwd)?.key === worktreeState.projectKey &&
		!showWorktreeSwitcher
			? worktreeState.isGit
				? {
						label: t("sidebar.openRepoRoot"),
						title: t("sidebar.openRepoRootTitle"),
					}
				: {
						label: t("sidebar.gitRepoRootOnly"),
						title: t("sidebar.gitRepoRootOnlyTitle"),
					}
			: null;
	const worktreeLoading = Boolean(
		selectedCwd && worktreeLoadingCwd === selectedCwd,
	);
	const inactiveWorktreeSelector =
		worktreeGuide ??
		(worktreeLoading && !showWorktreeSwitcher
			? {
					label: t("sidebar.worktrees"),
					title: t("sidebar.checkingWorktrees"),
				}
			: null);

	return {
		t,
		allSessions,
		loading,
		error,
		selectedCwd,
		homeDir,
		wtFilter,
		workspaceQuery,
		setWorkspaceQuery,
		folderPopoverOpen,
		setFolderPopoverOpen,
		folderPopoverRef,
		folderTriggerRef,
		expandedWorkspaceKeys,
		setExpandedWorkspaceKeys,
		worktreeState,
		wtDropdownOpen,
		setWtDropdownOpen,
		wtNewOpen,
		setWtNewOpen,
		wtNewBranch,
		setWtNewBranch,
		wtError,
		setWtError,
		wtBusy,
		wtConfirmRemove,
		setWtConfirmRemove,
		worktreeLoadingCwd,
		wtDropdownRef,
		wtNewInputRef,
		explorerOpen,
		setExplorerOpen,
		explorerKey,
		setExplorerKey,
		explorerUploadBusy,
		setExplorerUploadBusy,
		changesCount,
		setChangesCount,
		changesCollapsed,
		setChangesCollapsed,
		sessionRefreshDone,
		setSessionRefreshDone,
		explorerRefreshDone,
		setExplorerRefreshDone,
		runningSessionIds,
		unreadSessionIds,
		fileExplorerRef,
		loadSessions,
		handleSelectDefaultCwd,
		handleCreateWorktree,
		handleRemoveWorktree,
		handleSelectSessionFromList,
		handleNewSession,
		handleFolderTriggerClick,
		handleAddFolderFromPopover,
		toggleWorkspaceExpansion,
		handleWorkspaceSelect,
		workspaceInputs,
		explorerCwd,
		selectedProject: (cwd: string | null) => projectFor(cwd),
		projectActivity,
		searching,
		visibleWorkspaces,
		hasQueryMatches,
		selectedWorkspaceKey,
		selectedRowVisible,
		currentWorktree,
		currentWorktreePath,
		showWorktreeSwitcher,
		worktreeGuide,
		worktreeLoading,
		inactiveWorktreeSelector,
		onOpenFile,
		onAtMention,
		onAtMentions,
		// Re-expose shell callbacks + session state so panels read a single
		// model.* surface instead of threading props through the component tree.
		selectedSessionId,
		onSessionDeleted,
		onAddFolder,
		onExplorerRefresh,
		setSelectedCwd,
		setWtFilter,
		saveExplorerOpen,
		explorerRefreshTimerRef,
	};
}

export type SessionSidebarModel = ReturnType<typeof useSessionSidebarModel>;
