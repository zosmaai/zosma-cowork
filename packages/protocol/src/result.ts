/**
 * A tiny Result type used by every validator. Chaining validators never throws
 * — it returns a discriminated `{ ok, value }` or `{ ok: false, error }` so a
 * caller can decide how to report a failure instead of unwinding the stack.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = { readonly ok: false; readonly error: import("./errors.ts").ProtocolError };
export type Result<T, E = import("./errors.ts").ProtocolError> = Ok<T> | Err;

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: import("./errors.ts").ProtocolError): Result<T> {
  return { ok: false, error };
}

/** Extract the value or throw the captured `ProtocolError`. */
export function expect<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}

/** True when a validator produced `{ ok: true }`. */
export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}
