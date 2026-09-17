/**
 * Durable machine identity (ZOS-91).
 *
 * One record per machine in the daemon's data dir (`machine.json`, mode 0600):
 * a stable `machineId` that survives restarts, an `installId` identifying this
 * install instance, and `createdAt`.
 *
 * Identity rules (ZOS-91 decision **(a)**: the machine is the box, not the
 * login — a provider/credential change never rotates identity):
 *
 *  1. a persisted record wins, and a legacy bare `machine.id` is migrated to
 *     the record form **without rotating the id** (upgrading a daemon must not
 *     orphan the control plane's existing machine record);
 *  2. `ZOSMA_MACHINE_ID` is adopted when nothing is persisted yet;
 *  3. `ZOSMA_MACHINE_ID` that *conflicts* with the persisted id throws — a
 *     changed env value must never silently claim another machine's record;
 *  4. only `ZOSMA_MACHINE_ID_RESET=1` rotates, and it is idempotent when the
 *     target id is already the persisted one (a stuck flag must not churn the
 *     identity on every boot).
 *
 * No hardware anchoring: a host fingerprint is a privacy cost with no
 * cross-platform story, and `machine.json` in the data volume plus `installId`
 * already separates machines and re-installs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Identity record schema version (additive: new fields keep this at 1). */
export const IDENTITY_VERSION = 1;

export interface MachineIdentity {
  version: number;
  machineId: string;
  createdAt: string;
  installId: string;
  name: string;
}

export function identityPaths(dataDir: string): { json: string; legacy: string } {
  return { json: join(dataDir, "machine.json"), legacy: join(dataDir, "machine.id") };
}

function persist(dataDir: string, identity: MachineIdentity): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(identityPaths(dataDir).json, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
}

/** A corrupt/missing record is treated as absent — booting beats crashing. */
function readIdentity(dataDir: string): MachineIdentity | undefined {
  const p = identityPaths(dataDir).json;
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<MachineIdentity>;
    if (typeof raw?.machineId !== "string" || !raw.machineId) return undefined;
    return {
      version: typeof raw.version === "number" ? raw.version : IDENTITY_VERSION,
      machineId: raw.machineId,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      installId: typeof raw.installId === "string" && raw.installId ? raw.installId : randomUUID(),
      name: typeof raw.name === "string" && raw.name ? raw.name : hostname(),
    };
  } catch {
    return undefined;
  }
}

/** Legacy `<dataDir>/machine.id` (bare id) → record form, same id. */
function migrateLegacy(dataDir: string, env: NodeJS.ProcessEnv): MachineIdentity | undefined {
  const { legacy } = identityPaths(dataDir);
  if (!existsSync(legacy)) return undefined;
  const machineId = readFileSync(legacy, "utf8").trim();
  if (!machineId) return undefined;
  const migrated: MachineIdentity = {
    version: IDENTITY_VERSION,
    machineId,
    createdAt: new Date().toISOString(),
    installId: randomUUID(),
    name: env.ZOSMA_MACHINE_NAME ?? hostname(),
  };
  persist(dataDir, migrated);
  return migrated;
}

function generateId(): string {
  return `machine-${randomUUID().slice(0, 8)}`;
}

/** Resolve (creating/migrating/rotating as needed) this machine's identity. */
export function loadMachineIdentity(dataDir: string, env: NodeJS.ProcessEnv = process.env): MachineIdentity {
  const existing = readIdentity(dataDir) ?? migrateLegacy(dataDir, env);
  const requested = env.ZOSMA_MACHINE_ID;
  const reset = env.ZOSMA_MACHINE_ID_RESET === "1";
  const name = env.ZOSMA_MACHINE_NAME ?? existing?.name ?? hostname();

  if (existing && !reset) {
    if (requested && requested !== existing.machineId) {
      throw new Error(
        `ZOSMA_MACHINE_ID "${requested}" conflicts with the persisted machine identity "${existing.machineId}" ` +
          `(${identityPaths(dataDir).json}). Set ZOSMA_MACHINE_ID_RESET=1 to rotate the identity intentionally, ` +
          `or unset ZOSMA_MACHINE_ID.`,
      );
    }
    return name === existing.name ? existing : persistAnd(dataDir, { ...existing, name });
  }

  // No identity yet → adopt the env id when given, else generate.
  if (!existing) return persistAnd(dataDir, { version: IDENTITY_VERSION, machineId: requested ?? generateId(), createdAt: new Date().toISOString(), installId: randomUUID(), name });

  // Reset with the id already in place is a no-op — a stuck flag must not churn.
  if (requested && requested === existing.machineId) return name === existing.name ? existing : persistAnd(dataDir, { ...existing, name });

  // Intentional rotation (ZOSMA_MACHINE_ID_RESET=1): new identity from now.
  return persistAnd(dataDir, { version: IDENTITY_VERSION, machineId: requested ?? generateId(), createdAt: new Date().toISOString(), installId: randomUUID(), name });
}

function persistAnd(dataDir: string, identity: MachineIdentity): MachineIdentity {
  persist(dataDir, identity);
  return identity;
}
