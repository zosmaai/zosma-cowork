import type { AgentSessionWrapper } from "../packages/pi-backend/runtime";
import { createRuntimeManager } from "../packages/pi-backend/runtime-manager";
import type { RuntimeManager, RuntimeState } from "../packages/pi-backend/runtime-manager";

// ============================================================================
// globalThis keys
// Process-wide registry, cold-start locks, per-cwd busy tracking, and
// running-session listeners. Survives Next.js hot reload; first access creates
// the maps and registers a one-time cleanup. `rpc-session-info` reads them
// directly, so the keys must stay verbatim.
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, import("../packages/pi-backend/runtime-manager").ColdStartPromise> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
  var __piRuntimeManager: RuntimeManager | undefined;
}

function firstAccess(): void {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map<string, AgentSessionWrapper>();
    globalThis.__piStartLocks = new Map<string, import("../packages/pi-backend/runtime-manager").ColdStartPromise>();
    globalThis.__piStartingSessionCwds = new Map<string, number>();
    globalThis.__piRunningListeners = new Set<(ids: string[]) => void>();
    const cleanup = () => globalThis.__piSessions?.forEach((session) => session.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
}

/**
 * Exposes the four globalThis-backed maps as a single RuntimeState object.
 * Built inline on every call so it always reflects the current globalThis keys
 * (tests mutate them directly before querying).
 */
function getRuntimeState(): RuntimeState {
  firstAccess();
  return {
    registry: globalThis.__piSessions as Map<string, AgentSessionWrapper>,
    startLocks: globalThis.__piStartLocks as RuntimeState["startLocks"],
    startingSessionCwds: globalThis.__piStartingSessionCwds as RuntimeState["startingSessionCwds"],
    runningListeners: globalThis.__piRunningListeners as RuntimeState["runningListeners"],
  };
}

export function getRuntimeManager(): RuntimeManager {
  const existing = globalThis.__piRuntimeManager as RuntimeManager | undefined;
  if (existing) {
    // Re-point the maps at the current globalThis state so the frozen globalThis
    // keys (reassigned by tests and Next.js hot reload) stay current.
    existing.refreshState();
    return existing;
  }
  const manager = createRuntimeManager(getRuntimeState(), undefined, getRuntimeState);
  globalThis.__piRuntimeManager = manager;
  return manager;
}
