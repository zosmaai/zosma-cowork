import type {
  AgentMessage,
  AssistantMessage,
  AssistantContentBlock,
  ToolResultMessage,
} from "./types";
import { userMessageKey } from "./prompt-recovery";

/** Coerce unknown payloads to arrays; degraded daemon payloads may be sparse. */
export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function normalizeQueuedMessages(q?: { steering?: string[]; followUp?: string[] } | null): { steering: string[]; followUp: string[] } {
  return { steering: asArray(q?.steering), followUp: asArray(q?.followUp) };
}

/** Stable text key for a completed assistant message. The committed message
 *  from the SSE stream and the one loadSession reloads from the session file
 *  can be different objects (the daemon maps message_end to a partial
 *  {role, content} shape), so we compare by rendered text to detect and drop
 *  a duplicate that otherwise would show the same reply twice after a
 *  reconcile. */
export function assistantMessageText(msg: unknown): string {
  const content = (msg as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: string }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("");
}

/** Stable key pairing a live in-memory message with the reloaded session-file
 *  copy of the same logical entry. Content-summary based: the file copy is a
 *  different object with no dependable id, so we match on what the UI itself
 *  uses to disambiguate messages. */
export function messageEntryKey(message: AgentMessage): string {
  if (message.role === "user") return `u:${userMessageKey(message)}`;
  if (message.role === "assistant") {
    const content = (message as AssistantMessage).content ?? [];
    const text = content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("");
    const toolCalls = content.filter((block) => block.type === "toolCall").length;
    return `a:${toolCalls}:${text}`;
  }
  if (message.role === "toolResult") {
    return `r:${(message as ToolResultMessage).toolCallId}`;
  }
  if (message.role === "custom") {
    const custom = message as AgentMessage & { customType?: string; content?: unknown };
    return `c:${custom.customType ?? ""}:${typeof custom.content === "string" ? custom.content : ""}`;
  }
  if (message.role === "bashExecution") {
    return `b:${(message as AgentMessage & { command?: string }).command ?? ""}`;
  }
  return `x:${(message as { role: string }).role}`;
}

function textOf(content: AssistantContentBlock[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("");
}

/** True when `candidate` already carries at least the assistant content of
 *  `reference` (at least as many blocks and at least as much text). Used to
 *  decide whether the in-memory copy may keep its object identity (so
 *  memoized views skip a repaint) or must yield to the fuller file copy. */
export function assistantAtLeastAsFull(candidate: AgentMessage, reference: AgentMessage): boolean {
  const a = (candidate as AssistantMessage).content ?? [];
  const b = (reference as AssistantMessage).content ?? [];
  if (a.length < b.length) return false;
  return textOf(a).length >= textOf(b).length;
}

/** Commit a completed assistant reply idempotently: when a same-text
 *  assistant reply already sits at the tail (SSE message_end racing a
 *  reconcile reload), replace it with the authoritative commit instead of
 *  appending a second, visually duplicated bubble. Returns the next list. */
export function commitAssistantReply(current: AgentMessage[], committed: AgentMessage): AgentMessage[] {
  const text = assistantMessageText(committed);
  let tailIdx = current.length - 1;
  while (tailIdx >= 0 && current[tailIdx].role === "assistant" && assistantMessageText(current[tailIdx]) === text) {
    tailIdx--;
  }
  if (tailIdx < current.length - 1) {
    return [...current.slice(0, tailIdx + 1), committed];
  }
  // No same-text assistant at the tail. Append only when the reply is not a
  // replay of one already in the list (a stale message_end after a newer
  // turn must not insert into the middle of the conversation).
  const already = current.findIndex((m) => m.role === "assistant" && assistantMessageText(m) === text);
  if (already !== -1) return current;
  return [...current, committed];
}

/** Merge a session-file reload into the live message list.
 *
 *  - The file's order is authoritative (it is the source of truth for the
 *    conversation, compaction, and branch navigation).
 *  - Messages that already exist in memory keep their object identity, so
 *    memoized MessageViews skip re-rendering on a reconcile reload. They
 *    yield to the file copy only when the file copy is strictly fuller
 *    (e.g. thinking blocks/usage the stream commit lacked).
 *  - Messages still in memory but not yet flushed to disk survive only as a
 *    contiguous suffix after the last matched entry (optimistic user bubble,
 *    just-committed assistant reply) — otherwise a reload would momentarily
 *    drop the live tail (the "bubble disappears then repeats" flicker).
 *  - When nothing matches at all (branch switch, file reorganized), the file
 *    input wins entirely. */
export function mergePersistedMessages(persisted: AgentMessage[], current: AgentMessage[]): AgentMessage[] {
  if (persisted.length === 0) return current;
  if (current.length === 0) return persisted;

  const used = new Array<boolean>(current.length).fill(false);
  const merged: AgentMessage[] = [];
  let lastMatched = -1;

  for (const persistedMsg of persisted) {
    const key = messageEntryKey(persistedMsg);
    let matchIdx = -1;
    for (let i = lastMatched + 1; i < current.length; i++) {
      if (used[i]) continue;
      if (messageEntryKey(current[i]) !== key) continue;
      matchIdx = i;
      break;
    }
    if (matchIdx === -1) {
      merged.push(persistedMsg);
      continue;
    }
    used[matchIdx] = true;
    lastMatched = matchIdx;
    const live = current[matchIdx];
    const paused = persistedMsg.role === "assistant" && !assistantAtLeastAsFull(live, persistedMsg);
    merged.push(paused ? persistedMsg : live);
  }

  if (lastMatched >= 0) {
    for (let i = lastMatched + 1; i < current.length; i++) {
      if (!used[i]) merged.push(current[i]);
    }
  }
  return merged;
}