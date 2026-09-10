/**
 * Durable session-to-harness mapping (ZOS-89).
 *
 * Persists a session record — a {@link SessionHandle} plus the harness
 * context (adapter id, workspace, pid, timestamp) — to a JSON file. On load,
 * the only real logic is **recovery**: invalid records are dropped and the
 * rest rebuilt, so a partially-corrupt file never wedges the daemon.
 *
 * Writes are atomic: a sibling temp file is written then renamed over the
 * target, so a crash mid-write can never leave a half-written store.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";

import { object, nonEmptyString, optional, number } from "./schema.ts";
import { sessionHandleSchema } from "./session-state.ts";
import type { SessionHandle } from "./session-state.ts";

/**
 * A persisted session record: the normalized {@link SessionHandle} plus the
 * harness context needed to reconnect after a restart.
 */
export interface SessionRecord {
  handle: SessionHandle;
  adapterId?: string;
  workspace?: string;
  pid?: number;
  createdAt?: number;
}

const sessionRecordSpec = {
  handle: sessionHandleSchema,
  adapterId: optional(nonEmptyString("adapterId")),
  workspace: optional(nonEmptyString("workspace")),
  pid: optional(number("pid")),
  createdAt: optional(number("createdAt")),
} satisfies { [K: string]: import("./schema.ts").Schema<unknown> };

/** Schema for a persisted session record (see {@link SessionRecord}). */
export const sessionRecordSchema = object(sessionRecordSpec);

/** Outcome of rebuilding a store payload on load. */
export interface RecoveredSessions {
  ok: SessionRecord[];
  dropped: number;
  invalid: number;
}

/**
 * Rebuild session records from a raw stored payload. Keeps every record that
 * validates against {@link sessionRecordSchema}, drops the rest. The "logic"
 * of ZOS-89 lives here: recovery, not persistence.
 */
export function recover(raw: unknown): RecoveredSessions {
  if (!Array.isArray(raw)) return { ok: [], dropped: 0, invalid: 0 };
  let dropped = 0;
  const ok: SessionRecord[] = [];
  for (const entry of raw) {
    const res = sessionRecordSchema(entry);
    if (res.ok) ok.push(res.value as unknown as SessionRecord);
    else dropped += 1;
  }
  return { ok, dropped, invalid: dropped };
}

/** The store file name within the store directory. */
export const STORE_FILENAME = "sessions.json";

/** The on-disk container shape. */
interface Stored {
  version: number;
  sessions: SessionRecord[];
}

/**
 * Durable, atomic store of session-to-harness mappings.
 */
export class SessionStore {
  private readonly dir: string;
  private readonly path: string;

  constructor(dir: string, filename = STORE_FILENAME) {
    this.dir = dir;
    this.path = join(dir, filename);
  }

  /** Load and recover records from disk. Missing/corrupt file = empty. */
  async load(): Promise<SessionRecord[]> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(this.path, "utf8"));
    } catch {
      return [];
    }
    // A bare array of records is recoverable directly; a wrapped container
    // ({ version, sessions }) exposes the records under `.sessions`.
    const records = Array.isArray(raw) ? raw : (raw as { sessions?: unknown }).sessions;
    return recover(records).ok;
  }

  async list(): Promise<SessionRecord[]> {
    return this.load();
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const all = await this.load();
    return all.find((r) => r.handle.sessionId === sessionId);
  }

  /**
   * Insert or overwrite the record for `sessionId` (dedup by session id),
   * then persist atomically.
   */
  async add(record: SessionRecord): Promise<SessionRecord[]> {
    const others = (await this.load()).filter(
      (r) => r.handle.sessionId !== record.handle.sessionId,
    );
    const next = [...others, record];
    await this.persist(next);
    return next;
  }

  /** Remove the record for `sessionId`, persist atomically. */
  async remove(sessionId: string): Promise<SessionRecord[]> {
    const next = (await this.load()).filter(
      (r) => r.handle.sessionId !== sessionId,
    );
    await this.persist(next);
    return next;
  }

  private async persist(records: SessionRecord[]): Promise<void> {
    const payload: Stored = { version: 1, sessions: records };
    const tmp = `${this.path}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tmp, this.path);
  }
}
