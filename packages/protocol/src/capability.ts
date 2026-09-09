/**
 * Additive capability descriptors.
 *
 * A harness advertises which capabilities it can run. Capabilities are
 * OPTIONAL and ADDITIVE: a harness may implement any subset, and a new name
 * merely extends the set — it never changes the contract or forces existing
 * harnesses to change. Nothing here is Pi-specific, so future harnesses are
 * described in the same language.
 */
import type { Schema } from "./schema.ts";
import type { Result } from "./result.ts";
import { ok, fail } from "./result.ts";
import {
  object,
  enum_ as enumSchema,
  number as numberSchema,
  boolean as booleanSchema,
  optional,
  nonEmptyString as nonEmptyStringSchema,
} from "./schema.ts";
import { invalidField } from "./errors.ts";

/**
 * The additive capability set a harness may advertise. This is the canonical,
 * protocol-neutral list — Pi implements all of these as first-class, but the
 * set is deliberately wider than any single harness so new harnesses add, they
 * do not redefine.
 */
export type CapabilityName =
  | "streaming"
  | "steering"
  | "follow-ups"
  | "models"
  | "thinking"
  | "tools"
  | "permissions"
  | "attachments"
  | "commands"
  | "extensions"
  | "subagents";

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  "streaming",
  "steering",
  "follow-ups",
  "models",
  "thinking",
  "tools",
  "permissions",
  "attachments",
  "commands",
  "extensions",
  "subagents",
] as const satisfies readonly CapabilityName[];

/**
 * A capability descriptor. `required` marks a capability a harness cannot run
 * without; it is informational so an adapter can self-describe its minimum
 * surface. The descriptor shape is the same for every harness.
 */
export interface CapabilityDescriptor {
  name: CapabilityName;
  version: number;
  required?: boolean;
  description?: string;
}

export const capabilityDescriptorSchema: Schema<CapabilityDescriptor> = object({
  name: enumSchema(CAPABILITY_NAMES),
  version: numberSchema(),
  required: optional(booleanSchema()),
  description: optional(nonEmptyStringSchema()),
});

/** The capability names a harness advertises, in declaration order. */
export function advertisedNames(descriptors: CapabilityDescriptor[]): CapabilityName[] {
  return descriptors.map((d) => d.name);
}

/** Whether `name` is among the adapter's advertised capabilities. */
export function isCapabilitySupported(name: CapabilityName, advertised: CapabilityName[]): boolean {
  return advertised.includes(name);
}

/**
 * The capabilities an operation requires that the adapter does not advertise.
 * Empty means every required capability is present (the operation is allowed);
 * a non-empty result is the unsupported-capability gap the daemon reports.
 */
export function capabilityGaps(required: CapabilityName[], advertised: CapabilityName[]): CapabilityName[] {
  const set = new Set(advertised);
  const gaps: CapabilityName[] = [];
  for (const name of required) if (!set.has(name)) gaps.push(name);
  return gaps;
}

/** True when no required capability is missing — i.e. the operation is allowed. */
export function capabilityMet(required: CapabilityName[], advertised: CapabilityName[]): boolean {
  return capabilityGaps(required, advertised).length === 0;
}

/** Runtime check used by contract tests to prove the set is closed. */
export function assertKnownCapability(name: unknown): Result<CapabilityName> {
  return (typeof name === "string" && (CAPABILITY_NAMES as readonly string[]).includes(name))
    ? ok(name as CapabilityName)
    : fail(invalidField("capability", `one of [${CAPABILITY_NAMES.join(", ")}]`));
}
