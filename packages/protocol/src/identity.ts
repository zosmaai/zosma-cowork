/**
 * Identity / capability / session / correlation metadata.
 *
 * These are the non-payload facts attached to a handshake and carried on
 * envelopes. They are deliberately minimal and enum-validated so a peer can
 * reason about the other side without schema drift.
 */
import type { Schema } from "./schema.ts";
import { object, string as stringSchema, number as numberSchema, enum_ as enumSchema, optional } from "./schema.ts";

/** A stable identifier for a peer (agent or client). */
export interface Identity {
  id: string;
  name: string;
}

/** A session the daemon owns. */
export type SessionKind = "local" | "cloud";

/** A declared capability a peer advertises during negotiation. */
export type CapabilityName = "streaming" | "stop" | "thinking";

/** A capability with its own version, so capability negotiation is versioned. */
export interface Capability {
  name: CapabilityName;
  version: number;
}

/** A session reference. */
export interface Session {
  id: string;
  kind: SessionKind;
}

/**
 * A correlation id is just a non-empty string. It ties events/responses back
 * to the command that produced them across a streaming conversation.
 */
export type CorrelationId = string;

export const identitySchema: Schema<Identity> = object({
  id: stringSchema(),
  name: stringSchema(),
});

export const capabilitySchema: Schema<Capability> = object({
  name: enumSchema(["streaming", "stop", "thinking"] as const),
  version: numberSchema(),
});

export const sessionSchema: Schema<Session> = object({
  id: stringSchema(),
  kind: enumSchema(["local", "cloud"] as const),
});

/** The correlation-id validator. Optional: a peer may omit it on a greeting. */
export const correlationId: Schema<CorrelationId | undefined> = optional(stringSchema());
