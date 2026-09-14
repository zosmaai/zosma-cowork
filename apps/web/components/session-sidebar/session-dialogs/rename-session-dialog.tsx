"use client";

import { useEffect, useRef, useState } from "react";
import { createCallable } from "react-call";
import { useI18n } from "@/hooks/useI18n";
import { DialogShell } from "./dialog-shell";

interface RenameProps {
  initialName: string;
}

/** Resolves to the new name (string) or null on cancel. The caller owns the
 *  PATCH; this dialog just collects + returns the value. */
export const RenameSessionDialog = createCallable<RenameProps, string | null>(
  ({ call, initialName }) => {
    const { t } = useI18n();
    const [value, setValue] = useState(initialName);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }, []);

    const trimmed = value.trim();
    const canSave = trimmed.length > 0 && trimmed !== initialName;
    const submit = () => { if (canSave) call.end(trimmed); };

    return (
      <DialogShell title={t("sidebar.rename")} onCancel={() => call.end(null)}>
        <div className="p-4">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") call.end(null);
            }}
            autoFocus
            placeholder={t("sidebar.sessionName")}
            aria-label={t("sidebar.sessionName")}
            className="w-full rounded-[6px] border border-(--border) bg-(--bg) px-2.5 py-2 text-[12px] text-(--text) outline-none"
          />
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={() => call.end(null)}
            className="h-8 cursor-pointer rounded-[6px] border border-(--border) bg-(--bg) px-3.5 text-[12px] font-medium text-(--text-muted)"
          >
            {t("sidebar.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="h-8 rounded-[6px] border-0 bg-(--accent) px-3.5 text-[12px] font-semibold text-white disabled:cursor-default disabled:opacity-50"
          >
            {t("sidebar.save")}
          </button>
        </div>
      </DialogShell>
    );
  },
);
