/**
 * Runtime schema validators.
 *
 * Zero dependencies: each validator is a pure `(input) => Result` that returns
 * a discriminated result (see `result.ts`) rather than throwing, so a batch of
 * fields can be checked and the first failure reported as a stable `ProtocolError`.
 *
 * This is the smallest transport-neutral validation approach: nothing external
 * to be vendored, and it keeps the package free of any Pi/transport dependency.
 */
import type { ProtocolError } from "./errors.ts";
import type { Result } from "./result.ts";
import { ok, fail } from "./result.ts";
import { missingField, invalidField } from "./errors.ts";

/** A validator turns an unknown value into a `Result`. */
export type Schema<T> = (input: unknown) => Result<T, ProtocolError>;

/** A spec is a record of field name -> validator. */
export type SpecObject = Record<string, Schema<unknown>>;

/** Map a spec of validators to the inferred shape of a valid payload. */
export type Infer<Spec extends SpecObject> = {
  [K in keyof Spec]: Spec[K] extends Schema<infer T> ? T : never;
};

export const literal = <V extends string | number | boolean>(value: V): Schema<V> =>
  (input) => (input === value ? ok(value) : fail(invalidField("root", `literal ${JSON.stringify(value)}`)));

export const string = (path = "root"): Schema<string> =>
  (input) => (input === undefined ? fail(missingField(path)) : typeof input === "string" ? ok(input) : fail(invalidField(path, "string")));

export const nonEmptyString = (path = "root"): Schema<string> =>
  (input) =>
    input === undefined
      ? fail(missingField(path))
      : typeof input === "string" && input.length > 0
        ? ok(input)
        : fail(invalidField(path, "non-empty string"));

export const number = (path = "root"): Schema<number> =>
  (input) =>
    input === undefined
      ? fail(missingField(path))
      : typeof input === "number" && Number.isFinite(input)
        ? ok(input)
        : fail(invalidField(path, "number"));

export const boolean = (path = "root"): Schema<boolean> =>
  (input) =>
    input === undefined
      ? fail(missingField(path))
      : typeof input === "boolean"
        ? ok(input)
        : fail(invalidField(path, "boolean"));

export const enum_ = <V extends readonly string[]>(values: V): Schema<V[number]> => {
  const set = new Set(values);
  return (input) =>
    input === undefined
      ? fail(missingField("root"))
      : typeof input === "string" && set.has(input)
        ? ok(input)
        : fail(invalidField("root", `one of [${values.join(", ")}]`));
};

export const optional = <T>(inner: Schema<T>): Schema<T | undefined> =>
  (input) => (input === undefined ? ok(undefined) : inner(input));

export const record = (): Schema<Record<string, unknown>> =>
  (input) => (typeof input === "object" && input !== null ? ok(input as Record<string, unknown>) : fail(invalidField("root", "object")));

export const array = <T>(inner: Schema<T>): Schema<T[]> => {
  return (input) => {
    if (!Array.isArray(input)) return fail(invalidField("root", "array"));
    let firstError: ProtocolError | undefined;
    const out: T[] = new Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const res = inner(input[i]);
      if (!res.ok) {
        firstError ??= res.error;
        continue;
      }
      out[i] = res.value;
    }
    return firstError ? fail(firstError) : ok(out);
  };
};

export const object = <const Spec extends SpecObject>(spec: Spec): Schema<Infer<Spec>> => {
  const keys = Object.keys(spec);
  return (input) => {
    if (typeof input !== "object" || input === null) return fail(invalidField("root", "object"));
    const value = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let firstError: ProtocolError | undefined;
    for (const key of keys) {
      const fieldSchema = spec[key] as Schema<unknown> | undefined;
      if (!fieldSchema) continue; // unreachable: key originates from `spec`
      const res = fieldSchema(value[key]);
      if (!res.ok) {
        firstError ??= res.error;
        continue;
      }
      out[key] = res.value;
    }
    return firstError ? fail(firstError) : ok(out as Infer<Spec>);
  };
};
