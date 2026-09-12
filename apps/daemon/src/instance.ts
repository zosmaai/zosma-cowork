/**
 * Single-instance protection for the daemon.
 *
 * Uses a lock file in the daemon's data directory. A second instance that finds
 * a live lock exits (option) instead of starting a second daemon. "Live" means
 * the recorded PID is still running AND the recorded health endpoint answers;
 * a stale lock (dead PID) is reclaimed so a hung first instance doesn't wedge
 * future launches forever.
 */
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface DaemonInstance {
  id: string;
  lockPath: string;
  dataDir: string;
  acquire(): boolean;
  release(): void;
}

export interface InstanceOptions {
  dataDir?: string;
  /** process to treat as the owner for liveness (default: process) */
  owner?: { pid: number };
  /** caller-provided ping, used to judge a running instance (default: none) */
  ping?: () => Promise<boolean>;
}

const STALE_MS = 15_000;

export function createInstance(options: InstanceOptions = {}): DaemonInstance {
  const dataDir = options.dataDir ?? join(tmpdir(), "zosma-cowork", "daemon");
  const owner = options.owner ?? process;
  const lockPath = join(dataDir, "daemon.lock");

  function isAlive(pid: number): boolean {
    if (pid === owner.pid) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function isStale(lock: { pid: number; ts: number }): boolean {
    return !isAlive(lock.pid) || Date.now() - lock.ts > STALE_MS;
  }

  function readLock(): { id: string; pid: number; port?: number; ts: number } | null {
    if (!existsSync(lockPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(lockPath, "utf8"));
      if (!parsed || typeof parsed.pid !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  return {
    id: "",
    dataDir,
    lockPath,
    acquire(): boolean {
      const existing = readLock();
      if (existing) {
        if (!isStale(existing)) {
          this.id = existing.id;
          return false;
        }
        // stale lock — reclaim
      }
      mkdirSync(dataDir, { recursive: true });
      const now = {
        id: randomUUID(),
        pid: owner.pid,
        ts: Date.now(),
      };
      writeFileSync(lockPath, JSON.stringify(now), { mode: 0o600 });
      this.id = now.id;
      return true;
    },
    release(): void {
      const lock = readLock();
      // only delete when we own it (pid + id match)
      if (lock && lock.pid === owner.pid && lock.id === this.id) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          /* already gone */
        }
        this.id = "";
      }
    },
  };
}
