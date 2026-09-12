#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { BUNDLED_NODE_VERSION } from "./bundled-node-version.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]);

export function targetFor(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!TARGETS.has(target)) throw new Error(`unsupported server target: ${target}`);
  return target;
}

export function archiveName(version, target) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("version must be a v-prefixed semantic version");
  }
  if (!TARGETS.has(target)) throw new Error(`unsupported server target: ${target}`);
  return `zosma-cowork-server-${version}-${target}.tar.gz`;
}

export function nodeDistribution(version, target) {
  if (!TARGETS.has(target)) throw new Error(`unsupported server target: ${target}`);
  const extension = target.startsWith("linux-") ? "tar.xz" : "tar.gz";
  return {
    directory: `node-${version}-${target}`,
    filename: `node-${version}-${target}.${extension}`,
  };
}

export function parseSha256Sums(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) result.set(match[2], match[1].toLowerCase());
  }
  return result;
}

function walk(root) {
  const paths = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    paths.push(path);
    if (entry.isDirectory() && !entry.isSymbolicLink()) paths.push(...walk(path));
  }
  return paths;
}

export function assertPortableTree(root) {
  const resolvedRoot = realpathSync(root);
  for (const path of walk(root)) {
    const entry = relative(root, path).split(/[\\/]+/);
    const relativePath = entry.join("/");
    if (entry.includes(".git")) throw new Error(`forbidden .git entry: ${path}`);
    if (relativePath.startsWith("web/dist-server/.next/cache/")) {
      throw new Error(`forbidden Next cache entry: ${path}`);
    }
    const firstPartySource = relativePath.startsWith("daemon/src/")
      || relativePath.includes("daemon/node_modules/@zosma-cowork/protocol/src/");
    if (firstPartySource && /\.test\.(?:mjs|ts)$/.test(path)) {
      throw new Error(`forbidden first-party test entry: ${path}`);
    }
    if (lstatSync(path).isSymbolicLink()) {
      const target = realpathSync(path);
      const fromRoot = relative(resolvedRoot, target);
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new Error(`symlink escapes runtime tree: ${path} -> ${target}`);
      }
    }
  }
}

export function assertRuntimeTree(root) {
  const required = [
    "runtime/bin/node",
    "runtime/lib/node_modules/npm/bin/npm-cli.js",
    "runtime/lib/node_modules/npm/bin/npx-cli.js",
    "web/dist-server/server.js",
    "web/dist-server/bin/pi-web.js",
    "daemon/src/index.ts",
    "daemon/bin/zosma-daemon.js",
    "supervisor/run-server.mjs",
    "supervisor/healthcheck.mjs",
    "VERSION",
  ];
  for (const path of required) {
    try {
      if (!statSync(join(root, path)).isFile()) throw new Error();
    } catch {
      throw new Error(`required runtime file missing: ${path}`);
    }
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} exited ${code}`)));
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(path, { mode: 0o600 }),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      version: { type: "string" },
      output: { type: "string", default: "dist/server" },
    },
  });
  const hostTarget = targetFor();
  const target = values.target ?? hostTarget;
  const version = values.version;
  if (!version) throw new Error("--version is required");
  if (target !== hostTarget) {
    throw new Error(`cross-packaging is unsupported: host ${hostTarget}, target ${target}`);
  }

  const outputDir = resolve(REPO_ROOT, values.output);
  await mkdir(outputDir, { recursive: true });
  // Stage next to the final artifact so the final rename stays on one
  // filesystem (EXDEV-safe) while the archive looks final to consumers.
  const temp = await mkdtemp(join(outputDir, ".package-"));
  const stage = join(temp, "stage");
  const nodeTemp = join(temp, "node");
  const finalName = archiveName(version, target);
  const finalPath = join(outputDir, finalName);
  const stagedArchive = join(temp, finalName);

  try {
    await mkdir(stage, { recursive: true });
    await run("pnpm", ["-C", "apps/web", "build"], { cwd: REPO_ROOT });
    await run("pnpm", ["-C", "apps/web", "package-server"], { cwd: REPO_ROOT });
    await run("pnpm", ["-C", "apps/daemon", "typecheck"], { cwd: REPO_ROOT });
    await run("pnpm", ["-C", "packages/protocol", "build"], { cwd: REPO_ROOT });
    await run("pnpm", [
      "--filter", "@zosma-cowork/daemon",
      "deploy", "--prod", "--legacy", join(stage, "daemon"),
    ], { cwd: REPO_ROOT });

    // pnpm's legacy deploy records the deployed package itself in its local
    // virtual store as a symlink back into the live workspace; the staged
    // daemon root already IS the package, so drop that single self-reference.
    await rm(join(stage, "daemon", "node_modules", ".pnpm", "node_modules", "@zosma-cowork", "daemon"), {
      recursive: true,
      force: true,
    });

    await cp(join(REPO_ROOT, "apps/web/dist-server"), join(stage, "web/dist-server"), {
      recursive: true,
      dereference: true,
    });
    await mkdir(join(stage, "supervisor"), { recursive: true });
    await cp(join(REPO_ROOT, "scripts/run-server.mjs"), join(stage, "supervisor/run-server.mjs"));
    await cp(join(REPO_ROOT, "scripts/healthcheck.mjs"), join(stage, "supervisor/healthcheck.mjs"));
    await writeFile(join(stage, "VERSION"), `${version}\n`, { mode: 0o644 });

    const distribution = nodeDistribution(BUNDLED_NODE_VERSION, target);
    const baseUrl = `https://nodejs.org/dist/${BUNDLED_NODE_VERSION}`;
    const archive = join(temp, distribution.filename);
    const sumsPath = join(temp, "SHASUMS256.txt");
    await download(`${baseUrl}/SHASUMS256.txt`, sumsPath);
    await download(`${baseUrl}/${distribution.filename}`, archive);
    const expected = parseSha256Sums(await readFile(sumsPath, "utf8")).get(distribution.filename);
    if (!expected || await sha256(archive) !== expected) {
      throw new Error(`Node checksum mismatch: ${distribution.filename}`);
    }

    await mkdir(nodeTemp, { recursive: true });
    await run("tar", [target.startsWith("linux-") ? "-xJf" : "-xzf", archive, "-C", nodeTemp]);
    const nodeRoot = join(nodeTemp, distribution.directory);
    await mkdir(join(stage, "runtime/bin"), { recursive: true });
    await mkdir(join(stage, "runtime/lib/node_modules"), { recursive: true });
    await cp(join(nodeRoot, "bin/node"), join(stage, "runtime/bin/node"));
    await cp(join(nodeRoot, "lib/node_modules/npm"), join(stage, "runtime/lib/node_modules/npm"), {
      recursive: true,
      dereference: true,
    });
    await chmod(join(stage, "runtime/bin/node"), 0o755);

    assertRuntimeTree(stage);
    assertPortableTree(stage);
    await run("tar", ["-czf", stagedArchive, "-C", stage, "."]);
    await mkdir(outputDir, { recursive: true });
    await rename(stagedArchive, finalPath);
    const digest = await sha256(finalPath);
    await writeFile(join(outputDir, "SHA256SUMS"), `${digest}  ${finalName}\n`, { mode: 0o644 });
    process.stdout.write(`${finalPath}\n`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}