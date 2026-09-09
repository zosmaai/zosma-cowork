/**
 * Events: daemon -> client stream. Every event carries an increasing `seq` so
 * a client can detect a dropped frame mid-conversation.
 */
import type { Schema } from "./schema.ts";
import { envelope } from "./envelope.ts";
import { object, string as stringSchema, number as numberSchema, boolean as booleanSchema, enum_ as enumSchema } from "./schema.ts";

export const MESSAGE = "cowork.v1.event.message";
export const AGENT = "cowork.v1.event.agent";

export interface MessageEventPayload {
  sessionId: string;
  seq: number;
  text: string;
  done: boolean;
}

export interface AgentEventPayload {
  sessionId: string;
  seq: number;
  kind: "tool_call" | "tool_result" | "end";
  text: string;
}

export const eventTags = { MESSAGE, AGENT } as const;

export const message: Schema<import("./envelope.ts").Envelope<MessageEventPayload>> = envelope(MESSAGE,
  object({
    sessionId: stringSchema(),
    seq: numberSchema(),
    text: stringSchema(),
    done: booleanSchema(),
  }),
);

export const agent: Schema<import("./envelope.ts").Envelope<AgentEventPayload>> = envelope(AGENT,
  object({
    sessionId: stringSchema(),
    seq: numberSchema(),
    kind: enumSchema(["tool_call", "tool_result", "end"] as const),
    text: stringSchema(),
  }),
);
