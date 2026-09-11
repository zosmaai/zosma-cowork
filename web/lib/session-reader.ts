// Session path helpers (roadmap item 6 end-to-end): every read operation now
// lives in the daemon's read:* ops; web keeps the path helpers needed to
// resolve session files for daemon resume and file-reference gates.
export {
  cacheSessionPath,
  getSessionEntries,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  listAllSessions,
  resolveSessionIdByPath,
  resolveSessionPath,
} from "./session-paths";