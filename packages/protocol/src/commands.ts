/**
 * Commands: client -> daemon requests. These are the only messages a client
 * may send; the daemon never answers a command with another command.
 */
import type { Schema } from "./schema.ts";
import { envelope } from "./envelope.ts";
import { createEnvelope } from "./envelope.ts";
import type { Envelope } from "./envelope.ts";
import { object, string as stringSchema, number as numberSchema, optional, enum_ as enumSchema } from "./schema.ts";

export const HELLO = "cowork.v1.command.hello";
export const SAY = "cowork.v1.command.say";
export const STOP = "cowork.v1.command.stop";

export interface HelloCommandPayload {
  name: string;
  version: number;
  sessionId?: string;
}

export interface SayCommandPayload {
  sessionId: string;
  text: string;
  mode?: "agent" | "thinking";
}

export interface StopCommandPayload {
  sessionId: string;
}

/** Type tag set — the full set of commands the daemon understands. */
export const commandTags = { HELLO, SAY, STOP } as const;

export const hello: Schema<import("./envelope.ts").Envelope<HelloCommandPayload>> = envelope(HELLO,
  object({
    name: stringSchema(),
    version: numberSchema(),
    sessionId: optional(stringSchema()),
  }),
);

export const say: Schema<import("./envelope.ts").Envelope<SayCommandPayload>> = envelope(SAY,
  object({
    sessionId: stringSchema(),
    text: stringSchema(),
    mode: optional(enumSchema(["agent", "thinking"] as const)),
  }),
);

export const stop: Schema<import("./envelope.ts").Envelope<StopCommandPayload>> = envelope(STOP,
  object({
    sessionId: stringSchema(),
  }),
);

/** Build a valid hello command envelope with a fresh correlation id and timestamp. */
export function createHelloEnvelope(payload: HelloCommandPayload): Envelope<HelloCommandPayload> {
  return createEnvelope(HELLO, payload);
}

/** Build a valid say command envelope. */
export function createSayEnvelope(payload: SayCommandPayload): Envelope<SayCommandPayload> {
  return createEnvelope(SAY, payload);
}

/** Build a valid stop command envelope. */
export function createStopEnvelope(payload: StopCommandPayload): Envelope<StopCommandPayload> {
  return createEnvelope(STOP, payload);
}
