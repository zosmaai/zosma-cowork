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
import { ApprovalBroker } from "./approval/broker.ts";
import { handleApprovalRpc } from "./approval/rpc.ts";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OutboundConnector } from "./outbound/connector.ts";
import { loadMachineIdentity } from "./identity.ts";
import { buildCapabilityManifest } from "./manifest.ts";

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

/** Data dir (env `ZOSMA_DAEMON_DATA_DIR` — docker volume), else the tmp default. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZOSMA_DAEMON_DATA_DIR || DATA_DIR;
}

/** Bind host (env `ZOSMA_DAEMON_HOST` — `0.0.0.0` in docker), else loopback. */
export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZOSMA_DAEMON_HOST || "127.0.0.1";
}

/**
 * Stable fleet machine id (env `ZOSMA_MACHINE_ID`), else the persisted
 * identity. See `identity.ts` for the migration/conflict/reset rules.
 */
export function resolveMachineId(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return loadMachineIdentity(dataDir, env).machineId;
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
  const dataDir = args.dataDir ?? resolveDataDir();
  const token = resolveToken(dataDir);
  const pi = new PiAdapter({ storeDir: dataDir });
  // ZOS-94: durable approval/Ask-User broker. The Pi adapter is the native
  // ask surface: an `approval:request` for a live session surfaces as a
  // Pi extension-UI ask (select/editor) and resolves exactly once via the
  // user's reply; everything else stays pending for an explicit reply,
  // timeout, or cancel — nothing is ever auto-approved.
  const approvals = new ApprovalBroker(pi);
  pi.setApprovalRequester(async (request) => {
    const outcome = await approvals.request(request);
    return outcome.ok ? outcome.pending.result ?? null : null;
  });
  // ZOS-96: fleet connectivity — dial OUT to the control plane when configured.
  // Pushed commands route through the same handlePiRpc the local IPC uses, so
  // a remote machine executes exactly what the local UI can.
  const cpUrl = process.env.ZOSMA_CONTROL_PLANE_URL;
  const cpToken = process.env.ZOSMA_CONTROL_PLANE_TOKEN;
  if (cpUrl && !cpToken) throw new Error("ZOSMA_CONTROL_PLANE_URL is set but ZOSMA_CONTROL_PLANE_TOKEN is missing");
  // Half-configured fleet wiring (token and/or id but no URL) used to be silent,
  // which is invisible in a container: the daemon quietly ran single-host while
  // an operator waited for it to appear in the registry.
  const cpMachineIdEnv = process.env.ZOSMA_MACHINE_ID;
  if (!cpUrl && (cpToken || cpMachineIdEnv)) {
    logger.warn("fleet disabled: ZOSMA_CONTROL_PLANE_URL is empty, so this daemon stays single-host — set it to dial the control plane", {
      hasToken: Boolean(cpToken),
      hasMachineId: Boolean(cpMachineIdEnv),
    });
  }
  // ZOS-91: identity + capability manifest. The identity is resolved once; a
  // conflicting ZOSMA_MACHINE_ID throws here (loud boot failure, never a silent
  // takeover of another machine's record).
  const identity = cpUrl ? loadMachineIdentity(dataDir) : undefined;
  const manifest = identity ? buildCapabilityManifest([pi.manifest]) : undefined;
  const connector = cpUrl && identity
    ? new OutboundConnector({
        url: cpUrl,
        token: cpToken!,
        machineId: identity.machineId,
        machineName: identity.name,
        manifest,
        logger,
        onCommand: async (cmd) => {
          const result = await handlePiRpc(pi, { type: cmd.method, ...(cmd.params ?? {}) } as Parameters<typeof handlePiRpc>[1]);
          if (result.status < 400) {
            return { ok: true, ...(result.body !== undefined ? { data: result.body } : {}) };
          }
          const message = (result.body as { error?: string } | undefined)?.error ?? `daemon replied ${result.status}`;
          return { ok: false, error: { code: "cmd_failed", message } };
        },
      })
    : undefined;
  const handle = await startDaemon({
    token,
    dataDir,
    logger,
    piRpc: (request) => handlePiRpc(pi, request),
    piStream: (request, sink) => handlePiStream(pi, request, sink),
    approvalRpc: (request: { type: string; [key: string]: unknown }) => handleApprovalRpc(approvals, request),
    port: args.port ?? resolvePort(),
    host: resolveHost(),
    exit: args.exit ?? ((code) => void (process.exitCode = code)),
    onShutdown: connector ? () => connector.stop() : undefined,
  });
  if (!handle.acquired) {
    logger.error("already running");
    (args.exit ?? ((code) => void (process.exitCode = code)))(3);
    return handle;
  }
  connector?.start();
  logger.info("zosma-daemon up", {
    port: handle.port,
    health: `http://127.0.0.1:${handle.port}/health`,
    ipc: `http://127.0.0.1:${handle.port}/ipc`,
    tokenHint: token.slice(0, 6) + "…",
    ...(connector ? { controlPlane: cpUrl, machineId: identity!.machineId, manifestVersion: manifest?.manifestVersion } : {}),
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
