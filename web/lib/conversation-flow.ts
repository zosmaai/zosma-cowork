import type { ToolResultMessage } from "@/lib/types";

export type ToolCallState = "running" | "success" | "error" | "interrupted";

const TOOL_TITLES: Record<string, string> = {
  bash: "Run",
  web_search: "Search web",
  session_ask: "Session ask",
};

export function formatToolTitle(toolName: string): string {
  const normalized = toolName.toLowerCase();
  const known = TOOL_TITLES[normalized];
  if (known) return known;
  const fallback = normalized.replace(/[-_]+/g, " ");
  return fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : toolName;
}

export function getToolCallState(result: ToolResultMessage | undefined, active: boolean): ToolCallState {
  if (active) return "running";
  if (!result) return "interrupted";
  return result.isError ? "error" : "success";
}

export function firstUsefulLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function shouldAttachFinalProcessRef(hasFinalAnswer: boolean): boolean {
  return !hasFinalAnswer;
}

export type ImageDropTarget = {
  addImages(files: File[]): void;
};

export function forwardDroppedImages(input: ImageDropTarget | null | undefined, files: File[]): void {
  input?.addImages(files);
}
