/**
 * Orchestrator: wires log → single-instance guard → server → readiness →
 * signals into one `startDaemon()` call.
 */
import { createLogger, Logger } from "./log.ts";
import { createInstance } from "./instance.ts";
import type { DaemonInstance } from "./instance.ts";
import { createDaemonServer } from "./server.ts";
import type { DaemonServer, Readiness } from "./server.ts";
import { createShutdown } from "./signal.ts";

export interface StartArgs {
  /** shared token for loopback IPC */
  token: string;
  dataDir?: string;
  logger?: Logger;
  /** invoked after the server is bound but before readiness flips to ready */
  onReady?: () => void | Promise<void>;
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

  const server = createDaemonServer({ token: args.token, logger });
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
      await server.stop();
      instance.release();
      logger.info("daemon stopped");
    },
  });
  shutdown.register();

  return { acquired: true, port, server, instance, shutdown };
}

export type { Readiness };
