/**
 * Command store for the control plane (ZOS-96).
 *
 * Durable per-machine command log: one JSONL file per machine under
 * `storeDir` (`<machineId>.jsonl`), one line per command, seq starting at 1.
 * Acks live in `<machineId>.acks` (one correlationId per line). On create the
 * store replays both files into memory so acked commands stay acked and
 * pendings stay pending across control-plane restarts. Volume is low (fleet
 * command push), so append-only files + in-memory state is the lazy, durable
 * choice — no SQLite until queries need it.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StoredCommand {
  seq: number;
  correlationId: string;
  machineId: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * A registered machine (ZOS-91). Durable: registrations survive a plane
 * restart, so an offline machine stays in the registry.
 */
export interface MachineRecord {
  machineId: string;
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Capability manifest, stored opaquely — the plane never re-validates it. */
  manifest?: unknown;
}

export interface CommandStore {
  /** Append a command for a machine; resolves with its seq (starts at 1). */
  append(machineId: string, cmd: { correlationId: string; method: string; params?: Record<string, unknown> }): Promise<number>;
  /** Mark a command acked; idempotent (double ack is a no-op). */
  ack(correlationId: string): Promise<void>;
  /** Store a machine's reply for a pushed command; idempotent overwrite. */
  recordReply(correlationId: string, reply: { ok: boolean; data?: unknown; error?: { code: string; message: string } }): Promise<void>;
  /** A stored reply (undefined when the machine never answered). */
  reply(correlationId: string): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } } | undefined>;
  /** A stored command by correlation id (undefined when unknown). */
  command(machineId: string, correlationId: string): Promise<StoredCommand | undefined>;
  /** Unacked commands for a machine, in seq order. */
  pending(machineId: string): Promise<StoredCommand[]>;
  /** Highest seq seen for a machine (0 when none). */
  watermark(machineId: string): number;
  /** Register (idempotent upsert) a machine. Keeps the original `firstSeenAt`. */
  register(machineId: string, name: string, manifest?: unknown): Promise<MachineRecord>;
  /** Registered machines, excluding revoked ones. */
  registry(): Promise<MachineRecord[]>;
  /** Tombstone a machine: it leaves the registry and is refused on `hello`. */
  revoke(machineId: string): Promise<void>;
  isRevoked(machineId: string): boolean;
  /** Lift a revocation so the machine may register again. */
  clearRevocation(machineId: string): Promise<void>;
  close(): void;
}

export function createCommandStore(storeDir: string): CommandStore {
  mkdirSync(storeDir, { recursive: true });

  const machines = new Map<string, StoredCommand[]>();
  const acked = new Set<string>();
  const replies = new Map<string, { ok: boolean; data?: unknown; error?: { code: string; message: string } }>();

  // ZOS-91 registry: append-only JSONL (last line per machine wins) plus a
  // revocation tombstone file. Tombstones win on load, so a re-register cannot
  // resurrect a revoked machine.
  const records = new Map<string, MachineRecord>();
  const revoked = new Set<string>();
  const registryFile = join(storeDir, "machines.jsonl");
  const revokedFile = join(storeDir, "revoked.txt");

  function loadRegistry(): void {
    if (existsSync(registryFile)) {
      for (const line of readFileSync(registryFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line) as MachineRecord;
        if (rec?.machineId) records.set(rec.machineId, rec);
      }
    }
    if (existsSync(revokedFile)) {
      for (const line of readFileSync(revokedFile, "utf8").split("\n")) {
        if (line.trim()) revoked.add(line.trim());
      }
    }
  }
  loadRegistry();

  const file = (machineId: string, suffix: string) => join(storeDir, `${machineId}.${suffix}`);

  function loadMachine(machineId: string): void {
    if (machines.has(machineId)) return;
    const cmds: StoredCommand[] = [];
    const path = file(machineId, "jsonl");
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue;
        cmds.push(JSON.parse(line) as StoredCommand);
      }
    }
    const ackPath = file(machineId, "acks");
    if (existsSync(ackPath)) {
      for (const line of readFileSync(ackPath, "utf8").split("\n")) {
        if (line.trim()) acked.add(line.trim());
      }
    }
    const replyPath = file(machineId, "replies");
    if (existsSync(replyPath)) {
      for (const line of readFileSync(replyPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line) as { correlationId: string; reply: { ok: boolean; data?: unknown; error?: { code: string; message: string } } };
        replies.set(rec.correlationId, rec.reply);
      }
    }
    machines.set(machineId, cmds.sort((a, b) => a.seq - b.seq));
  }

  return {
    async append(machineId, cmd) {
      loadMachine(machineId);
      const cmds = machines.get(machineId)!;
      const seq = cmds.length === 0 ? 1 : cmds[cmds.length - 1]!.seq + 1;
      const stored: StoredCommand = { seq, machineId, ...cmd };
      cmds.push(stored);
      appendFileSync(file(machineId, "jsonl"), `${JSON.stringify(stored)}\n`);
      return seq;
    },
    async ack(correlationId) {
      if (acked.has(correlationId)) return; // idempotent
      acked.add(correlationId);
      for (const [machineId, cmds] of machines) {
        if (cmds.some((c) => c.correlationId === correlationId)) {
          appendFileSync(file(machineId, "acks"), `${correlationId}\n`);
          return;
        }
      }
    },
    async recordReply(correlationId, reply) {
      // Replays of a reconnect re-answer; last reply wins, one journal line.
      replies.set(correlationId, reply);
      for (const [machineId, cmds] of machines) {
        if (cmds.some((c) => c.correlationId === correlationId)) {
          appendFileSync(file(machineId, "replies"), `${JSON.stringify({ correlationId, reply })}\n`);
          return;
        }
      }
    },
    async reply(correlationId) {
      if (!replies.has(correlationId)) {
        // First access (e.g. after a plane restart): pull in reply journals
        // without forcing a full command-log load.
        for (const name of readdirSync(storeDir)) {
          if (name.endsWith(".replies")) loadMachine(name.slice(0, -".replies".length));
        }
      }
      return replies.get(correlationId);
    },
    async command(machineId, correlationId) {
      loadMachine(machineId);
      return machines.get(machineId)!.find((c) => c.correlationId === correlationId);
    },
    async pending(machineId) {
      loadMachine(machineId);
      return machines.get(machineId)!.filter((c) => !acked.has(c.correlationId));
    },
    watermark(machineId) {
      loadMachine(machineId);
      const cmds = machines.get(machineId)!;
      return cmds.length === 0 ? 0 : cmds[cmds.length - 1]!.seq;
    },
    async register(machineId, name, manifest) {
      const now = new Date().toISOString();
      const prev = records.get(machineId);
      const record: MachineRecord = {
        machineId,
        name,
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
        ...(manifest !== undefined ? { manifest } : {}),
      };
      records.set(machineId, record);
      appendFileSync(registryFile, `${JSON.stringify(record)}\n`);
      return record;
    },
    async registry() {
      return [...records.values()].filter((r) => !revoked.has(r.machineId));
    },
    async revoke(machineId) {
      if (revoked.has(machineId)) return; // idempotent
      revoked.add(machineId);
      appendFileSync(revokedFile, `${machineId}\n`);
    },
    isRevoked(machineId) {
      return revoked.has(machineId);
    },
    async clearRevocation(machineId) {
      if (!revoked.has(machineId)) return;
      revoked.delete(machineId);
      writeFileSync(revokedFile, [...revoked].map((id) => `${id}\n`).join(""));
    },
    close() {
      machines.clear();
      records.clear();
      revoked.clear();
    },
  };
}