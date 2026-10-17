/**
 * Capability manifest (ZOS-91).
 *
 * What this machine can do, advertised to the control plane on every `hello`.
 * Additive by contract: `manifestVersion` only moves for a breaking change,
 * everything else is added as a new optional field, and the plane stores the
 * manifest opaquely — a newer daemon must never need a plane change.
 *
 * `services` is the daemon's RPC surface. It is a literal list rather than a
 * reflection over the route tables: one array is cheaper and greppable, and a
 * new service is one line here.
 */
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

/** Manifest schema version. Additive changes keep this at 1. */
export const MANIFEST_VERSION = 1;

/** The daemon's RPC method surface (handlers live in the per-area `rpc.ts` files). */
export const DAEMON_SERVICES: readonly string[] = [
  "approval:cancel",
  "approval:list",
  "approval:reconnect",
  "approval:request",
  "approval:resolve",
  "auth:api-key-login",
  "auth:api-key-status",
  "auth:login-callback",
  "auth:login-cancel",
  "auth:login-start",
  "auth:login-status",
  "auth:logout",
  "auth:provider-listing",
  "auth:provider-models",
  "auth:remove-api-key",
  "auth:resolve-discovery",
  "auth:test-model",
  "cwd:validate",
  "files:index",
  "files:list",
  "files:read",
  "files:stat",
  "files:write",
  "git:diff",
  "git:status",
  "pi:cancel",
  "pi:close",
  "pi:command",
  "pi:dispose",
  "pi:health",
  "pi:list",
  "pi:probe",
  "pi:prompt",
  "pi:resume",
  "pi:start",
  "pi:update",
  "read:allow-root",
  "read:capabilities",
  "read:health",
  "read:invalidate-models",
  "read:list-sessions",
  "read:models",
  "read:pi-package-dir",
  "read:plugins-list",
  "read:plugins-manage",
  "read:project-trust",
  "read:session-context",
  "read:session-delete",
  "read:session-details",
  "read:session-entries",
  "read:session-rename",
  "read:session-thinking",
  "read:skills-check",
  "read:skills-install",
  "read:skills-list",
  "read:skills-search",
  "read:skills-toggle",
  "read:skills-update",
  "worktrees:create",
  "worktrees:list",
  "worktrees:remove",
];

/** The subset of a harness `AdapterManifest` the fleet needs (structural). */
export interface HarnessManifestLike {
  id: string;
  name: string;
  protocolVersion: number;
  capabilities: ReadonlyArray<{ name: string; version: number }>;
}

export interface AdapterDescriptor {
  id: string;
  name: string;
  protocolVersion: number;
  capabilities: Array<{ name: string; version: number }>;
}

export interface CapabilityManifest {
  manifestVersion: number;
  platform: string;
  arch: string;
  hostname: string;
  daemonVersion: string;
  node: string;
  adapters: AdapterDescriptor[];
  services: string[];
}

/** Daemon package version, read from disk so it cannot drift. */
function daemonVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function buildCapabilityManifest(
  adapters: readonly HarnessManifestLike[],
  env: NodeJS.ProcessEnv = process.env,
): CapabilityManifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    platform: process.platform,
    arch: process.arch,
    hostname: env.ZOSMA_MACHINE_NAME ?? hostname(),
    daemonVersion: daemonVersion(),
    node: process.version,
    adapters: adapters.map((a) => ({
      id: a.id,
      name: a.name,
      protocolVersion: a.protocolVersion,
      capabilities: a.capabilities.map((c) => ({ name: c.name, version: c.version })),
    })),
    services: [...DAEMON_SERVICES].sort(),
  };
}
