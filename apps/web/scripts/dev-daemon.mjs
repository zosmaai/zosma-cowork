#!/usr/bin/env node
/**
 * Dev supervisor — runs the daemon beside the web service (roadmap item 5).
 *
 * Node-only (no deps, no shell): spawns `daemon/src/index.ts` (node
 * --experimental-strip-types), waits for /health, then spawns Next. On exit
 * (Ctrl-C / web exit) it tears the daemon down — unless the daemon was
 * already running, in which case that instance is left alone.
 *
 * Contract (also how prod discovers the daemon):
 *   ZOSMA_DAEMON_PORT   fixed port for the daemon (default 64713)
 *   ZOSMA_DAEMON_TOKEN  shared Bearer token (default: random per run)
 *   ZOSMA_DAEMON_URL    http://127.0.0.1:<port>   (exported to web)
 * The daemon honors the first two via daemon/src/index.ts resolveToken/
 * resolvePort, and listens on 127.0.0.1 only.
 *
 * Usage: npm run dev:all  (from web/)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.ZOSMA_DAEMON_PORT ?? 64713);
const TOKEN = process.env.ZOSMA_DAEMON_TOKEN ?? randomUUID();
const URL = `http://127.0.0.1:${PORT}`;
const DAEMON_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "daemon", "src", "index.ts");

/** Poll GET /health until 200 or timeout. Returns true when ready. */
async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${URL}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
      if (res.status === 200) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const log = (msg) => console.log(`[supervisor] ${msg}`);

let daemon = undefined;
let stopped = false;

async function main() {
  // Reuse an already-running daemon (single-instance lock would make a
  // second copy exit 3 anyway).
  if (!(await waitForHealth(1_500))) {
    if (!existsSync(DAEMON_ENTRY)) throw new Error(`daemon entry not found: ${DAEMON_ENTRY}`);
    log(`starting daemon (${DAEMON_ENTRY}) on :${PORT}`);
    daemon = spawn("node", ["--experimental-strip-types", DAEMON_ENTRY], {
      cwd: join(dirname(DAEMON_ENTRY)),
      env: { ...process.env, ZOSMA_DAEMON_PORT: String(PORT), ZOSMA_DAEMON_TOKEN: TOKEN },
      stdio: "inherit",
    });
    daemon.on("exit", (status) => {
      if (!stopped) {
        log(`daemon exited (${status}) — web continues`);
        daemon = undefined;
      }
    });
    if (!(await waitForHealth())) {
      log("daemon did not become ready in time");
      process.exit(1);
    }
  } else {
    log(`reusing daemon on ${URL} (already running)`);
  }

  log(`starting web (next dev, :30141) → ZOSMA_DAEMON_URL=${URL}`);
  const web = spawn("pnpm", ["run", "dev"], {
    cwd: join(dirname(fileURLToPath(import.meta.url))),
    env: {
      ...process.env,
      ZOSMA_DAEMON_URL: URL,
      ZOSMA_DAEMON_PORT: String(PORT),
      ZOSMA_DAEMON_TOKEN: TOKEN,
    },
    stdio: "inherit",
  });

  const stop = async (signal, code) => {
    if (stopped) return;
    stopped = true;
    log(`shutting down (${signal})`);
    web.kill(signal);
    await new Promise((r) => setTimeout(r, 100));
    if (daemon) daemon.kill(signal);
    process.exit(code);
  };
  process.on("SIGINT", () => void stop("SIGINT", 0));
  process.on("SIGTERM", () => void stop("SIGTERM", 0));
}

await main();