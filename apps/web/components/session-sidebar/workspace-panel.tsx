"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { WorkspaceBrowserRow } from "@/lib/workspace-browser";
import type { SessionSidebarModel } from "./use-session-sidebar-model";
import { ZosmaBrand } from "../ZosmaBrand";
import { PathLabel, AnimatedDropdown, buildSessionTree } from "./utils";
import { SessionTreeItem, showProjectActivity } from "./session-item";

/* ─────────────────────────── Brand ─────────────────────────── */

function BrandTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}`;

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    setShowVersion((current) => {
      const next = !current;
      if (next) {
        revertTimerRef.current = setTimeout(() => setShowVersion(false), 3000);
      }
      return next;
    });
  }, []);

  useEffect(() => () => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
  }, []);

  return (
    <button
      type="button"
      className="brand-title-button"
      onClick={handleClick}
      aria-label={showVersion ? version : "zosma.ai"}
      title={showVersion ? "zosma.ai" : version}
    >
      {showVersion ? <span className="brand-version">{version}</span> : <ZosmaBrand />}
    </button>
  );
}

/* ─────────────────────────── Header ─────────────────────────── */

interface SidebarHeaderProps {
  model: SessionSidebarModel;
  rail?: boolean;
  isMobile?: boolean;
  onToggleRail?: () => void;
}

function SidebarHeader({ model, rail = false, isMobile = false, onToggleRail }: SidebarHeaderProps) {
  const { t } = model;
  const {
    folderPopoverOpen, setFolderPopoverOpen, folderPopoverRef, folderTriggerRef,
    sessionRefreshDone, loadSessions, selectedCwd,
    handleSelectDefaultCwd, handleAddFolderFromPopover, handleNewSession,
  } = model;

  // Rail (collapsed 62px column): a single compact header row of icon buttons.
  if (rail) {
    return (
      <div className="workspace-sidebar-header workspace-sidebar-header-rail">
        <button
          type="button"
          className="workspace-sidebar-rail-btn"
          onClick={onToggleRail}
          title={t("sidebar.expand")}
          aria-label={t("sidebar.expand")}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <polyline points="10 8 14 12 10 16" />
          </svg>
        </button>
        <button
          type="button"
          className="workspace-sidebar-rail-btn"
          onClick={handleNewSession}
          disabled={!selectedCwd}
          title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.selectProject")}
          aria-label={t("sidebar.newSession")}
        >
          <svg width="17" height="17" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="1" x2="6" y2="11" />
            <line x1="1" y1="6" x2="11" y2="6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="workspace-sidebar-header">
      <div className="workspace-sidebar-brand-row">
        <BrandTitle />
        <div className="workspace-sidebar-actions">
          <div ref={folderPopoverRef} className="workspace-folder-control">
            <button
              ref={folderTriggerRef}
              type="button"
              onClick={model.handleFolderTriggerClick}
              aria-expanded={folderPopoverOpen}
              aria-controls="folder-popover"
              title={t("sidebar.addFolder")}
              aria-label={t("sidebar.addFolder")}
              className="workspace-sidebar-icon-btn"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
            <div
              id="folder-popover"
              hidden={!folderPopoverOpen}
              role="region"
              aria-label={t("sidebar.selectWorkspace")}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFolderPopoverOpen(false);
                  folderTriggerRef.current?.focus();
                }
              }}
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                zIndex: 100,
                minWidth: 190,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={handleAddFolderFromPopover}
                style={popoverItemStyle}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
                <span>{t("sidebar.addFolder")}</span>
              </button>
              <button
                type="button"
                onClick={() => { void handleSelectDefaultCwd(); }}
                style={popoverItemStyle}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                </svg>
                <span>{t("sidebar.useDefaultDirectory")}</span>
              </button>
            </div>
          </div>
          <button
            type="button"
            className={`workspace-sidebar-icon-btn${sessionRefreshDone ? " is-done" : ""}`}
            onClick={() => loadSessions(false, true)}
            title={t("sidebar.refresh")}
            aria-label={t("sidebar.refresh")}
          >
            {sessionRefreshDone ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            )}
          </button>
          {!isMobile && (
            <button
              type="button"
              className="workspace-sidebar-collapse"
              onClick={onToggleRail}
              title={t("sidebar.collapse")}
              aria-label={t("sidebar.collapse")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <button
        className="workspace-new-button"
        onClick={handleNewSession}
        disabled={!selectedCwd}
        title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.selectProject")}
        style={newButtonStyle}
        onMouseEnter={(e) => {
          if (!selectedCwd) return;
          e.currentTarget.style.background = "var(--bg-selected)";
          e.currentTarget.style.color = "var(--accent)";
          e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = selectedCwd ? "var(--text)" : "var(--text-dim)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="6" y1="1" x2="6" y2="11" />
          <line x1="1" y1="6" x2="11" y2="6" />
        </svg>
        {t("sidebar.new")}
      </button>
    </div>
  );
}

const popoverItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  padding: "8px 10px",
  background: "none",
  border: "none",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-muted)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 11,
} as const;

const newButtonStyle = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  cursor: "pointer",
  height: 34,
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: "-0.01em",
  whiteSpace: "nowrap",
  flexShrink: 0,
  transition: "background 0.12s, color 0.12s, border-color 0.12s",
} as const;

/* ─────────────────────────── Search ─────────────────────────── */

function WorkspaceSearch({ model }: { model: SessionSidebarModel }) {
  const { t, workspaceQuery, setWorkspaceQuery, searching } = model;
  return (
    <div className="workspace-search" style={{ padding: "8px 12px 4px", flexShrink: 0 }}>
      {!searching && (
        <div className="workspace-recents" aria-hidden="true" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6 }}>
          {t("sidebar.recents")}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <input
          value={workspaceQuery}
          onChange={(e) => setWorkspaceQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setWorkspaceQuery("");
          }}
          aria-label={t("sidebar.searchWorkspaces")}
          placeholder={t("sidebar.searchWorkspaces")}
          style={{
            width: "100%",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            padding: "6px 26px 6px 9px",
            border: "1px solid transparent",
            borderRadius: 8,
            outline: "none",
            background: "var(--bg-hover)",
            color: "var(--text)",
            boxSizing: "border-box",
            transition: "border-color 0.12s, background 0.12s",
          }}
          onMouseEnter={(e) => {
            if (workspaceQuery === "") e.currentTarget.style.borderColor = "var(--border)";
          }}
          onMouseLeave={(e) => {
            if (workspaceQuery === "") e.currentTarget.style.borderColor = "transparent";
          }}
        />
        {workspaceQuery.trim() !== "" && (
          <button
            type="button"
            onClick={() => setWorkspaceQuery("")}
            title={t("sidebar.clearSearch")}
            aria-label={t("sidebar.clearSearch")}
            style={searchClearStyle}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

const searchClearStyle = {
  position: "absolute",
  right: 4,
  top: "50%",
  transform: "translateY(-50%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  padding: 0,
  background: "none",
  border: "none",
  borderRadius: 5,
  color: "var(--text-dim)",
  cursor: "pointer",
} as const;

/* ─────────────────────────── Worktree switcher ─────────────────────────── */

interface WorktreeSwitcherProps {
  model: SessionSidebarModel;
  homeDir: string;
}

function WorktreeSwitcher({ model, homeDir }: WorktreeSwitcherProps) {
  const {
    t, wtFilter, setWtFilter, wtDropdownOpen, setWtDropdownOpen,
    wtNewOpen, setWtNewOpen, wtNewBranch, setWtNewBranch, wtError, setWtError,
    wtBusy, wtConfirmRemove, setWtConfirmRemove, wtDropdownRef, wtNewInputRef,
    currentWorktree, currentWorktreePath, handleCreateWorktree, handleRemoveWorktree,
  } = model;

  const showWtFilter = model.worktreeState!.worktrees.length >= 8;
  const visibleWorktrees = showWtFilter && wtFilter.trim()
    ? model.worktreeState!.worktrees.filter((w) =>
      (w.branch ?? displayCwdFor(w.path, homeDir)).toLowerCase().includes(wtFilter.trim().toLowerCase()))
    : model.worktreeState!.worktrees;

  return (
    <div ref={wtDropdownRef} className="workspace-worktree-switcher" style={{ position: "relative", marginTop: 6 }}>
      <button
        onClick={() => setWtDropdownOpen((v) => !v)}
        title={currentWorktree ? t("sidebar.switchWorktreeTitle", { path: currentWorktree.path }) : t("sidebar.switchWorktree")}
        style={{
          width: "100%",
          height: 29,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          cursor: "pointer",
          fontSize: 11,
          lineHeight: 1.35,
          color: "var(--text-muted)",
          textAlign: "left",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: currentWorktree && !currentWorktree.isMain ? "var(--accent)" : "var(--text-dim)" }}>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <PathLabel
          text={currentWorktree ? (currentWorktree.branch ?? displayCwdFor(currentWorktree.path, homeDir)) : "…"}
          style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text)" }}
        />
        {currentWorktree?.isMain && (
          <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sidebar.main")}</span>
        )}
        {model.worktreeState!.worktrees.length > 1 && (
          <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
            {model.worktreeState!.worktrees.length}
          </span>
        )}
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      <AnimatedDropdown
        open={wtDropdownOpen}
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          zIndex: 100,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
          overflow: "hidden",
        }}
      >
        {showWtFilter && (
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
            <input
              value={wtFilter}
              onChange={(e) => setWtFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setWtFilter("");
                  setWtDropdownOpen(false);
                }
              }}
              placeholder={t("sidebar.filterWorktrees")}
              autoFocus
              style={{
                width: "100%",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                padding: "5px 8px",
                border: "1px solid var(--border)",
                borderRadius: 5,
                outline: "none",
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}
        <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
          {visibleWorktrees.map((wt) => (
            <WorktreeRow
              key={wt.path}
              wt={wt}
              isCurrent={wt.path === currentWorktreePath}
              homeDir={homeDir}
              t={t}
              confirmPath={wtConfirmRemove}
              setConfirmPath={setWtConfirmRemove}
              wtBusy={wtBusy}
              onToggle={() => {
                model.setSelectedCwd(wt.path);
                setWtDropdownOpen(false);
                setWtError(null);
                setWtFilter("");
              }}
              onRemove={() => void handleRemoveWorktree(wt.path, false)}
              onForceRemove={() => void handleRemoveWorktree(wt.path, true)}
            />
          ))}
          {showWtFilter && visibleWorktrees.length === 0 && wtFilter.trim() && (
            <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noMatchingWorktrees")}</div>
          )}
        </div>

        {!wtNewOpen ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setWtNewOpen(true);
              setWtError(null);
              setTimeout(() => wtNewInputRef.current?.focus(), 0);
            }}
            title={t("sidebar.createWorktreeTitle")}
            style={worktreeActionItemStyle}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <line x1="5" y1="1" x2="5" y2="9" />
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
            <span>{t("sidebar.newWorktree")}</span>
          </button>
        ) : (
          <div style={{ padding: "6px 8px" }}>
            <input
              ref={wtNewInputRef}
              value={wtNewBranch}
              onChange={(e) => {
                setWtNewBranch(e.target.value);
                setWtError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateWorktree();
                }
                if (e.key === "Escape") {
                  setWtNewOpen(false);
                  setWtNewBranch("");
                  setWtError(null);
                }
              }}
              placeholder={t("sidebar.branchName")}
              style={worktreeInputStyle}
            />
            <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
              <button
                onClick={() => void handleCreateWorktree()}
                disabled={wtBusy || !wtNewBranch.trim()}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 5,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer",
                  opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                }}
              >
                {wtBusy ? t("sidebar.creating") : t("sidebar.create")}
              </button>
              <button
                onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  color: "var(--text-muted)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {t("sidebar.cancel")}
              </button>
            </div>
          </div>
        )}
        {wtError && (
          <div style={{
            padding: "5px 10px 8px",
            color: "#dc2626",
            fontSize: 11,
            lineHeight: 1.35,
            overflowWrap: "anywhere",
          }}>
            {wtError}
          </div>
        )}
      </AnimatedDropdown>
    </div>
  );
}

interface WorktreeRowProps {
  wt: { path: string; branch: string | null; isMain: boolean };
  isCurrent: boolean;
  homeDir: string;
  t: (key: string, params?: Record<string, string>) => string;
  confirmPath: string | null;
  setConfirmPath: (path: string | null) => void;
  wtBusy: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onForceRemove: () => void;
}

function WorktreeRow({ wt, isCurrent, homeDir, t, confirmPath, setConfirmPath, wtBusy, onToggle, onRemove, onForceRemove }: WorktreeRowProps) {
  if (confirmPath === wt.path) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}>
        <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("sidebar.forceRemoveCheckout")}
        </span>
        <button
          onClick={onForceRemove}
          disabled={wtBusy}
          style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
        >
          {t("sidebar.force")}
        </button>
        <button
          onClick={() => setConfirmPath(null)}
          style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
        >
          {t("sidebar.cancel")}
        </button>
      </div>
    );
  }
  return (
    <div className="wt-row" style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
      <button
        onClick={onToggle}
        title={wt.path}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "8px 10px",
          background: "var(--bg)",
          border: "none",
          color: isCurrent ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
        }}
      >
        {isCurrent ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="1.5 5 4 7.5 8.5 2.5" />
          </svg>
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} />
        )}
        <PathLabel text={wt.branch ?? displayCwdFor(wt.path, homeDir)} style={{ flex: 1 }} />
        {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sidebar.main")}</span>}
      </button>
      {!wt.isMain && (
        <button
          onClick={onRemove}
          disabled={wtBusy}
          title={t("sidebar.removeWorktreeTitle", { path: wt.path })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 28, padding: 0, marginRight: 4,
            background: "none", border: "none",
            color: "var(--text-dim)", cursor: "pointer",
            borderRadius: 5, flexShrink: 0,
            transition: "color 0.12s, background 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Substitute the home dir prefix with ~ (matches utils.displayCwd, no truncation) */
function displayCwdFor(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

const worktreeActionItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  padding: "8px 10px",
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 11,
} as const;

const worktreeInputStyle = {
  width: "100%",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  padding: "5px 8px",
  border: "1px solid var(--accent)",
  borderRadius: 5,
  outline: "none",
  background: "var(--bg)",
  color: "var(--text)",
  boxSizing: "border-box",
} as const;

/* ─────────────────────────── Workspace group ─────────────────────────── */

interface WorkspaceGroupProps {
  model: SessionSidebarModel;
  row: WorkspaceBrowserRow;
  homeDir: string;
}

function WorkspaceGroup({ model, row, homeDir }: WorkspaceGroupProps) {
  const {
    t, expandedWorkspaceKeys, showWorktreeSwitcher,
    projectActivity, handleSelectSessionFromList, handleNewSession,
    loadSessions, onSessionDeleted,
  } = model;
  const searching = model.searching;

  const isExpanded = searching ? row.hasQueryMatch || expandedWorkspaceKeys.has(row.key) : expandedWorkspaceKeys.has(row.key);
  const isSelected = row.key === model.selectedProject(model.explorerCwd)?.key;
  const groupId = `workspace-group-${row.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const rowTree = buildSessionTree(row.sessions);

  return (
    <div className="workspace-group" key={row.key}>
      <div className="workspace-row" style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--border)" }}>
        <button type="button" aria-expanded={isExpanded} aria-controls={groupId} onClick={() => model.toggleWorkspaceExpansion(row.key)}
          aria-label={isExpanded ? t("sidebar.collapseWorkspace") : t("sidebar.expandWorkspace")}
          title={isExpanded ? t("sidebar.collapseWorkspace") : t("sidebar.expandWorkspace")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            flexShrink: 0,
            background: "none",
            border: "none",
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
            <path d="M1.75 4.75A1.25 1.25 0 0 1 3 3.5h3l1.5 1.75H13A1.25 1.25 0 0 1 14.25 6.5v5.25A1.25 1.25 0 0 1 13 13H3a1.25 1.25 0 0 1-1.25-1.25v-7Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => model.handleWorkspaceSelect(row)}
          aria-current={isSelected ? "page" : undefined}
          title={row.root}
          style={workspaceRowSelectStyle}
        >
          <PathLabel text={row.root.split(/[\\/]/).filter(Boolean).pop() ?? row.root} style={{ flex: 1 }} />
          {showProjectActivity(projectActivity.get(row.key), t)}
        </button>
      </div>
      <div id={groupId} className="workspace-sessions" hidden={!isExpanded}>
        {isSelected && model.selectedSessionId === null && (
          <button type="button" className="workspace-new-session-row" onClick={handleNewSession}>
            New Session
          </button>
        )}
        {showWorktreeSwitcher && <WorktreeSwitcher model={model} homeDir={homeDir} />}
        {rowTree.length === 0 && (
          <div className="workspace-empty" style={{ padding: "10px 14px 12px", fontSize: 11, color: "var(--text-dim)" }}>
            <div>{t("sidebar.workspaceEmpty")}</div>
            {isSelected && (
              <button
                type="button"
                onClick={handleNewSession}
                style={emptyCtaStyle}
              >
                {t("sidebar.newSessionCta")}
              </button>
            )}
          </div>
        )}
        {rowTree.map((node) => (
          <SessionTreeItem
            key={node.session.id}
            node={node}
            selectedSessionId={model.selectedSessionId}
            runningSessionIds={model.runningSessionIds}
            unreadSessionIds={model.unreadSessionIds}
            onSelectSession={handleSelectSessionFromList}
            onRenamed={loadSessions}
            onSessionDeleted={(id) => {
              onSessionDeleted?.(id);
              loadSessions();
            }}
            depth={0}
            forceExpanded={searching && row.hasQueryMatch}
          />
        ))}
      </div>
    </div>
  );
}

