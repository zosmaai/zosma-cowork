"use client";

import type { SessionSidebarModel } from "./use-session-sidebar-model";
import { FileExplorer } from "../FileExplorer";
import { ToolbarIconButton } from "./utils";

interface ExplorerPanelProps {
  model: SessionSidebarModel;
}

/** Collapsible file-explorer section pinned to the bottom of the sidebar. */
function ExplorerPanel({ model }: ExplorerPanelProps) {
  if (!model.explorerCwd) return null;

  return (
    <div
      className="sidebar-file-explorer"
      style={{
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flex: model.explorerOpen ? "1 1 0" : "0 0 auto",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={() => model.setExplorerOpen((open) => {
            const next = !open;
            model.saveExplorerOpen(next);
            return next;
          })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            padding: "6px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            textAlign: "left",
          }}
        >
          <svg
            width="9" height="9" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: model.explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
          {model.t("files.explorer")}
        </button>
        {model.explorerOpen && model.changesCount > 0 && (
          <ToolbarIconButton
            onClick={() => model.setChangesCollapsed((v) => !v)}
            title={model.t("sidebar.changedFiles", { count: model.changesCount })}
            ariaPressed={!model.changesCollapsed}
            color={model.changesCollapsed ? "var(--text-dim)" : "var(--accent)"}
            background={model.changesCollapsed ? "none" : "var(--bg-selected)"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M3 12h6" />
              <path d="M15 12h6" />
            </svg>
          </ToolbarIconButton>
        )}
        {model.explorerOpen && (
          <ToolbarIconButton
            onClick={() => model.fileExplorerRef.current?.openUploadPicker()}
            disabled={model.explorerUploadBusy}
            title={model.t("sidebar.uploadFilesTitle")}
            color="var(--text-dim)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="m17 8-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
          </ToolbarIconButton>
        )}
        <ToolbarIconButton
          onClick={() => {
            if (model.onExplorerRefresh) model.onExplorerRefresh();
            else model.setExplorerKey((k) => k + 1);
            model.setExplorerRefreshDone(true);
            if (model.explorerRefreshTimerRef.current) clearTimeout(model.explorerRefreshTimerRef.current);
            model.explorerRefreshTimerRef.current = setTimeout(() => model.setExplorerRefreshDone(false), 2000);
          }}
          title={model.t("sidebar.refreshExplorer")}
          skipHover={model.explorerRefreshDone}
          color={model.explorerRefreshDone ? "#4ade80" : "var(--text-dim)"}
          background={model.explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none"}
          marginRight={6}
        >
          {model.explorerRefreshDone ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
        </ToolbarIconButton>
      </div>
      {model.explorerOpen && (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <FileExplorer
            ref={model.fileExplorerRef}
            cwd={model.explorerCwd}
            onOpenFile={model.onOpenFile ?? (() => {})}
            refreshKey={model.explorerKey}
            onAtMention={model.onAtMention}
            onAtMentions={model.onAtMentions}
            onUploadBusyChange={model.setExplorerUploadBusy}
            changesCollapsed={model.changesCollapsed}
            onChangesCountChange={model.setChangesCount}
          />
        </div>
      )}
    </div>
  );
}

export { ExplorerPanel };
