#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webHealthRequest } from "./healthcheck.mjs";

const DEFAULT_DAEMON_PORT = 64713;
const DEFAULT_WEB_PORT = 30141;
const DEFAULT_TIMEOUT_MS = 30_000;
const STOP_GRACE_MS = 5_000;
const STOP_OBSERVE_MS = 2_000;

function port(value, fallback, name) {
  const text = value ?? String(fallback);
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw new Error(`invalid ${name}: ${text}`);
  }
  return Number(text);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitFor(url, headers, {
  fetchFn,
  sleep,
  timeoutMs,
  isShutdownRequested,
}) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (isShutdownRequested()) return { ok: false, shutdownRequested: true };
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const response = await fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(Math.min(1_000, remainingMs)),
      });
      if (response.ok) return { ok: true, shutdownRequested: false };
    } catch {
      // Child has not bound yet.
    }
    if (Date.now() >= deadline) return { ok: false, shutdownRequested: isShutdownRequested() };
    await sleep(250);
  } while (true);
}

function isRunning(child) {
  // `exitCode` alone is not enough: children that died from a signal leave
  // exitCode null and set signalCode instead. Nullish comparison also covers
  // stub children in tests that never initialize signalCode.
  return child.exitCode == null && child.signalCode == null;
}

// Waits for the child to exit, then escalates to SIGKILL after graceMs and
// observes the exit for at most observeMs more.
async function waitForExit(child, graceMs, observeMs) {
  if (!isRunning(child)) return;
  const exited = new Promise((resolveExit) => child.once("exit", () => resolveExit(true)));
  const withinGrace = await Promise.race([exited, delay(graceMs).then(() => false)]);
  if (withinGrace) return;
  child.kill("SIGKILL");
  await Promise.race([exited, delay(observeMs).then(() => false)]);
}

