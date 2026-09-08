import { getRuntimeManager } from "./runtime-state";
import {
  autoNameSession as autoNameSessionFromServices,
  deleteSession as deleteSessionFromServices,
  getSessionContext as getSessionContextFromServices,
  getSessionDetails as getSessionDetailsFromServices,
  listSessions as listSessionsFromServices,
} from "../packages/pi-backend/sessions";

// Pure re-exports: names whose bodies need no live-runtime state.
export {
  attachSessionProjectInfo,
  buildSessionContext,
  cacheSessionPath,
  getAgentDir,
  getSessionEntries,
  getSessionThinking,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  listAllSessions,
  mergeSessionLists,
  readSessionHeader,
  renameSession,
  resolveSessionIdByPath,
  resolveSessionPath,
} from "../packages/pi-backend/sessions";

// Delegation wrappers: inject the process-wide runtime manager so the routes
// keep calling the same names without touching runtime-state themselves.
export async function listSessions(input: { force?: boolean } = {}) {
  return listSessionsFromServices(input, getRuntimeManager());
}
export async function getSessionDetails(input: {
  sessionId: string;
  deferThinking?: boolean;
  deferMedia?: boolean;
}) {
  return getSessionDetailsFromServices(input, getRuntimeManager());
}
export async function getSessionContext(input: {
  sessionId: string;
  leafId?: string;
  deferThinking?: boolean;
  deferMedia?: boolean;
}) {
  return getSessionContextFromServices(input, getRuntimeManager());
}
export async function deleteSession(input: { sessionId: string }) {
  return deleteSessionFromServices(input, getRuntimeManager());
}
export async function autoNameSession(input: { sessionId: string }) {
  return autoNameSessionFromServices(input, getRuntimeManager());
}
