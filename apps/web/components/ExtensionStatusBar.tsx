"use client";

import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { ExtensionWidgets } from "./ExtensionWidgets";

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  // Daemon state can carry a non-array here when a session degrades (LLM
  // unreachable, dead session). Never crash the whole UI over a status line.
  if (!Array.isArray(statuses)) return "";
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

export function partitionExtensionWidgets(widgets: ExtensionWidgetItem[]): {
  aboveEditor: ExtensionWidgetItem[];
  belowEditor: ExtensionWidgetItem[];
} {
  if (!Array.isArray(widgets)) return { aboveEditor: [], belowEditor: [] };
  return {
    aboveEditor: widgets.filter(({ placement }) => placement === "aboveEditor"),
    belowEditor: widgets.filter(({ placement }) => placement === "belowEditor"),
  };
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
  placement = "belowEditor",
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
  placement?: "aboveEditor" | "belowEditor";
}) {
  if (statuses.length === 0 && widgets.length === 0) return null;

  const statusLine = formatExtensionStatusLine(statuses);
  const plainStatusLine = stripAnsi(statusLine);

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${statuses.length > 0 ? " has-status" : ""}${placement === "aboveEditor" ? " is-above-editor" : " is-below-editor"}`}
    >
      {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
      {statuses.length > 0 && (
        <div
          role="status"
          className="extension-status-line"
          aria-label={plainStatusLine}
          title={plainStatusLine}
        >
          <span className="extension-status-text">
            {parseAnsiLine(statusLine).map((segment, index) => (
              <span key={index} style={segment.style}>{segment.text}</span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