export async function startSupervisor({
  rootDir = join(dirname(fileURLToPath(import.meta.url)), ".."),
  env = process.env,
  spawnChild = spawn,
  fetchFn = fetch,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  log = (line) => process.stderr.write(`[server] ${line}\n`),
  pathExists = existsSync,
  healthTimeoutMs = DEFAULT_TIMEOUT_MS,
  isShutdownRequested = () => false,
  stopGraceMs = STOP_GRACE_MS,
  stopObserveMs = STOP_OBSERVE_MS,
} = {}) {
  const daemonPort = port(env.ZOSMA_DAEMON_PORT, DEFAULT_DAEMON_PORT, "ZOSMA_DAEMON_PORT");
  const webPort = port(env.PORT, DEFAULT_WEB_PORT, "PORT");
  const token = env.ZOSMA_DAEMON_TOKEN;
  const dataDir = env.ZOSMA_DAEMON_DATA_DIR;
  const childPath = [dirname(process.execPath), env.PATH].filter(Boolean).join(delimiter);
  if (!token) throw new Error("ZOSMA_DAEMON_TOKEN is required");
  if (!dataDir) throw new Error("ZOSMA_DAEMON_DATA_DIR is required");

  const daemonEntry = join(rootDir, "daemon", "src", "index.ts");
  const webEntry = join(rootDir, "web", "dist-server", "bin", "pi-web.js");
  for (const entry of [daemonEntry, webEntry]) {
    if (!pathExists(entry)) throw new Error(`runtime entry missing: ${entry}`);
  }

  const children = [];
  let stopping = false;
  let finishedShutdown = false;
  let settleDone;
  const done = new Promise((resolveDone) => { settleDone = resolveDone; });

  const stop = async (signal = "SIGTERM", code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (isRunning(child)) child.kill(signal);
    }
    await Promise.all(children.map((child) => waitForExit(child, stopGraceMs, stopObserveMs)));
    if (!finishedShutdown) {
      finishedShutdown = true;
      settleDone(code);
    }
  };

  const watch = (name, child) => {
    child.once("exit", (code, signal) => {
      if (!stopping) {
        log(`${name} exited unexpectedly (${code ?? signal ?? "unknown"})`);
        void stop("SIGTERM", code && code > 0 ? code : 1);
      }
    });
  };

  const daemon = spawnChild(process.execPath, [
    "--conditions=zosma-production",
    "--experimental-strip-types",
    daemonEntry,
  ], {
    cwd: join(rootDir, "daemon"),
    env: {
      ...env,
      PATH: childPath,
      ZOSMA_DAEMON_PORT: String(daemonPort),
      ZOSMA_DAEMON_TOKEN: token,
      ZOSMA_DAEMON_DATA_DIR: dataDir,
    },
    stdio: "inherit",
  });
  children.push(daemon);
  watch("daemon", daemon);

  const daemonReady = await waitFor(
    `http://127.0.0.1:${daemonPort}/health`,
    { authorization: `Bearer ${token}` },
    { fetchFn, sleep, timeoutMs: healthTimeoutMs, isShutdownRequested },
  );
  if (!daemonReady.ok) {
    await stop();
    if (daemonReady.shutdownRequested) return { done, stop, shutdownRequested: true };
    throw new Error("daemon did not become ready");
  }

  const hostname = env.PI_WEB_HOSTNAME || "127.0.0.1";
  const web = spawnChild(process.execPath, [
    webEntry,
    "--no-open",
    "--port", String(webPort),
    "--hostname", hostname,
  ], {
    cwd: join(rootDir, "web", "dist-server"),
    env: {
      ...env,
      PATH: childPath,
      PORT: String(webPort),
      PI_WEB_HOSTNAME: hostname,
      PI_WEB_NO_OPEN: "1",
      ZOSMA_DAEMON_URL: `http://127.0.0.1:${daemonPort}`,
      ZOSMA_DAEMON_PORT: String(daemonPort),
      ZOSMA_DAEMON_TOKEN: token,
    },
    stdio: "inherit",
  });
  children.push(web);
  watch("web", web);

  const webRequest = webHealthRequest({ ...env, PORT: String(webPort) });
  const webReady = await waitFor(webRequest.url, webRequest.headers, {
    fetchFn,
    sleep,
    timeoutMs: healthTimeoutMs,
    isShutdownRequested,
  });
  if (!webReady.ok) {
    await stop();
    if (webReady.shutdownRequested) return { done, stop, shutdownRequested: true };
    throw new Error("web did not become ready");
  }

  log(`ready at http://${hostname}:${webPort}`);
  return { done, stop, shutdownRequested: false };
}

// Installs direct-mode SIGINT/SIGTERM handling before any startup work.
export function installSignalHandlers({ onSignal, signalEmitter = process }) {
  const handlers = {
    SIGINT: () => onSignal("SIGINT"),
    SIGTERM: () => onSignal("SIGTERM"),
  };
  signalEmitter.on("SIGINT", handlers.SIGINT);
  signalEmitter.on("SIGTERM", handlers.SIGTERM);
  return () => {
    signalEmitter.removeListener("SIGINT", handlers.SIGINT);
    signalEmitter.removeListener("SIGTERM", handlers.SIGTERM);
  };
}

// Direct-mode runner: installs the signal handlers before the first child
// spawn, keeps them through both readiness waits and steady state, treats a
// requested shutdown as clean status 0, and distinguishes startup failures
// (1). Testable through injected signal/process functions.
export async function runDirect({
  signalEmitter = process,
  setExitCode = (code) => { process.exitCode = code; },
  writeError = (text) => process.stderr.write(text),
  start = startSupervisor,
  ...startOptions
} = {}) {
  let supervisor = null;
  let shutdownRequested = false;
  const removeHandlers = installSignalHandlers({
    signalEmitter,
    onSignal: (signal) => {
      shutdownRequested = true;
      if (supervisor) void supervisor.stop(signal, 0);
    },
  });
  try {
    supervisor = await start({ ...startOptions, isShutdownRequested: () => shutdownRequested });
    setExitCode(await supervisor.done);
  } catch (error) {
    if (shutdownRequested) {
      setExitCode(0);
    } else {
      setExitCode(1);
      writeError(`[server] ${error instanceof Error ? error.message : String(error)}\n`);
    }
  } finally {
    removeHandlers();
  }
  return { shutdownRequested };
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  await runDirect();
}