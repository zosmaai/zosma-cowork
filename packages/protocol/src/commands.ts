/**
 * Commands: client -> daemon requests. These are the only messages a client
 * may send; the daemon never answers a command with another command.
 */
import type { Schema } from "./schema.ts";
import { envelope } from "./envelope.ts";
import { createEnvelope } from "./envelope.ts";
import type { Envelope } from "./envelope.ts";
import { object, string as stringSchema, number as numberSchema, optional, enum_ as enumSchema } from "./schema.ts";

export const HELLO = "cowork.v1.command.hello";
export const SAY = "cowork.v1.command.say";
export const STOP = "cowork.v1.command.stop";
// File/workspace service commands (ZOS-98): the daemon owns filesystem
// access, so the client addresses files by an absolute `cwd` (an approved
// root) plus a RELATIVE `path` — never an arbitrary absolute path. Writes
// carry optional `expectedSha256` optimistic-concurrency protection.
export const FILES_LIST = "cowork.v1.command.files.list";
export const FILES_READ = "cowork.v1.command.files.read";
export const FILES_STAT = "cowork.v1.command.files.stat";
export const FILES_WRITE = "cowork.v1.command.files.write";
export const FILES_INDEX = "cowork.v1.command.files.index";

export interface HelloCommandPayload {
  name: string;
  version: number;
  sessionId?: string;
}

export interface SayCommandPayload {
  sessionId: string;
  text: string;
  mode?: "agent" | "thinking";
}

export interface StopCommandPayload {
  sessionId: string;
}

export interface FilesListCommandPayload {
  cwd: string;
}

export interface FilesStatCommandPayload {
  cwd: string;
  path: string;
}

export interface FilesReadCommandPayload {
  cwd: string;
  path: string;
}

export interface FilesWriteCommandPayload {
  cwd: string;
  path: string;
  content: string;
  expectedSha256?: string;
}

export interface FilesIndexCommandPayload {
  cwd: string;
  query?: string;
}

/** Type tag set — the full set of commands the daemon understands. */
export const commandTags = { HELLO, SAY, STOP, FILES_LIST, FILES_READ, FILES_STAT, FILES_WRITE, FILES_INDEX } as const;

export const hello: Schema<import("./envelope.ts").Envelope<HelloCommandPayload>> = envelope(HELLO,
  object({
    name: stringSchema(),
    version: numberSchema(),
    sessionId: optional(stringSchema()),
  }),
);

export const filesList: Schema<import("./envelope.ts").Envelope<FilesListCommandPayload>> = envelope(FILES_LIST,
  object({
    cwd: stringSchema(),
  }),
);

export const filesStat: Schema<import("./envelope.ts").Envelope<FilesStatCommandPayload>> = envelope(FILES_STAT,
  object({
    cwd: stringSchema(),
    path: stringSchema(),
  }),
);

export const filesRead: Schema<import("./envelope.ts").Envelope<FilesReadCommandPayload>> = envelope(FILES_READ,
  object({
    cwd: stringSchema(),
    path: stringSchema(),
  }),
);

export const filesWrite: Schema<import("./envelope.ts").Envelope<FilesWriteCommandPayload>> = envelope(FILES_WRITE,
  object({
    cwd: stringSchema(),
    path: stringSchema(),
    content: stringSchema(),
    expectedSha256: optional(stringSchema()),
  }),
);

export const filesIndex: Schema<import("./envelope.ts").Envelope<FilesIndexCommandPayload>> = envelope(FILES_INDEX,
  object({
    cwd: stringSchema(),
    query: optional(stringSchema()),
  }),
);

export const say: Schema<import("./envelope.ts").Envelope<SayCommandPayload>> = envelope(SAY,
  object({
    sessionId: stringSchema(),
    text: stringSchema(),
    mode: optional(enumSchema(["agent", "thinking"] as const)),
  }),
);

export const stop: Schema<import("./envelope.ts").Envelope<StopCommandPayload>> = envelope(STOP,
  object({
    sessionId: stringSchema(),
  }),
);

/** Build a valid hello command envelope with a fresh correlation id and timestamp. */
export function createHelloEnvelope(payload: HelloCommandPayload): Envelope<HelloCommandPayload> {
  return createEnvelope(HELLO, payload);
}

/** Build a valid say command envelope. */
export function createSayEnvelope(payload: SayCommandPayload): Envelope<SayCommandPayload> {
  return createEnvelope(SAY, payload);
}

/** Build a valid stop command envelope. */
export function createStopEnvelope(payload: StopCommandPayload): Envelope<StopCommandPayload> {
  return createEnvelope(STOP, payload);
}

/** Build a valid files:list command envelope. */
export function createFilesListEnvelope(payload: FilesListCommandPayload): Envelope<FilesListCommandPayload> {
  return createEnvelope(FILES_LIST, payload);
}

/** Build a valid files:stat command envelope. */
export function createFilesStatEnvelope(payload: FilesStatCommandPayload): Envelope<FilesStatCommandPayload> {
  return createEnvelope(FILES_STAT, payload);
}

/** Build a valid files:read command envelope. */
export function createFilesReadEnvelope(payload: FilesReadCommandPayload): Envelope<FilesReadCommandPayload> {
  return createEnvelope(FILES_READ, payload);
}

/** Build a valid files:write command envelope. */
export function createFilesWriteEnvelope(payload: FilesWriteCommandPayload): Envelope<FilesWriteCommandPayload> {
  return createEnvelope(FILES_WRITE, payload);
}

/** Build a valid files:index command envelope. */
export function createFilesIndexEnvelope(payload: FilesIndexCommandPayload): Envelope<FilesIndexCommandPayload> {
  return createEnvelope(FILES_INDEX, payload);
}
