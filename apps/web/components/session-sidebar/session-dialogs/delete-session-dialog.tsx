"use client";

import { createCallable } from "react-call";
import { useI18n } from "@/hooks/useI18n";
import { DialogShell } from "./dialog-shell";

interface DeleteProps {
  title: string;
}

/** Resolves to true (confirm) or false (cancel). The caller owns the DELETE. */
export const DeleteSessionDialog = createCallable<DeleteProps, boolean>(
  ({ call, title }) => {
    const { t } = useI18n();
    return (
      <DialogShell title={t("sidebar.delete")} onCancel={() => call.end(false)}>
        <div className="px-4 py-4 text-[13px] leading-relaxed text-(--text)">
          {t("sidebar.deleteSession", { title: title.slice(0, 60) + (title.length > 60 ? "…" : "") })}
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={() => call.end(false)}
            className="h-8 cursor-pointer rounded-md border border-(--border) bg-(--bg) px-3.5 text-[12px] font-medium text-(--text-muted)"
          >
            {t("sidebar.cancel")}
          </button>
          <button
            type="button"
            onClick={() => call.end(true)}
            className="h-8 cursor-pointer rounded-md border-0 bg-[#ef4444] px-3.5 text-[12px] font-semibold text-white"
          >
            {t("sidebar.delete")}
          </button>
        </div>
      </DialogShell>
    );
  },
);
