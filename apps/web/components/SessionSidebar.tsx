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
  /** Path of the active project whose directory could not be loaded, or null. */
  projectTrustLoadNotice?: string | null;
  onDismissProjectTrustLoadNotice?: () => void;
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
    projectTrustLoadNotice,
    onDismissProjectTrustLoadNotice,
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
          {projectTrustLoadNotice && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                margin: "0 14px 8px",
                padding: "8px 10px",
                borderRadius: 8,
                background: "color-mix(in srgb, var(--state-warning) 10%, var(--bg-panel))",
                border: "1px solid color-mix(in srgb, var(--state-warning) 30%, transparent)",
                color: "var(--state-warning)",
                fontSize: 11,
                lineHeight: 1.4,
                flexShrink: 0,
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-[1px] shrink-0"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
              <span className="min-w-0 [overflow-wrap:anywhere]">{projectTrustLoadNotice}</span>
              <button
                type="button"
                onClick={onDismissProjectTrustLoadNotice}
                aria-label="Dismiss"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  marginLeft: "auto",
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  opacity: 0.7,
                  flexShrink: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          )}
          <WorkspaceSearch model={model} />
          <WorkspaceBrowser model={model} />
          <ExplorerPanel model={model} />
        </>
      )}
    </div>
  );
}

export type { WorkspaceBrowserRow };