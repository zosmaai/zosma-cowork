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
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface StoredCommand {
  seq: number;
  correlationId: string;
  machineId: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface CommandStore {
  /** Append a command for a machine; resolves with its seq (starts at 1). */
  append(machineId: string, cmd: { correlationId: string; method: string; params?: Record<string, unknown> }): Promise<number>;
  /** Mark a command acked; idempotent (double ack is a no-op). */
  ack(correlationId: string): Promise<void>;
  /** Unacked commands for a machine, in seq order. */
  pending(machineId: string): Promise<StoredCommand[]>;
  /** Highest seq seen for a machine (0 when none). */
  watermark(machineId: string): number;
  close(): void;
}

export function createCommandStore(storeDir: string): CommandStore {
  mkdirSync(storeDir, { recursive: true });

  const machines = new Map<string, StoredCommand[]>();
  const acked = new Set<string>();

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
    async pending(machineId) {
      loadMachine(machineId);
      return machines.get(machineId)!.filter((c) => !acked.has(c.correlationId));
    },
    watermark(machineId) {
      loadMachine(machineId);
      const cmds = machines.get(machineId)!;
      return cmds.length === 0 ? 0 : cmds[cmds.length - 1]!.seq;
    },
    close() {
      machines.clear();
    },
  };
}