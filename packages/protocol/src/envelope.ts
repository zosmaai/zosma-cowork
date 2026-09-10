/**
 * Envelope shapes + the shared validation they impose on every message:
 * a version, a correlation id, a type tag, and a timestamp, wrapping a
 * typed payload.
 */
import type { Schema, SpecObject } from "./schema.ts";
import type { Result } from "./result.ts";
import { ok, fail } from "./result.ts";
import { number as numberSchema, string as stringSchema } from "./schema.ts";
import { isSupportedVersion, CURRENT_VERSION } from "./version.ts";
import { invalidProtocolVersion, unknownType, invalidField } from "./errors.ts";
import type { Envelope, EnvelopePayload } from "./types.ts";
import { randomUUID } from "node:crypto";

// Re-export the envelope shapes so `import("./envelope.ts").Envelope` keeps
// working for the command/event/response validators without a new import graph.
export type { Envelope, EnvelopePayload } from "./types.ts";

/** A versioned message carrying a correlation id and a typed payload. */
const envelopeSpec: SpecObject = {
  v: numberSchema(),
  cid: stringSchema(),
  t: stringSchema(),
  ts: numberSchema(),
};

/**
 * Validate the transport headers (`v`, `cid`, `t`, `ts`) while preserving any
 * other fields (notably `payload`). `object(envelopeSpec)` would drop the
 * payload, so this checks each header individually and returns the whole input.
 */
function validateEnvelopeBase(value: unknown): Result<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) return fail(invalidField("root", "object"));
  const obj = value as Record<string, unknown>;
  for (const key of ["v", "cid", "t", "ts"] as const) {
    const schema = envelopeSpec[key]!;
    const res = schema(obj[key]);
    if (!res.ok) return fail(res.error);
  }
  return ok(obj);
}

/**
 * Validate a versioned envelope of exactly `expectedType` with a typed payload.
 * Order: base envelope -> protocol version -> type tag -> payload. This order
 * matters so a malformed envelope is reported before we even look at the payload.
 */
export const envelope = <P>(expectedType: string, payload: Schema<P>): Schema<Envelope<P>> =>
  (input) => {
    const base = validateEnvelopeBase(input);
    if (!base.ok) return fail(base.error);
    const baseValue = base.value;
    if (!isSupportedVersion(baseValue.v as number)) return fail(invalidProtocolVersion(1, baseValue.v));
    if (baseValue.t !== expectedType) return fail(unknownType(expectedType, baseValue.t));
    const payloadResult = payload(baseValue.payload);
    if (!payloadResult.ok) return fail(payloadResult.error);
    return ok({
      v: baseValue.v,
      cid: baseValue.cid,
      t: baseValue.t,
      ts: baseValue.ts,
      payload: payloadResult.value,
    } as Envelope<P>);
  };

/** Serialize an envelope to a plain, transport-neutral object. */
export function serialize<P>(envelope: Envelope<P>): Record<string, unknown> {
  return { v: envelope.v, cid: envelope.cid, t: envelope.t, ts: envelope.ts, payload: envelope.payload };
}

/** Parse a decoded JSON value into an envelope, keeping the raw shape. */
export function deserialize<P>(value: unknown): Result<Envelope<P>> {
  const base = validateEnvelopeBase(value);
  if (!base.ok) return fail(base.error);
  return base as unknown as Result<Envelope<P>>;
}

/** Runtime type guard for the transport-shaped envelope. */
export function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "v" in value &&
    "cid" in value &&
    "t" in value &&
    "ts" in value &&
    "payload" in value
  );
}

/**
 * Verify a decoded value carries the transport envelope for `expectedType`:
 * the protocol version is supported and the type tag matches. The payload is
 * passed through unchecked; use the typed `envelope(type, payloadSchema)`
 * validator when the payload shape must also be validated.
 */
export function verifyEnvelope(
  value: unknown,
  expectedType: string,
): Result<Envelope<unknown>> {
  const base = validateEnvelopeBase(value);
  if (!base.ok) return fail(base.error);
  const bv = base.value;
  if (!isSupportedVersion(bv.v as number)) {
    return fail(invalidProtocolVersion(1, bv.v));
  }
  if (bv.t !== expectedType) {
    return fail(unknownType(expectedType, bv.t));
  }
  return ok(bv as unknown as Envelope<unknown>);
}

/** Build a valid transport envelope for `type` carrying `payload`. */
export function createEnvelope<P>(type: string, payload: P): Envelope<P> {
  return { v: CURRENT_VERSION, cid: randomUUID(), t: type, ts: Date.now(), payload };
}
