/**
 * Transport-neutral envelope shapes shared across the protocol package.
 *
 * An `Envelope` carries transport headers (`v`, `cid`, `t`, `ts`) around a
 * typed `payload`. Nothing here imports Pi / UI / transport code.
 */

/** A versioned message carrying a correlation id and a typed payload. */
export interface Envelope<P = unknown> {
  /** Protocol version. */
  v: number;
  /** Correlation id tying a request to its response/events. */
  cid: string;
  /** Message type tag, e.g. `hello`, `say`, `stop`. */
  t: string;
  /** Creation timestamp in milliseconds since epoch. */
  ts: number;
  /** The typed message body. */
  payload: P;
}

/** The union of all wire payloads an envelope may carry. */
export type EnvelopePayload =
  | import("./commands.ts").HelloCommandPayload
  | import("./commands.ts").SayCommandPayload
  | import("./commands.ts").StopCommandPayload
  | import("./responses.ts").HelloResponsePayload
  | import("./responses.ts").CommandResponsePayload
  | import("./events.ts").MessageEventPayload
  | import("./events.ts").AgentEventPayload;
