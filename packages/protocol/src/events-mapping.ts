/**
 * Normalized event mapping boundary.
 *
 * A harness emits its own native event tags (Claude / ACP / Pi). The adapter
 * maps each native tag to one of {@link NORMALIZED_EVENT_KINDS}. The boundary:
 * only a normalized `kind` may appear in a normalized event; a native event's
 * own shape never crosses into the normalized payload.
 */
import type { Schema } from "./schema.ts";
import {
  object,
  enum_ as enumSchema,
  string as stringSchema,
  number as numberSchema,
  array,
  record as recordSchema,
} from "./schema.ts";

/** The normalized kinds every daemon understands, regardless of harness. */
export type NormalizedEventKind =
  | "message"
  | "tool"
  | "thinking"
  | "status"
  | "end"
  | "error";

export const NORMALIZED_EVENT_KINDS: readonly NormalizedEventKind[] = [
  "message",
  "tool",
  "thinking",
  "status",
  "end",
  "error",
] as const satisfies readonly NormalizedEventKind[];

/**
 * The single mapping point: a native event tag maps to one normalized kind.
 * An adapter owns this; the daemon never inspects native tags directly.
 */
export interface AdapterEventMapping {
  kind: NormalizedEventKind;
  /** Native event tag(s) that normalize to this kind. */
  nativeTypes: string[];
}

export const adapterEventMappingSchema: Schema<AdapterEventMapping> = object({
  kind: enumSchema(NORMALIZED_EVENT_KINDS),
  nativeTypes: array(stringSchema()),
});

/** Resolve a native event tag to its normalized kind, or undefined if unmapped. */
export function mapNativeEvent(mappings: AdapterEventMapping[], nativeTag: string): NormalizedEventKind | undefined {
  for (const mapping of mappings) if (mapping.nativeTypes.includes(nativeTag)) return mapping.kind;
  return undefined;
}

/**
 * A normalized event. `payload` is adapter-produced content only; it never
 * carries the native event's own fields, which is the leak boundary.
 */
export interface NormalizedEvent {
  cid: string;
  seq: number;
  kind: NormalizedEventKind;
  payload: Record<string, unknown>;
}

export const normalizedEventSchema: Schema<NormalizedEvent> = object({
  cid: stringSchema(),
  seq: numberSchema(),
  kind: enumSchema(NORMALIZED_EVENT_KINDS),
  payload: recordSchema(),
});
