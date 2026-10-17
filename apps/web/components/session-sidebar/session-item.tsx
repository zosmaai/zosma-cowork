"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "@/lib/types";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { useI18n } from "@/hooks/useI18n";
import { PiLoader } from "@/components/PiLoader";
import { formatRelativeTime, friendlySessionTitle, type SessionItemNode } from "./utils";
import { DeleteSessionDialog } from "./session-dialogs/delete-session-dialog";
import { RenameSessionDialog } from "./session-dialogs/rename-session-dialog";
import type { ReactNode } from "react";

interface SessionTreeItemProps {
  node: SessionItemNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
  forceExpanded?: boolean;
}

function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
  forceExpanded = false,
}: SessionTreeItemProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          isRunning={runningSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && (forceExpanded || !collapsed) && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
              forceExpanded={forceExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <PiLoader size={14} />
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#0891b2",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
          <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

interface SessionItemProps {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: SessionItemProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  // "delete" | "rename" while the optimistic API call is in flight. The row
  // dims and stops accepting clicks until it resolves so the session can't be
  // double-deleted or re-selected mid-operation.
  const [pending, setPending] = useState<null | "delete" | "rename">(null);

  // ── Three-dot (⋮) more-actions menu: open state + portal anchor geomeometry ──
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = kebabRef.current?.getBoundingClientRect();
    setMenuAnchor(rect ? { top: rect.bottom + 4, left: rect.right } : null);
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuAnchor(null);
  }, []);

  // Close the menu on outside click or Escape while it is open.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (kebabRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, closeMenu]);

  // A stored first message may be an SDK-expanded <skill> block; collapse it
  // back to the compact /skill:name args command the user typed before using
  // it as the auto-name fallback, mirroring MessageView's rendering.
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  // Friendly label first, then truncate: collapsing a pasted path to its
  // basename before clipping keeps the real filename intact.
  const firstLabel = session.name
    || friendlySessionTitle(displayFirstMessage.slice(0, 200))
    || session.id.slice(0, 12);
  const title = firstLabel.slice(0, 50);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    setPending("delete");
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      // ignore
    } finally {
      setPending(null);
    }
  }, [session.id, session.transient, onDeleted]);

  // Rename via dialog: PATCH with the chosen name, skip if unchanged.
  const doRename = useCallback(async (name: string) => {
    if (name === (session.name ?? "") || name === title) return;
    setPending("rename");
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    } finally {
      setPending(null);
    }
  }, [session.id, session.name, onRenamed, title]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [onRenamed, session.cwd, session.id, session.name, session.path]);

  // Both menu actions stop propagation so the row never toggles selection.
  const handleMenuRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    closeMenu();
    if (session.transient) return;
    void RenameSessionDialog.call({ initialName: firstLabel }).then((name) => {
      if (name) void doRename(name);
    });
  }, [closeMenu, doRename, firstLabel, session.transient]);
  const handleMenuDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    closeMenu();
    if (session.transient) return;
    void DeleteSessionDialog.call({ title }).then((confirmed) => {
      if (confirmed) void performDelete();
    });
  }, [closeMenu, performDelete, session.transient, title]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 54;

  return (
    <div
      className="session-tree-item"
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: "default",
        background: isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        gap: 6,
        overflow: "hidden",
        opacity: pending ? 0.5 : 1,
        pointerEvents: pending ? "none" : "auto",
        transition: "background 0.1s, opacity 0.15s",
      }}
    >
      <>
          {/* Fork disclosure — sibling control, never nested in the select
              button. Its stored state survives search clearing. */}
          {hasChildren && (
            <button
              type="button"
              onClick={() => onToggleCollapse?.()}
              aria-expanded={!collapsed}
              title={collapsed ? t("sidebar.expandForks") : t("sidebar.collapseForks")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0, alignSelf: "flex-start",
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}>
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}
          <button type="button" className="session-row-main"
            onClick={onClick}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              padding: 0,
              margin: 0,
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
              font: "inherit",
            }}
          >
            {/* Fork indicator for child sessions */}
            {depth > 0 && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  minWidth: 0,
                  fontSize: 12,
                  fontWeight: isSelected ? 500 : 400,
                  lineHeight: 1.4,
                  color: "var(--text)",
                }}
                title={title}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                  {title}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 min-w-0 text-[11px] text-[var(--text-dim)]">
                {isRunning ? (
                  <RunningSessionIndicator />
                ) : isUnread ? (
                  <UnreadSessionIndicator />
                ) : null}
                <span title={session.modified}>{formatRelativeTime(session.modified)}</span>
              </div>
            </div>
          </button>

          {/* Three-dot more-actions CTA, shown on hover (or while its menu is open) */}
          {(hovered || menuOpen) && !session.transient && (
            <button
              ref={kebabRef}
              type="button"
              onClick={openMenu}
              title={t("sidebar.actions")}
              aria-label={t("sidebar.actions")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex h-8 w-8 items-center justify-center shrink-0 rounded-md text-(--text-dim) transition-colors opacity-80"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-dim)";
                e.currentTarget.style.opacity = "0.8";
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </button>
          )}

          {menuOpen && menuAnchor && createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                top: menuAnchor.top,
                left: Math.max(8, menuAnchor.left - 160),
                zIndex: 1000,
                minWidth: 160,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
                padding: 4,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleMenuRename}
                title={t("sidebar.rename")}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "7px 10px", background: "none", border: "none",
                  borderRadius: 6, color: "var(--text)", fontSize: 12,
                  cursor: "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
                {t("sidebar.rename")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleMenuDelete}
                title={t("sidebar.delete")}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "7px 10px", background: "none", border: "none",
                  borderRadius: 6, color: "#ef4444", fontSize: 12,
                  cursor: "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                {t("sidebar.delete")}
              </button>
            </div>,
            document.body
          )}
      </>
    </div>
  );
}

/**
 * Compact per-project activity badges for the workspace selector dropdown items:
 * a spinning running icon + count and an unread dot + count. Renders nothing
 * when the project has no activity. Counts share the accent / unread colors of
 * the per-session indicators so the two stay visually consistent.
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <PiLoader size={10} />
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0891b2", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {activity.unread}
        </span>
      )}
    </span>
  );
}

export { SessionTreeItem, SessionItem, RunningSessionIndicator, UnreadSessionIndicator, showProjectActivity };
