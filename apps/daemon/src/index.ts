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
import { PiAdapter } from "./pi/adapter.ts";
import { handlePiRpc, handlePiStream } from "./pi/rpc.ts";
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

/** Fixed port for supervision (env `ZOSMA_DAEMON_PORT`), else undefined (ephemeral). */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (!env.ZOSMA_DAEMON_PORT) return undefined;
  const port = Number(env.ZOSMA_DAEMON_PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

export interface RunArgs {
  dataDir?: string;
  logger?: Logger;
  port?: number;
  exit?: (code: number) => void;
}

/** Run the daemon from the CLI entrypoint (no side effects except `exit`). */
export async function run(args: RunArgs = {}): Promise<Daemon> {
  const logger = args.logger ?? createLogger();
  const dataDir = args.dataDir ?? DATA_DIR;
  const token = resolveToken(dataDir);
  const pi = new PiAdapter({ storeDir: dataDir });
  const handle = await startDaemon({
    token,
    dataDir,
    logger,
    piRpc: (request) => handlePiRpc(pi, request),
    piStream: (request, sink) => handlePiStream(pi, request, sink),
    port: args.port ?? resolvePort(),
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
  // Warm the session-list cache in the background: the sidebar's first load
  // otherwise stalls on a cold multi-second disk scan right after a restart.
  void import("./read/sessions.ts").then(({ listAllSessions }) => {
    listAllSessions().catch((err) => logger.warn("session list prefetch failed", { error: String(err) }));
  });
  // Prewarm a pi session for the default workspace (repo root passed by the
  // supervisor) so the FIRST chat fires the prompt immediately — the daemon
  // session-spawn+SSE-cold-open gap used to sit inside the send path (the
  // "first-chat flicker": optimistic bubble, dead air, everything at once).
  const warmCwd = process.env.ZOSMA_WARM_CWD;
  if (warmCwd) {
    void pi.warmSession(warmCwd).catch((err) => logger.warn("session prewarm failed", { error: String(err) }));
  }
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
