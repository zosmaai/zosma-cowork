/**
 * Orchestrator: wires log → single-instance guard → server → readiness →
 * signals into one `startDaemon()` call.
 */
import { createLogger, Logger } from "./log.ts";
import { createInstance } from "./instance.ts";
import type { DaemonInstance } from "./instance.ts";
import { createDaemonServer } from "./server.ts";
import type { DaemonServer, PiRpcHandler, PiStreamHandler, Readiness } from "./server.ts";
import { createShutdown } from "./signal.ts";

export interface StartArgs {
  /** shared token for loopback IPC */
  token: string;
  dataDir?: string;
  logger?: Logger;
  /** invoked after the server is bound but before readiness flips to ready */
  onReady?: () => void | Promise<void>;
  /** Pi adapter dispatch (wired by the entrypoint). Disposed on shutdown. */
  piRpc?: PiRpcHandler;
  /** Pi streaming transport for `/ipc/stream` (wired by the entrypoint). */
  piStream?: PiStreamHandler;
  /** Fixed port to bind (supervision). Default: ephemeral. */
  port?: number;
  signals?: NodeJS.Signals[];
  /** override exit (tests). default: process.exit */
  exit?: (code: number) => void;
}

export interface Daemon {
  acquired: boolean;
  port?: number;
  server?: DaemonServer;
  instance?: DaemonInstance;
  shutdown?: ReturnType<typeof createShutdown>;
}

export const BUSY_EXIT_CODE = 3;

export async function startDaemon(args: StartArgs): Promise<Daemon> {
  const logger = args.logger ?? createLogger();
  const instance = createInstance({ dataDir: args.dataDir });
  const acquired = instance.acquire();
  if (!acquired) {
    logger.warn("another instance is already running", { id: instance.id });
    return { acquired: false, instance };
  }
  logger.info("daemon started", { id: instance.id, dataDir: instance.dataDir });

  const server = createDaemonServer({
    token: args.token,
    logger,
    piRpc: args.piRpc,
    piStream: args.piStream,
    port: args.port,
  });
  const { port } = await server.start();

  if (args.onReady) await args.onReady();
  server.setReady("ready");
  logger.info("daemon ready", { port });

  const shutdown = createShutdown({
    signals: args.signals,
    logger,
    exit: args.exit,
    onShutdown: async () => {
      server.setReady("shutting-down");
      // Process supervision: tear down live Pi sessions before freeing the port.
      if (args.piRpc) {
        try {
          await args.piRpc({ type: "pi:dispose" });
        } catch {
          // dispose failure must not wedge shutdown
        }
      }
      await server.stop();
      instance.release();
      logger.info("daemon stopped");
    },
  });
  shutdown.register();

  return { acquired: true, port, server, instance, shutdown };
}

export type { Readiness };
