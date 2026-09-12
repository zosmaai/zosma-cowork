"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";

export function openWrittenFile(onOpenFile: ((filePath: string) => void) | undefined, filePath: string): void {
  onOpenFile?.(filePath);
}

/** Lists files a turn actually wrote, as buttons that open each one in preview. */
export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;

  return (
    <div className="written-file-references" aria-label={t("chat.filesWritten")}>
      {files.map(({ filePath }) => {
        const name = getFileName(filePath);
        return (
          <button
            key={filePath}
            type="button"
            className="written-file-reference"
            title={filePath}
            aria-label={t("chat.openWrittenFile", { name })}
            onClick={() => openWrittenFile(onOpenFile, filePath)}
          >
            {getFileIcon(name, 12)}
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
