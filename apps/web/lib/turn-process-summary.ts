import type { AssistantContentBlock, ToolCallContent, ToolResultMessage } from "./types";
import { formatToolTitle, type ToolCallState } from "./conversation-flow";
import { isEditToolName, isWriteToolName } from "./tool-names";

export type ToolKind = "read" | "edit" | "command" | "search" | "other";

export interface DiffStat {
  additions: number;
  deletions: number;
}

export interface TurnProcessSummary extends DiffStat {
  filesRead: number;
  filesEdited: number;
  commands: number;
  searches: number;
  other: number;
}

export function classifyTool(toolName: string): ToolKind {
  const name = (toolName ?? "").toLowerCase();
  if (isEditToolName(name) || isWriteToolName(name)) return "edit";
  if (name === "read" || name.endsWith("_read") || name.endsWith(".read")) return "read";
  if (name === "bash" || name === "shell" || name === "exec") return "command";
  if (["grep", "find", "ls", "glob"].includes(name) || name.includes("search")) return "search";
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The unified diff / patch a tool attached to its result, if any. */
export function getResultDiff(result: ToolResultMessage): { text: string } | null {
  const details = result.details;
  if (!isRecord(details)) return null;
  if (typeof details.patch === "string" && details.patch) return { text: details.patch };
  if (typeof details.diff === "string" && details.diff) return { text: details.diff };
  return null;
}

/** Count added/removed lines, skipping `---`/`+++` file headers. */
export function countDiffLines(diff: string): DiffStat {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

function pathOf(block: ToolCallContent): string | null {
  const value = block.input?.file_path ?? block.input?.path;
  return typeof value === "string" && value ? value : null;
}

/** Lines added/removed by one successful edit or write call; null otherwise. */
export function getToolDiffStat(block: ToolCallContent, result: ToolResultMessage | undefined): DiffStat | null {
  if (!result || result.isError || classifyTool(block.toolName) !== "edit") return null;
  const diff = getResultDiff(result);
  if (diff) return countDiffLines(diff.text);
  const content = block.input?.content;
  if (typeof content === "string") return { additions: content.split("\n").length, deletions: 0 };
  return null;
}

export function summarizeTurnProcess(
  blocks: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
): TurnProcessSummary {
  const read = new Set<string>();
  const edited = new Set<string>();
  const summary: TurnProcessSummary = { filesRead: 0, filesEdited: 0, commands: 0, searches: 0, other: 0, additions: 0, deletions: 0 };
  for (const block of blocks) {
    if (block.type !== "toolCall") continue;
    const kind = classifyTool(block.toolName);
    const key = pathOf(block) ?? block.toolCallId;
    if (kind === "read") read.add(key);
    else if (kind === "edit") {
      edited.add(key);
      const stat = getToolDiffStat(block, toolResults?.get(block.toolCallId));
      if (stat) {
        summary.additions += stat.additions;
        summary.deletions += stat.deletions;
      }
    } else if (kind === "command") summary.commands++;
    else if (kind === "search") summary.searches++;
    else summary.other++;
  }
  summary.filesRead = read.size;
  summary.filesEdited = edited.size;
  return summary;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Read 4 files, edited 4 files, ran 2 commands" — the collapsed turn header. */
export function formatTurnProcessSummary(s: TurnProcessSummary): string {
  const parts: string[] = [];
  if (s.filesRead) parts.push(`read ${plural(s.filesRead, "file", "files")}`);
  if (s.filesEdited) parts.push(`edited ${plural(s.filesEdited, "file", "files")}`);
  if (s.commands) parts.push(`ran ${plural(s.commands, "command", "commands")}`);
  if (s.searches) parts.push(plural(s.searches, "search", "searches"));
  if (s.other) parts.push(plural(s.other, "other tool call", "other tool calls"));
  if (parts.length === 0) return "";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One-line preview of a tool's input (command, path, pattern, query…). */
export function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);
  return String(input[keys[0]]).slice(0, 120);
}

const SETTLED_VERB: Record<ToolKind, string | null> = { read: "Read", edit: "Edited", command: "Ran", search: "Searched", other: null };
const RUNNING_VERB: Record<ToolKind, string | null> = { read: "Read", edit: "Edit", command: "Run", search: "Search", other: null };

/**
 * Verb + target for a tool row. The target (command, file name, pattern) is
 * always part of the row so the user can audit what ran without expanding it.
 */
export function describeToolRow(
  block: ToolCallContent,
  state: ToolCallState,
): { verb: string; target: string; kind: ToolKind } {
  const kind = classifyTool(block.toolName);
  const path = pathOf(block);
  const target = (kind === "read" || kind === "edit") && path
    ? path.split(/[\\/]/).pop() || path
    : getToolPreview(block);
  let verb: string;
  if (state === "error") verb = "Failed";
  else if (state === "success") verb = isWriteToolName(block.toolName) ? "Wrote" : SETTLED_VERB[kind] ?? formatToolTitle(block.toolName);
  else verb = isWriteToolName(block.toolName) ? "Write" : RUNNING_VERB[kind] ?? formatToolTitle(block.toolName);
  return { verb, target, kind };
}
