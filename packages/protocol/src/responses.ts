/**
 * Responses: daemon -> client terminal results. Unlike events, a response is
 * the last message for a command — no further frames follow.
 */
import type { Schema } from "./schema.ts";
import { envelope } from "./envelope.ts";
import { createEnvelope } from "./envelope.ts";
import type { Envelope } from "./envelope.ts";
import { object, string as stringSchema, number as numberSchema, boolean as booleanSchema, optional, record, array } from "./schema.ts";

export const HELLO_RESPONSE = "cowork.v1.response.hello";
export const COMMAND_RESPONSE = "cowork.v1.response.command";

export interface HelloResponsePayload {
  sessionId: string;
  protocolVersion: number;
  capabilities: Array<{ name: string; version: number }>;
}

export interface CommandResponsePayload {
  sessionId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export const responseTags = { HELLO_RESPONSE, COMMAND_RESPONSE } as const;

export const helloResponse: Schema<import("./envelope.ts").Envelope<HelloResponsePayload>> = envelope(HELLO_RESPONSE,
  object({
    sessionId: stringSchema(),
    protocolVersion: numberSchema(),
    capabilities: array(object({ name: stringSchema(), version: numberSchema() })),
  }),
);

export const command: Schema<import("./envelope.ts").Envelope<CommandResponsePayload>> = envelope(COMMAND_RESPONSE,
  object({
    sessionId: stringSchema(),
    ok: booleanSchema(),
    result: optional(record()),
    error: optional(object({ code: stringSchema(), message: stringSchema() })),
  }),
);

/** Build a valid hello-response envelope. */
export function createHelloResponseEnvelope(payload: HelloResponsePayload): Envelope<HelloResponsePayload> {
  return createEnvelope(HELLO_RESPONSE, payload);
}

/** Build a valid command-response envelope. */
export function createCommandResponseEnvelope(payload: CommandResponsePayload): Envelope<CommandResponsePayload> {
  return createEnvelope(COMMAND_RESPONSE, payload);
}
