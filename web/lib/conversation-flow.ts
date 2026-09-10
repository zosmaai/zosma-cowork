import type { ToolResultMessage } from "@/lib/types";

export type ToolCallState = "running" | "success" | "error" | "interrupted";

export type ToolCategory = "search" | "terminal" | "file" | "skill" | "chat" | "default";

/**
 * Visual category for a tool call. ChatGPT renders tool calls with a per-type
 * icon, so this drives the icon set in MessageView. Classification is purely
 * name-based — the SDK only exposes `toolName` — so it's heuristic by design.
 */
export function getToolCategory(toolName: string): ToolCategory {
  const name = (toolName ?? "").toLowerCase();
  if (/(\b|_)(web_)?(search|browse|crawl|scan|fetch_url)/.test(name) || /(^|_)web/.test(name)) return "search";
  if (/(\b|_)(bash|command|shell|exec|run|terminal)/.test(name)) return "terminal";
  if (/(\b|_)(read|write|edit|inspect|file|image|pdf|docx|doc|spread|sheet)/.test(name)) return "file";
  if (/(\b|_)(skill|extension|plugin)/.test(name)) return "skill";
  if (/(_|\b)(session_ask|ask|question|chat)/.test(name)) return "chat";
  return "default";
}

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
