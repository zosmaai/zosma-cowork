"use client";

import type { SessionInfo } from "@/lib/types";
import type {
  ValidatedCwd,
  WorkspaceBrowserRow,
} from "@/lib/workspace-browser";
import { useSessionSidebarModel } from "./session-sidebar/use-session-sidebar-model";
import { SidebarHeader, WorkspaceSearch, WorkspaceBrowser } from "./session-sidebar/workspace-panel";
import { ExplorerPanel } from "./session-sidebar/explorer-panel";

export interface Props {
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
  onOpenFile?: (
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff" },
  ) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onAddFolder?: () => void;
  onSelectFolder?: (path: string) => void;
  validatedProject?: ValidatedCwd | null;
  rail?: boolean;
  isMobile?: boolean;
  onToggleRail?: () => void;
}

/** Workspace + session sidebar: session list, worktree switcher, file explorer.
 *  State/effects live in `useSessionSidebarModel`; this component is a pure render. */
export function SessionSidebar(
  {
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
    rail,
    isMobile,
    onToggleRail,
  }: Props,
) {
  const model = useSessionSidebarModel({
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
    rail,
  });

  return (
    <div className={[
        "workspace-sidebar",
        "flex", "flex-col", "flex-1", "min-w-0", "min-h-0", "overflow-hidden",
        rail ? "is-rail" : "",
        selectedSessionId === null ? "is-new-session" : "",
      ]
        .filter(Boolean)
        .join(" ")}>
      <SidebarHeader model={model} rail={rail} isMobile={isMobile} onToggleRail={onToggleRail} />
      {!rail && (
        <>
          <WorkspaceSearch model={model} />
          <WorkspaceBrowser model={model} />
          <ExplorerPanel model={model} />
        </>
      )}
    </div>
  );
}

export type { WorkspaceBrowserRow };