// Model catalog invalidation — the catalog cache now lives in the daemon
// process (roadmap item 6: pi-backend read surface moved off the web tier).
// This is the web-tier entry point the auth / project-trust routes call after
// credential or trust changes to bust the daemon's cache.
import { daemonConfig, piRead } from "./daemon-client.ts";

export function invalidateModelsCache(): void {
  if (!daemonConfig()) return;
  void piRead("invalidate-models").catch(() => {
    // Daemon unreachable — the catalog TTL (60s) expires naturally.
  });
}
