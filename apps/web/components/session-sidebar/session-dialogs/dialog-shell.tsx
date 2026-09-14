"use client";

import type { ReactNode } from "react";

/** Shared modal chrome for the session dialogs: fixed backdrop + centered
 *  panel + header with title and a close affordance. Matches the project's
 *  dialog look (ProjectTrustDialog / DirectoryPicker). */
export function DialogShell({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/35"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <div className="w-100 max-w-[calc(100vw-16px)] overflow-hidden rounded-[10px] border border-(--border) bg-(--bg) shadow-[0_8px_32px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
          <span className="text-[14px] font-semibold text-(--text)">{title}</span>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="cursor-pointer border-0 bg-none px-1.5 text-xl leading-none text-(--text-muted)"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