const workspaceRowSelectStyle = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 10px 7px 0",
  background: "var(--bg-selected)",
  border: "none",
  color: "var(--text)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  transition: "background 0.1s",
} as const;

const emptyCtaStyle = {
  marginTop: 8,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 10px",
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 11,
} as const;

/* ─────────────────────────── Workspace browser ─────────────────────────── */

interface WorkspaceBrowserProps {
  model: SessionSidebarModel;
}

function WorkspaceBrowser({ model }: WorkspaceBrowserProps) {
  const {
    t, loading, error, explorerOpen, explorerCwd, workspaceInputs,
    visibleWorkspaces, searching, hasQueryMatches,
  } = model;

  return (
    <div
      className={[
          "workspace-browser", "flex", "flex-col", "flex-shrink-0", "grow",
          "overflow-y-auto", "min-h-0",
          explorerOpen && explorerCwd ? "grow-0" : "",
          explorerOpen && explorerCwd ? "min-[80px]" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      role="region"
      aria-label={t("sidebar.workspaces")}
    >
      {loading && (
        <div className="workspace-loading" style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
          {t("sidebar.loading")}
        </div>
      )}
      {error && (
        <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
          {error}
        </div>
      )}
      {!loading && !error && workspaceInputs.length === 0 && !searching && (
        <EmptyWorkspaces model={model} />
      )}
      <div className="workspace-list" aria-label={t("sidebar.workspaces")}>
        {visibleWorkspaces.map((row) => (
          <WorkspaceGroup key={row.key} model={model} row={row} homeDir={model.homeDir} />
        ))}
      </div>
      {searching && !hasQueryMatches && (
        <SearchNoResults
          onClick={() => model.setWorkspaceQuery("")}
          clearLabel={t("sidebar.clearSearch")}
          message={t("sidebar.noWorkspaceMatches")}
        />
      )}
    </div>
  );
}

function EmptyWorkspaces({ model }: { model: SessionSidebarModel }) {
  const { t, onAddFolder } = model;
  return (
    <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--text-muted)" }}>
      <div>{t("sidebar.noWorkspaces")}</div>
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noWorkspacesHint")}</div>
      <button
        type="button"
        onClick={() => onAddFolder?.()}
        style={emptyCtaStyle}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <line x1="5" y1="1" x2="5" y2="9" />
          <line x1="1" y1="5" x2="9" y2="5" />
        </svg>
        {t("sidebar.addFolder")}
      </button>
    </div>
  );
}

function SearchNoResults({ onClick, clearLabel, message }: { onClick: () => void; clearLabel: string; message: string }) {
  return (
    <div role="status" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onClick}
        style={{
          padding: "4px 10px",
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {clearLabel}
      </button>
    </div>
  );
}

export { SidebarHeader, WorkspaceSearch, WorkspaceBrowser, WorktreeSwitcher };