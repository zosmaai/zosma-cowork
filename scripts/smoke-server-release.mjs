#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitFor(url, options, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
    } catch {
      // Runtime is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`health timeout: ${url}`);
}

async function post(url, token, body) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "pipe", ...options });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} exited ${code}`)));
  });
}

const { values } = parseArgs({ options: { archive: { type: "string" } } });
if (!values.archive) throw new Error("--archive is required");
const archive = resolve(values.archive);
const temp = await mkdtemp(join(tmpdir(), "zosma-server-smoke-"));
const root = join(temp, "runtime-root");
const workspace = join(temp, "workspace");
const daemonState = join(temp, "daemon-state");
const piState = join(temp, "pi-agent");
let child;

try {
  await mkdir(root, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await new Promise((resolveRun, rejectRun) => {
    const tar = spawn("tar", ["-xzf", archive, "-C", root], { stdio: "inherit" });
    tar.once("error", rejectRun);
    tar.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`tar exited ${code}`)));
  });

  const version = (await readFile(join(root, "VERSION"), "utf8")).trim();
  if (!/^v\d+\.\d+\.\d+/.test(version)) throw new Error(`invalid VERSION: ${version}`);

  const bundledNode = join(root, "runtime/bin/node");
  const bundledNpx = join(root, "runtime/lib/node_modules/npm/bin/npx-cli.js");
  await run(bundledNode, [bundledNpx, "--version"], {
    env: { HOME: temp, PATH: join(root, "runtime/bin") },
  });

  const daemonPort = await freePort();
  const webPort = await freePort();
  const token = randomUUID();
  const password = randomUUID();
  child = spawn(bundledNode, [join(root, "supervisor/run-server.mjs")], {
    cwd: root,
    env: {
      HOME: temp,
      PATH: join(temp, "empty-path"),
      PORT: String(webPort),
      PI_WEB_HOSTNAME: "127.0.0.1",
      PI_WEB_PASSWORD: password,
      PI_WEB_NO_OPEN: "1",
      PI_CODING_AGENT_DIR: piState,
      ZOSMA_DAEMON_DATA_DIR: daemonState,
      ZOSMA_DAEMON_PORT: String(daemonPort),
      ZOSMA_DAEMON_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  await waitFor(`http://127.0.0.1:${daemonPort}/health`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const webAuthorization = `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`;
  await waitFor(`http://127.0.0.1:${webPort}/api/v1/health`, {
    headers: { authorization: webAuthorization },
  });

  const validate = await fetch(`http://127.0.0.1:${webPort}/api/cwd/validate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: webAuthorization },
    body: JSON.stringify({ cwd: workspace }),
  });
  if (!validate.ok) throw new Error(`web cwd validation failed: ${validate.status}`);
  const webGit = await fetch(
    `http://127.0.0.1:${webPort}/api/git/status?cwd=${encodeURIComponent(workspace)}`,
    { headers: { authorization: webAuthorization } },
  );
  const webGitBody = await webGit.json();
  if (webGit.status !== 503 || webGitBody.error !== "git_unavailable") {
    throw new Error(`web Git route did not degrade predictably: ${webGit.status}`);
  }

  const allow = await post(`http://127.0.0.1:${daemonPort}/ipc`, token, {
    type: "read:allow-root",
    root: workspace,
  });
  if (!allow.ok) throw new Error(`allow-root failed: ${allow.status}`);
  const git = await post(`http://127.0.0.1:${daemonPort}/ipc`, token, {
    type: "git:status",
    cwd: workspace,
  });
  const gitBody = await git.json();
  if (git.status !== 503 || gitBody.error !== "git_unavailable") {
    throw new Error(`missing Git did not degrade predictably: ${git.status}`);
  }

  child.kill("SIGTERM");
  const exitCode = await new Promise((resolveExit) => child.once("exit", resolveExit));
  if (exitCode !== 0) throw new Error(`supervisor exited ${exitCode}`);
  if (
    output.includes(token)
    || output.includes(token.slice(0, 6))
    || output.includes(password)
    || output.includes(password.slice(0, 6))
  ) {
    throw new Error("secret or secret hint leaked to output");
  }
  process.stdout.write(`server archive smoke passed: ${version}\n`);
} finally {
  if (child?.exitCode === null) child.kill("SIGKILL");
  await rm(temp, { recursive: true, force: true });
}