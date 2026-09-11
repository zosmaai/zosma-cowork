"use client";

import type { NoticeItem } from "@/hooks/useAgentSession";

export function NoticeShelf({
  notices,
  floating = false,
}: {
  notices: NoticeItem[];
  floating?: boolean;
}) {
  if (notices.length === 0) return null;

  return (
    <div className={`notice-shelf${floating ? " is-floating" : ""}`}>
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={`notice-shelf-item is-${notice.type}${notice.exiting ? " is-exiting" : ""}`}
          role={notice.type === "error" ? "alert" : "status"}
          aria-atomic="true"
        >
          <span className="notice-shelf-dot" aria-hidden="true" />
          <span className="notice-shelf-text">{notice.message}</span>
        </div>
      ))}
    </div>
  );
}
