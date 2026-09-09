/**
 * Normalized harness session state.
 *
 * This is the protocol-neutral state a session is reported in. The native
 * session id (a Claude Code / ACP / Pi id) stays in {@link SessionHandle}
 * alongside this state and is never merged into a normalized field, so native
 * protocol details do not leak into the normalized boundary.
 */
import type { Schema } from "./schema.ts";
import {
  object,
  enum_ as enumSchema,
  string as stringSchema,
  number as numberSchema,
  optional,
} from "./schema.ts";

/** A harness session's position in its lifecycle, from the daemon's view. */
export type SessionState =
  | "created"
  | "starting"
  | "running"
  | "paused"
  | "idle"
  | "resumed"
  | "closed"
  | "errored"
  | "detached";

export const SESSION_STATES: readonly SessionState[] = [
  "created",
  "starting",
  "running",
  "paused",
  "idle",
  "resumed",
  "closed",
  "errored",
  "detached",
] as const satisfies readonly SessionState[];

/**
 * Allowed transitions. A harness must not skip states (e.g. it cannot be
 * `closed` from `created` without first `starting`, and `closed` is terminal).
 */
const STATE_TRANSITIONS: Record<SessionState, SessionState[]> = {
  created:  ["running", "errored", "closed"],
  starting: ["running", "errored", "closed"],
  running:  ["paused", "idle", "errored", "closed"],
  paused:   ["running", "idle", "errored", "closed"],
  idle:     ["running", "errored", "closed"],
  resumed:  ["running", "errored", "closed"],
  errored:  ["running", "closed"],
  closed:   [],
  detached: ["running", "closed", "errored"],
};

export const sessionStateSchema: Schema<SessionState> = enumSchema(SESSION_STATES);

/** Whether the state machine permits `from -> to`. */
export function canTransition(from: SessionState, to: SessionState): boolean {
  const nexts = STATE_TRANSITIONS[from];
  return nexts ? nexts.includes(to) : false;
}

/**
 * A normalized handle to a harness session. `nativeSessionId` is kept separate
 * from the normalized payload so native identifiers never leak across the
 * normalized boundary.
 */
export interface SessionHandle {
  sessionId: string;
  state: SessionState;
  nativeSessionId?: string;
}

export const sessionHandleSchema: Schema<SessionHandle> = object({
  sessionId: stringSchema(),
  state: sessionStateSchema,
  nativeSessionId: optional(stringSchema()),
});
