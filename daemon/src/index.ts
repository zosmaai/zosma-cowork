#!/usr/bin/env node
/**
 * Daemon executable entrypoint.
 *
 * Resolves the shared IPC token (env `ZOSMA_DAEMON_TOKEN`, else a persisted
 * `daemon.token` file in the data dir), starts the daemon, and prints a startup
 * line. Stays in the foreground until SIGINT/SIGTERM.
 */
import { createLogger, Logger } from "./log.ts";
import { startDaemon } from "./orchestrator.ts";
import type { Daemon } from "./orchestrator.ts";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const DATA_DIR = join(tmpdir(), "zosma-cowork", "daemon");

/** Resolve the shared IPC token from env, else persist a fresh one. */
export function resolveToken(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.ZOSMA_DAEMON_TOKEN) return env.ZOSMA_DAEMON_TOKEN;
  const p = join(dataDir, "daemon.token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  mkdirSync(dataDir, { recursive: true });
  const token = randomUUID();
  writeFileSync(p, token, { mode: 0o600 });
  return token;
}

export interface RunArgs {
  dataDir?: string;
  logger?: Logger;
  exit?: (code: number) => void;
}

/** Run the daemon from the CLI entrypoint (no side effects except `exit`). */
export async function run(args: RunArgs = {}): Promise<Daemon> {
  const logger = args.logger ?? createLogger();
  const dataDir = args.dataDir ?? DATA_DIR;
  const token = resolveToken(dataDir);
  const handle = await startDaemon({
    token,
    dataDir,
    logger,
    exit: args.exit ?? ((code) => void (process.exitCode = code)),
  });
  if (!handle.acquired) {
    logger.error("already running");
    (args.exit ?? ((code) => void (process.exitCode = code)))(3);
    return handle;
  }
  logger.info("zosma-daemon up", {
    port: handle.port,
    health: `http://127.0.0.1:${handle.port}/health`,
    ipc: `http://127.0.0.1:${handle.port}/ipc`,
    tokenHint: token.slice(0, 6) + "…",
  });
  return handle;
}

// Only auto-run when invoked as the executable (argv[1] resolves to this file).
// When imported by tests, argv[1] is the test runner and must not start.
const invokedAsBinary = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsBinary) {
  run().catch((err) => {
    createLogger().error("fatal", { detail: String(err) });
    process.exitCode = 1;
  });
}
