"use client";

import { useI18n } from "@/hooks/useI18n";

export function ProjectTrustDialog({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-trust-title"
        style={{
          width: 440,
          maxWidth: "100%",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-panel)",
          boxShadow: "0 12px 36px rgba(0,0,0,0.24)",
          overflow: "hidden",
        }}
      >
        <div className="flex gap-3 pt-4.5 px-4.5 pb-3.5">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0 mt-px"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <div className="min-w-0">
            <div id="project-trust-title" className="text-[15px] font-bold text-(--text)">
              {t("trust.dialogTitle")}
            </div>
            <div className="mt-1.75 text-xs leading-[1.6px] text-(--text-muted)">
              {t("trust.dialogBody")}
            </div>
            <code
              className="block mt-2.5 py-2 px-2.5 border border-(--border) rounded-[5px] bg-(--bg) text-(--text) font-(--font-mono) text-[11px] wrap-anywhere"
            >
              {cwd}
            </code>
            {error && (
              <div role="alert" className="mt-2.5 text-(--state-error) text-xs leading-[1.5px]">
                {error}
              </div>
            )}
          </div>
        </div>
        <div
          className="flex justify-end gap-2 py-2.5 px-4.5 border-t border-(--border)"
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 5,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            {t("trust.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              border: "1px solid var(--accent)",
              borderRadius: 5,
              background: "var(--accent)",
              color: "white",
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </div>
      </div>
    </div>
  );
}
