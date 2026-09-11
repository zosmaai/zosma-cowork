// Assistant-message wire events (roadmap item 6 end-to-end: the SDK type
// graph was removed from web). Discriminated union matching the assistant-
// message event shape the stream reducer consumes.
export interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

interface BaseAssistantEvent {
  contentIndex: number;
}

interface TextStartEvent extends BaseAssistantEvent {
  type: "text_start";
}
interface TextDeltaEvent extends BaseAssistantEvent {
  type: "text_delta";
  delta: string;
}
interface TextEndEvent extends BaseAssistantEvent {
  type: "text_end";
  content: string;
}
interface ThinkingStartEvent extends BaseAssistantEvent {
  type: "thinking_start";
}
interface ThinkingDeltaEvent extends BaseAssistantEvent {
  type: "thinking_delta";
  delta: string;
}
interface ThinkingEndEvent extends BaseAssistantEvent {
  type: "thinking_end";
  content: string;
}
interface ToolcallStartEvent extends BaseAssistantEvent {
  type: "toolcall_start";
  id?: string;
  toolName?: string;
}
interface ToolcallDeltaEvent extends BaseAssistantEvent {
  type: "toolcall_delta";
  id?: string;
  toolName?: string;
  delta: string;
}
interface ToolcallEndEvent extends BaseAssistantEvent {
  type: "toolcall_end";
  toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
}

export type ClientAssistantMessageEvent =
  | TextStartEvent
  | TextDeltaEvent
  | TextEndEvent
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingEndEvent
  | ToolcallStartEvent
  | ToolcallDeltaEvent
  | ToolcallEndEvent;

export type ClientMessageUpdateEvent = {
  type: "message_update";
  assistantMessageEvent: ClientAssistantMessageEvent;
};

const OMITTED_EVENT_TYPES = new Set([
  "turn_start",
  "turn_end",
]);
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolCallMetadata(
  event: Record<string, unknown>,
): { id: string; toolName: string } | null {
  if (
    (event.type !== "toolcall_start" && event.type !== "toolcall_delta")
    || !isObject(event.partial)
  ) return null;
  const content = event.partial.content;
  const contentIndex = event.contentIndex;
  if (!Array.isArray(content) || typeof contentIndex !== "number") return null;

  const block = content[contentIndex];
  if (!isObject(block) || block.type !== "toolCall") return null;
  const id = typeof block.id === "string"
    ? block.id
    : (typeof block.toolCallId === "string" ? block.toolCallId : null);
  const toolName = typeof block.name === "string"
    ? block.name
    : (typeof block.toolName === "string" ? block.toolName : null);
  return id !== null && toolName !== null ? { id, toolName } : null;
}

/** Apply pi-web's event filters plus Pi 0.84's message_update projection. */
export function toClientAgentEvent(
  event: AgentEventLike,
): AgentEventLike | ClientMessageUpdateEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;

  if (event.type === "message_update") {
    const assistantMessageEvent = event.assistantMessageEvent;
    if (
      typeof assistantMessageEvent !== "object"
      || assistantMessageEvent === null
      || Array.isArray(assistantMessageEvent)
    ) return null;

    if (!("partial" in assistantMessageEvent)) {
      return {
        type: "message_update",
        assistantMessageEvent,
      } as ClientMessageUpdateEvent;
    }

    const metadata = toolCallMetadata(assistantMessageEvent as Record<string, unknown>);
    const { partial: _partial, ...deltaEvent } = assistantMessageEvent;
    void _partial;
    return {
      type: "message_update",
      assistantMessageEvent: metadata ? { ...deltaEvent, ...metadata } : deltaEvent,
    } as ClientMessageUpdateEvent;
  }

  if (event.type === "tool_execution_update") {
    return {
      type: "tool_execution_update",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      partialResult: event.partialResult,
    };
  }

  if (event.type === "agent_end") return { type: "agent_end" };
  return event;
}

export function isEventIncludedInSnapshot(
  event: AgentEventLike,
  snapshot: unknown,
): boolean {
  return snapshot !== undefined
    && (event.type === "message_start" || event.type === "message_update")
    && event.message === snapshot;
}
