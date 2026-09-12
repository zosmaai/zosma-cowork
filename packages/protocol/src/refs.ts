/**
 * Artifact and attachment references (ZOS-98).
 *
 * A machine-local file is addressed across the protocol ONLY as a pair of
 * `(root, path)` where `root` is an approved workspace root (absolute) and
 * `path` is RELATIVE to it — never an arbitrary absolute filesystem path.
 * This keeps the remote surface free of raw host paths: a client can only
 * name files inside the roots the daemon has approved for it, and every
 * operation re-enforces that with the lexical + realpath containment gates.
 *
 * The schemas here define the wire SHAPE; the daemon/reference resolution
 * enforces the containment SEMANTICS (`root` must be approved, `path` must
 * not escape, must resolve inside the realpath of the root).
 */
import type { Schema } from "./schema.ts";
import { object, string as stringSchema, number as numberSchema, optional, enum_ } from "./schema.ts";

/** An artifact: any file or directory inside an approved root, named by a
 *  relative path. `kind` mirrors the stat result so callers can branch
 *  without an extra round trip. */
export interface ArtifactReference {
  root: string;
  path: string;
  kind?: "file" | "dir";
}

/** An attachment: a bounded artifact (e.g. an agent image) with its byte
 *  size so the client can display/constrain before any transfer. */
export interface AttachmentReference {
  root: string;
  path: string;
  size: number;
  mime?: string;
}

export const artifactReference: Schema<ArtifactReference> = object({
  root: stringSchema(),
  path: stringSchema(),
  kind: optional(enum_(["file", "dir"] as const)),
});

export const attachmentReference: Schema<AttachmentReference> = object({
  root: stringSchema(),
  path: stringSchema(),
  size: numberSchema(),
  mime: optional(stringSchema()),
});