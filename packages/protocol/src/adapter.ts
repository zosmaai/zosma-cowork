/**
 * The harness adapter interface — the protocol-neutral contract Cowork calls.
 *
 * A native harness (Pi) and any future harness both implement this contract;
 * orchestration depends only on it, not on any single harness. Native protocol
 * details (launch specifics, ids, payloads) stay inside the manifest and the
 * adapter, never in the normalized boundary.
 */
import type { Schema } from "./schema.ts";
import type { Result } from "./result.ts";
import type { ProtocolError } from "./errors.ts";
import {
  object,
  enum_ as enumSchema,
  string as stringSchema,
  number as numberSchema,
  optional,
  array,
} from "./schema.ts";
import { fail, ok } from "./result.ts";
import { invalidField } from "./errors.ts";
import type { CapabilityDescriptor, CapabilityName } from "./capability.ts";
import { capabilityDescriptorSchema, capabilityGaps } from "./capability.ts";

/** A stable identifier for an adapter, e.g. `pi`. */
export type AdapterId = string;

/**
 * Adapter family. `native` = first-class harness (Pi) with full behavior;
 * `acp` = table-driven generic adapter with a fixed subset.
 */
export type AdapterKind = "native" | "acp";

export const ADAPTER_KINDS: readonly AdapterKind[] = [
  "native",
  "acp",
] as const satisfies readonly AdapterKind[];

/** The lifecycle methods every harness implements. */
export type AdapterOp = "probe" | "start" | "resume" | "prompt" | "cancel" | "close" | "health";

export const ADAPTER_OPS: readonly AdapterOp[] = [
  "probe",
  "start",
  "resume",
  "prompt",
  "cancel",
  "close",
  "health",
] as const satisfies readonly AdapterOp[];

/** Human-readable lifecycle description (the documented contract surface). */
export const ADAPTER_OP_DESCRIPTIONS: Readonly<Record<AdapterOp, string>> = {
  probe:   "Confirm the adapter is present and launchable.",
  start:   "Spawn a fresh harness process.",
  resume:  "Attach to an existing native session.",
  prompt:  "Send a user turn and stream the reply.",
  cancel:  "Cancel the in-flight turn.",
  close:   "Terminate the harness process and free it.",
  health:  "Report liveness without side effects.",
};

/** Capabilities each lifecycle op requires. Empty = no capability gate. */
export interface AdapterOpSpec {
  requires: CapabilityName[];
  description: string;
}

export const ADAPTER_OPS_SPEC: Readonly<Record<AdapterOp, AdapterOpSpec>> = {
  probe:   { requires: [], description: ADAPTER_OP_DESCRIPTIONS.probe },
  start:   { requires: [], description: ADAPTER_OP_DESCRIPTIONS.start },
  resume:  { requires: ["streaming"], description: ADAPTER_OP_DESCRIPTIONS.resume },
  prompt:  { requires: ["streaming"], description: ADAPTER_OP_DESCRIPTIONS.prompt },
  cancel:  { requires: [], description: ADAPTER_OP_DESCRIPTIONS.cancel },
  close:   { requires: [], description: ADAPTER_OP_DESCRIPTIONS.close },
  health:  { requires: [], description: ADAPTER_OP_DESCRIPTIONS.health },
};

/** Per-value policy for a launch environment variable. */
export type EnvValuePolicy = "inherit" | "required" | "omit";

export const ENV_VALUE_POLICIES: readonly EnvValuePolicy[] = [
  "inherit",
  "required",
  "omit",
] as const satisfies readonly EnvValuePolicy[];

/** A named launch environment policy (dynamic keys, validated values). */
export type EnvPolicy = Record<string, EnvValuePolicy>;

const ENV_VALUE_SET: Readonly<Record<EnvValuePolicy, true>> = {
  inherit: true,
  required: true,
  omit: true,
};

export const envPolicyValueSchema: Schema<EnvValuePolicy> = enumSchema(ENV_VALUE_POLICIES);

export const envPolicySchema: Schema<EnvPolicy> = (input): Result<EnvPolicy> => {
  if (typeof input !== "object" || input === null) return fail(invalidField("root", "object"));
  const obj = input as Record<string, unknown>;
  let firstError: ProtocolError | undefined;
  const out: EnvPolicy = {};
  for (const [key, value] of Object.entries(obj)) {
    const res = envPolicyValueSchema(value);
    if (!res.ok) {
      firstError ??= res.error;
      continue;
    }
    out[key] = res.value;
  }
  return firstError ? fail(firstError) : ok(out);
};

/** Launch configuration for a harness. Kept inside the manifest, never shared. */
export interface AdapterConfig {
  vendor: string;
  version: string;
  binary?: string;
  launchArgs?: string[];
  envPolicy?: EnvPolicy;
  timeouts?: { startup?: number; prompt?: number; shutdown?: number };
}

/** An adapter's self-description, advertised to the daemon. */
export interface AdapterManifest {
  id: AdapterId;
  name: string;
  kind: AdapterKind;
  protocolVersion: number;
  capabilities: CapabilityDescriptor[];
  config: AdapterConfig;
}

export const adapterManifestSchema: Schema<AdapterManifest> = object({
  id: stringSchema(),
  name: stringSchema(),
  kind: enumSchema(ADAPTER_KINDS),
  protocolVersion: numberSchema(),
  capabilities: array(capabilityDescriptorSchema),
  config: object({
    vendor: stringSchema(),
    version: stringSchema(),
    binary: optional(stringSchema()),
    launchArgs: optional(array(stringSchema())),
    envPolicy: optional(envPolicySchema),
    timeouts: object({
      startup: optional(numberSchema()),
      prompt: optional(numberSchema()),
      shutdown: optional(numberSchema()),
    }),
  }),
});

/** Capability gaps for a lifecycle op given an adapter's advertised set. */
export function capabilityGapsForOp(op: AdapterOp, advertised: CapabilityName[]): CapabilityName[] {
  return capabilityGaps(ADAPTER_OPS_SPEC[op].requires, advertised);
}
