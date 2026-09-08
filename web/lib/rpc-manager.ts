// ============================================================================
// rpc-manager (compatibility seam)
//
// Thin delegating layer so every route and test that imports `@/lib/rpc-manager`
// keeps working. All real logic now lives in the pi-backend package:
//   - web/packages/pi-backend/runtime.ts        -> AgentSessionWrapper facade
//   - web/packages/pi-backend/runtime-manager.ts -> live-session registry core
//   - web/lib/runtime-state.ts                    -> globalThis keys + singleton
//
// The public surface is exported unchanged. `rpc-session-info.test.mjs` still
// writes `globalThis.__piSessions`; the registry reads that same map, so the
// key contract is preserved verbatim.
// ============================================================================

import type { SessionInfo } from "./types";
import { getRuntimeManager } from "./runtime-state";
import { AgentSessionWrapper } from "../packages/pi-backend/runtime";
import type { RpcSessionStartOptions } from "../packages/pi-backend/runtime-manager";

export type { AgentEvent, AgentRuntimeHooks } from "../packages/pi-backend/runtime";
export { AgentSessionWrapper } from "../packages/pi-backend/runtime";
export type { RpcSessionStartOptions } from "../packages/pi-backend/runtime-manager";

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRuntimeManager().getSession(sessionId);
}

export function getRpcSessionInfos(): SessionInfo[] {
  return getRuntimeManager().getSessionInfos();
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  return getRuntimeManager().hasBusySessionForCwd(cwd);
}

export async function destroyRpcSessionsForCwd(cwd: string): Promise<number> {
  return getRuntimeManager().destroySessionsForCwd(cwd);
}

export function getRunningRpcSessionIds(): string[] {
  return getRuntimeManager().getRunningSessionIds();
}

export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  return getRuntimeManager().subscribeRunningSessions(listener);
}

export function notifyRunningChange(): void {
  getRuntimeManager().notifyRunningChange();
}

export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  return getRuntimeManager().startSession(sessionId, sessionFile, cwd, options);
}
