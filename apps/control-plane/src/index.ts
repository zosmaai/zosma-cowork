/**
 * Control plane entrypoint (ZOS-96).
 *
 * Env contract (mirrors the daemon's):
 *   ZOSMA_CONTROL_PLANE_TOKEN  shared Bearer token for WS + REST (required)
 *   ZOSMA_CONTROL_PLANE_PORT   listen port (default 64714)
 *   ZOSMA_CONTROL_PLANE_DATA   store dir (default <tmp>/zosma-cowork/control-plane)
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandStore } from "./store.ts";
import { createControlPlaneServer } from "./server.ts";

export { createCommandStore } from "./store.ts";
export { createControlPlaneServer } from "./server.ts";
export type { ControlPlaneServer, ControlPlaneServerOptions, RpcReply } from "./server.ts";
export type { CommandStore, StoredCommand } from "./store.ts";

export function resolveControlPlaneConfig(env: NodeJS.ProcessEnv = process.env) {
  const token = env.ZOSMA_CONTROL_PLANE_TOKEN;
  if (!token) throw new Error("ZOSMA_CONTROL_PLANE_TOKEN is required");
  const port = env.ZOSMA_CONTROL_PLANE_PORT ? Number(env.ZOSMA_CONTROL_PLANE_PORT) : 64714;
  const dataDir = env.ZOSMA_CONTROL_PLANE_DATA ?? join(tmpdir(), "zosma-cowork", "control-plane");
  return { token, port, dataDir };
}

export async function runControlPlane(env: NodeJS.ProcessEnv = process.env) {
  const { token, port, dataDir } = resolveControlPlaneConfig(env);
  const store = createCommandStore(dataDir);
  const server = createControlPlaneServer({ token, store });
  const { port: actual } = await server.start(port);
  process.stdout.write(`control plane listening on 127.0.0.1:${actual}\n`);
  process.on("SIGINT", () => void server.stop().then(() => process.exit(0)));
  process.on("SIGTERM", () => void server.stop().then(() => process.exit(0)));
  return server;
}